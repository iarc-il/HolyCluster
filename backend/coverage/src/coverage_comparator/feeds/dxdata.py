"""DX Data's native UI feed (human spots only; RBN/PSK are never enabled).

There is no replay cursor. Every connection starts with a non-emitting HTTP
seed and a full comparison-window warm-up. Any loss invalidates the whole
pending batch and requires a new connection/seed, not just a successful read.
"""

import asyncio
import json
import math
import re
import time
from collections import OrderedDict, deque
from collections.abc import Callable
from datetime import datetime

import aiohttp

from coverage_comparator.adapters import Snapshot, identity

USER_AGENT = "HolyCluster collector (https://holycluster.iarc.org/)"
HTTP_URL = "https://dxdata.io/filtered_spots_json/"
WS_URL = "wss://dxdata.io/ws/dxdata/"


def parse_frequency(value: object) -> float:
    """Parse kHz, including the UI's grouped `14.255.0` representation."""
    if not isinstance(value, str) or len(value) > 32:
        raise ValueError("Expected bounded frequency text")
    value = value.strip()
    if re.fullmatch(r"\d{1,3}(?:\.\d{3})+\.\d+", value):
        integer, fraction = value.rsplit(".", 1)
        value = integer.replace(".", "") + "." + fraction
    elif not re.fullmatch(r"\d+(?:\.\d+)?", value):
        raise ValueError("Invalid frequency")
    frequency = float(value)
    if not math.isfinite(frequency) or frequency <= 0:
        raise ValueError("Invalid frequency")
    return frequency


def normalize_spot(row: object) -> dict:
    if not isinstance(row, dict):
        raise ValueError("Expected spot object")
    result = {}
    for source, target in (("spotter", "spotter_callsign"), ("dx", "dx_callsign")):
        value = row.get(source)
        if not isinstance(value, str) or len(value) > 64 or not re.fullmatch(r"[A-Za-z0-9/\-]+", value.strip()):
            raise ValueError("Invalid callsign")
        result[target] = value.strip().upper()
    timestamp = row.get("time")
    if not isinstance(timestamp, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}Z", timestamp):
        raise ValueError("Invalid spot time")
    result["time"] = datetime.strptime(timestamp, "%Y-%m-%d %H:%MZ").strftime("%H%MZ")
    result["frequency"] = parse_frequency(row.get("frequency"))
    comment = row.get("comment", "")
    if not isinstance(comment, str) or len(comment) > 2048:
        raise ValueError("Invalid comment")
    result["comment"] = comment.strip()
    return result


