"""Bounded polling of HamQTH's public, rolling (not replayable) spot snapshot."""

import asyncio
import json
import math
import re
import time
from datetime import UTC, datetime

import httpx
from shared.http import FIREFOX_USER_AGENT

from coverage_comparator.adapters import Snapshot


class HamQTHAdapter:
    """Owns its HTTP session, including an injected session.

    Empty/stale snapshots cannot prove feed liveness. Startup, lost retention,
    invalid data and cache pressure are likewise unknown, not complete history.
    Identity includes the full UTC timestamp, not just the displayed HHMMZ.
    """

    service = "hamqth"
    LIMIT = 200
    MAX_BYTES = 256 * 1024

    def __init__(
        self,
        session=None,
        base_url="https://www.hamqth.com",
        clock=time.time,
        *,
        poll_interval=15.0,
        retention_seconds=600.0,
        stale_after_seconds=120.0,
        max_cache=4000,
    ):
        if not math.isfinite(poll_interval) or poll_interval < 15:
            raise ValueError("HamQTH requires at least 15 seconds between requests")
        if (
            not math.isfinite(retention_seconds)
            or not math.isfinite(stale_after_seconds)
            or not 0 < stale_after_seconds <= retention_seconds
            or max_cache < self.LIMIT
        ):
            raise ValueError("Invalid HamQTH retention bounds")
        self.poll_interval = poll_interval
        self.session = session if session is not None else httpx.AsyncClient(timeout=15.0)
        self.base_url = base_url.rstrip("/")
        self.clock = clock
        self.retention_seconds = retention_seconds
        self.stale_after_seconds = stale_after_seconds
        self.max_cache = max_cache
        self._seen = {}
        self._last_request = None
        self._last_snapshot = None
        self._forgotten_before = float("-inf")
        self._lock = asyncio.Lock()
        self._closed = False

    async def close(self):
        if not self._closed:
            self._closed = True
            await self.session.aclose()

    @staticmethod
    def _normalize(record):
        if not isinstance(record, dict):
            raise ValueError("Expected a spot object")
        stamp = record.get("time")
        if not isinstance(stamp, str):
            raise ValueError("Expected an ISO UTC timestamp")
        dt = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        if dt.utcoffset() is None or dt.utcoffset().total_seconds() != 0:
            raise ValueError("Expected UTC")
        calls = []
        for field in ("spotter", "dxcall"):
            call = record.get(field)
            if not isinstance(call, str) or not call.strip() or len(call) > 64:
                raise ValueError("Invalid callsign")
            calls.append(call.strip().upper())
        spotter = re.sub(r"-\d+$", "", calls[0])
        if not spotter:
            raise ValueError("Invalid spotter")
        freq = record.get("freq")
        if isinstance(freq, bool) or not isinstance(freq, (str, int, float)):
            raise ValueError("Invalid frequency")
        freq = float(freq)
        if not math.isfinite(freq) or freq <= 0:
            raise ValueError("Invalid frequency")
        comment = record.get("comment", record.get("remarks", ""))
        if not isinstance(comment, str) or len(comment) > 2048:
            raise ValueError("Invalid comment")
        observed_at = dt.timestamp()
        spot = {
            "time": dt.astimezone(UTC).strftime("%H%MZ"),
            "spotter_callsign": spotter,
            "dx_callsign": calls[1],
            "frequency": freq,
            "comment": comment,
            "observed_at": observed_at,
        }
        key = (observed_at, spotter, calls[1], freq, comment)
        return key, spot

    async def poll(self) -> Snapshot:
        async with self._lock:
            if self._closed:
                raise RuntimeError("HamQTH adapter is closed")
            now = self.clock()
            # Enforce the policy even when run_adapter retries a failed HTTP request.
            if self._last_request is not None and now - self._last_request < self.poll_interval:
                return Snapshot([], recoverable=False)
            self._last_request = now
            async with self.session.stream(
                "GET",
                f"{self.base_url}/api/v2/spots",
                params={"limit": self.LIMIT},
                headers={"User-Agent": FIREFOX_USER_AGENT, "Accept": "application/json"},
                timeout=15.0,
            ) as response:
                response.raise_for_status()
                body = bytearray()
                async for chunk in response.aiter_bytes(chunk_size=16384):
                    if len(body) + len(chunk) > self.MAX_BYTES:
                        return Snapshot([], recoverable=False)
                    body.extend(chunk)
            try:
                payload = json.loads(body)
            except (ValueError, UnicodeError):
                return Snapshot([], recoverable=False)
            if not isinstance(payload, dict) or not isinstance(payload.get("spots"), list):
                return Snapshot([], recoverable=False)
            records = payload["spots"]
            saturated = len(records) >= self.LIMIT
            if len(records) > self.LIMIT:
                return Snapshot([], saturated=True, recoverable=False)

            cutoff = now - self.retention_seconds
            self._seen = {key: stamp for key, stamp in self._seen.items() if stamp >= cutoff}
            self._forgotten_before = max(self._forgotten_before, cutoff)
            valid = {}
            malformed = False
            for record in records:
                try:
                    key, spot = self._normalize(record)
                    stamp = spot["observed_at"]
                    if stamp > now + 30 or stamp <= self._forgotten_before:
                        raise ValueError("Timestamp outside retained window")
                    valid[key] = spot
                except (ValueError, TypeError, OverflowError):
                    malformed = True
            fresh = bool(valid) and max(key[0] for key in valid) >= now - self.stale_after_seconds
            seeded = self._last_snapshot is not None
            gap = seeded and (now < self._last_snapshot or now - self._last_snapshot > self.retention_seconds)
            unseen = [spot for key, spot in valid.items() if key not in self._seen]
            self._seen.update({key: key[0] for key in valid})
            overflow = len(self._seen) > self.max_cache
            if overflow:
                ordered = sorted(self._seen, key=lambda key: key[0])
                removed = ordered[: len(ordered) - self.max_cache]
                self._forgotten_before = max(self._forgotten_before, max(key[0] for key in removed))
                self._seen = {key: self._seen[key] for key in ordered[-self.max_cache :]}
            # Bad snapshots do not advance continuity; the next good snapshot can
            # expose a retention gap. Seeding never emits pre-start history.
            if fresh and not malformed:
                self._last_snapshot = now
            recoverable = seeded and fresh and not (malformed or gap or overflow)
            spots = sorted(unseen, key=lambda spot: spot["observed_at"]) if recoverable else []
            return Snapshot(spots, saturated=saturated, recoverable=bool(recoverable))