class DXDataAdapter:
    service = "dxdata"
    poll_interval = 1.0

    def __init__(
        self,
        *,
        session: aiohttp.ClientSession | None = None,
        http_url: str = HTTP_URL,
        ws_url: str = WS_URL,
        origin: str = "https://dxdata.io",
        clock: Callable[[], float] = time.monotonic,
        queue_limit: int = 10000,
        seed_limit: int = 10000,
        identity_limit: int = 30000,
        identity_ttl: float = 300,
        warmup_seconds: float = 60,
        timeout_seconds: float = 15,
        ping_seconds: float = 30,
        max_bytes: int = 4 * 1024 * 1024,
    ):
        if min(queue_limit, seed_limit, identity_limit, max_bytes) <= 0:
            raise ValueError("Limits must be positive")
        if min(identity_ttl, timeout_seconds, ping_seconds) <= 0 or warmup_seconds < 60:
            raise ValueError("Invalid timing (warm-up must cover a comparison window)")
        self._session = session
        self._owns_session = session is None
        self._http_url, self._ws_url, self._origin = http_url, ws_url, origin
        self._clock = clock
        self._queue_limit, self._seed_limit = queue_limit, seed_limit
        self._identity_limit, self._identity_ttl = identity_limit, identity_ttl
        self._warmup_seconds, self._timeout = warmup_seconds, timeout_seconds
        self._ping_seconds, self._max_bytes = ping_seconds, max_bytes
        self._queue = deque()
        self._seen = OrderedDict()
        self._ws = None
        self._reader = self._pinger = None
        self._gap = True
        self._saturated = False
        self._closed = False
        self._ready_at = float("inf")

    def _fail(self, *, saturated=False):
        self._gap = True
        self._saturated |= saturated
        self._queue.clear()

    def _remember(self, spot: dict) -> bool:
        now = self._clock()
        while self._seen and next(iter(self._seen.values())) <= now - self._identity_ttl:
            self._seen.popitem(last=False)
        key = identity(spot)
        if key in self._seen:
            return False
        if len(self._seen) >= self._identity_limit:
            self._fail(saturated=True)
            return False
        self._seen[key] = now
        return True

    def _message(self, data: object):
        if isinstance(data, dict) and "type" in data:
            kind = data["type"]
            if kind in ("ping", "pong") and set(data) == {"type"}:
                return kind
            if kind == "spot" and set(data) == {"type", "spot"}:
                data = data["spot"]
            elif kind == "spots" and set(data) == {"type", "spots"}:
                data = data["spots"]
            else:
                raise ValueError("Malformed or unknown control message")
        rows = data if isinstance(data, list) else [data]
        if len(rows) >= self._queue_limit:
            self._fail(saturated=True)
            return
        for row in rows:
            spot = normalize_spot(row)
            if self._remember(spot) and self._clock() >= self._ready_at:
                if len(self._queue) >= self._queue_limit:
                    self._fail(saturated=True)
                    return
                self._queue.append(spot)
        return None

    async def _receive(self):
        try:
            while not self._gap:
                message = await self._ws.receive()
                if message.type == aiohttp.WSMsgType.TEXT:
                    if len(message.data.encode()) > self._max_bytes:
                        self._fail(saturated=True)
                        return
                    if self._message(json.loads(message.data)) == "ping":
                        async with asyncio.timeout(self._timeout):
                            await self._ws.send_json({"type": "pong"})
                elif message.type not in (aiohttp.WSMsgType.PING, aiohttp.WSMsgType.PONG):
                    raise ValueError("Socket closed or non-text message")
        except (aiohttp.ClientError, OSError, ValueError, TypeError, RuntimeError, asyncio.TimeoutError):
            self._fail()

    async def _ping(self):
        try:
            while not self._gap:
                await asyncio.sleep(self._ping_seconds)
                async with asyncio.timeout(self._timeout):
                    await self._ws.send_json({"type": "ping"})
        except (aiohttp.ClientError, OSError, RuntimeError, asyncio.TimeoutError):
            self._fail()

    async def _disconnect(self):
        tasks = [task for task in (self._reader, self._pinger) if task is not None]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._reader = self._pinger = None
        if self._ws is not None:
            await self._ws.close()
            self._ws = None

    async def _seed(self):
        await self._disconnect()
        self._queue.clear()
        self._seen.clear()
        self._saturated = False
        self._ready_at = float("inf")
        if self._session is None:
            self._session = aiohttp.ClientSession()
        headers = {"User-Agent": USER_AGENT, "Origin": self._origin}
        # Open the socket first so arrivals during the HTTP seed are buffered.
        async with asyncio.timeout(self._timeout):
            self._ws = await self._session.ws_connect(
                self._ws_url,
                headers=headers,
                timeout=aiohttp.ClientWSTimeout(ws_receive=self._timeout + self._ping_seconds, ws_close=self._timeout),
                max_msg_size=self._max_bytes,
                autoping=True,
            )
        self._gap = False
        self._reader = asyncio.create_task(self._receive())
        self._pinger = asyncio.create_task(self._ping())
        async with self._session.get(
            self._http_url,
            headers=headers,
            params={"rbn": "false", "psk": "false"},
            timeout=aiohttp.ClientTimeout(total=self._timeout),
        ) as response:
            response.raise_for_status()
            body = bytearray()
            async for chunk in response.content.iter_chunked(65536):
                body.extend(chunk)
                if len(body) > self._max_bytes:
                    self._fail(saturated=True)
                    return
        rows = json.loads(body)
        if not isinstance(rows, list):
            raise ValueError("Expected snapshot list")
        if len(rows) >= self._seed_limit:
            self._fail(saturated=True)
            return
        for row in rows:
            self._remember(normalize_spot(row))
        self._ready_at = self._clock() + self._warmup_seconds

    async def poll(self) -> Snapshot:
        if self._closed:
            return Snapshot([], recoverable=False)
        if self._gap or self._ws is None:
            was_saturated = self._saturated
            try:
                await self._seed()
            except (aiohttp.ClientError, OSError, ValueError, TypeError, RecursionError, asyncio.TimeoutError):
                self._fail()
            # No cursor: even a successful reconnect cannot repair prior gaps.
            return Snapshot([], saturated=was_saturated or self._saturated, recoverable=False)
        if self._ws.closed:
            self._fail()
        if self._gap or self._clock() < self._ready_at:
            return Snapshot([], saturated=self._saturated, recoverable=False)
        spots = list(self._queue)
        self._queue.clear()
        return Snapshot(spots)

    async def close(self) -> None:
        self._closed = True
        self._fail()
        await self._disconnect()
        self._seen.clear()
        if self._owns_session and self._session is not None:
            await self._session.close()
