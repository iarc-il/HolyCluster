"""Poll DXHeat's public rolling JSON UI feed."""

import math
import re
import time
from collections.abc import Callable
from datetime import datetime, timezone

import aiohttp

from ..adapters import Snapshot

USER_AGENT = "HolyCluster coverage comparator (https://holycluster.iarc.org/)"


class DXHeatAdapter:
    service = "dxheat"
    poll_interval = 10.0

    def __init__(
        self,
        *,
        session: aiohttp.ClientSession | None = None,
        base_url: str = "https://dxheat.com",
        clock: Callable[[], float] = time.time,
        snapshot_limit: int = 200,
        stale_after: float = 300,
        request_timeout: float = 15,
    ):
        if snapshot_limit < 1 or stale_after <= 0 or request_timeout <= 0:
            raise ValueError("DXHeat limits and timeouts must be positive")
        self._session = session
        self._owns_session = session is None
        self._url = base_url.rstrip("/") + f"/source/spots/?a={snapshot_limit}"
        self._clock = clock
        self._limit = snapshot_limit
        self._stale_after = stale_after
        self._timeout = aiohttp.ClientTimeout(total=request_timeout)
        # Nr is monotonic within a generation, so a watermark replaces an
        # unbounded set of every ID ever observed.
        self._watermark: int | None = None
        self._latest_timestamp: float | None = None
        self._closed = False

    async def close(self) -> None:
        if not self._closed:
            self._closed = True
            if self._owns_session and self._session is not None:
                await self._session.close()

    @staticmethod
    def _callsign(value: object) -> str:
        if not isinstance(value, str):
            raise ValueError("Invalid callsign")
        call = re.sub(r"-\d+$", "", value.strip().upper())
        if not re.fullmatch(r"[A-Z0-9]+(?:/[A-Z0-9]+)*", call):
            raise ValueError("Invalid callsign")
        return call

    @classmethod
    def _parse(cls, record: object, observed_at: float) -> tuple[int, float, dict]:
        if not isinstance(record, dict):
            raise ValueError("Expected a DXHeat record")
        nr = record["Nr"]
        if type(nr) is not int or nr < 0:
            raise ValueError("Invalid DXHeat Nr")
        date, spot_time = record["Date"], record["Time"]
        if not isinstance(date, str) or not re.fullmatch(r"\d{2}/\d{2}/\d{2}", date):
            raise ValueError("Invalid DXHeat date")
        if not isinstance(spot_time, str) or not re.fullmatch(r"\d{2}:\d{2}", spot_time):
            raise ValueError("Invalid DXHeat time")
        timestamp = datetime.strptime(f"{date} {spot_time}", "%d/%m/%y %H:%M").replace(tzinfo=timezone.utc)
        frequency = record["Frequency"]
        if isinstance(frequency, bool) or not isinstance(frequency, (str, int, float)):
            raise ValueError("Invalid frequency")
        frequency = float(frequency)
        if not math.isfinite(frequency) or frequency <= 0:
            raise ValueError("Invalid frequency")
        comment = record.get("Comment", "")
        if not isinstance(comment, str):
            raise ValueError("Invalid comment")
        return (
            nr,
            timestamp.timestamp(),
            {
                "time": timestamp.strftime("%H%MZ"),
                "dx_callsign": cls._callsign(record["DXCall"]),
                "spotter_callsign": cls._callsign(record["Spotter"]),
                "frequency": frequency,
                "comment": comment.strip(),
                "observed_at": observed_at,
            },
        )

    async def poll(self) -> Snapshot:
        if self._closed:
            raise RuntimeError("DXHeat adapter is closed")
        if self._session is None:
            self._session = aiohttp.ClientSession()
        async with self._session.get(self._url, headers={"User-Agent": USER_AGENT}, timeout=self._timeout) as response:
            response.raise_for_status()
            try:
                payload = await response.json()
            except ValueError:
                return Snapshot([], recoverable=False)

        now = self._clock()
        if not isinstance(payload, list) or not payload:
            return Snapshot([], recoverable=False)
        if len(payload) > self._limit:
            return Snapshot([], saturated=True, recoverable=False)
        try:
            records = [self._parse(record, now) for record in payload]
        except (KeyError, TypeError, ValueError, OverflowError):
            return Snapshot([], recoverable=False)
        ids = sorted(record[0] for record in records)
        if len(set(ids)) != len(ids):
            return Snapshot([], recoverable=False)
        latest = max(record[1] for record in records)
        stale = now - latest > self._stale_after or latest > now + 120
        previous = self._watermark
        reset = previous is not None and ids[-1] < previous
        # An older cached window is indistinguishable from a reset until the
        # lower IDs have newer timestamps. Do not rewind and re-emit old IDs.
        if reset and self._latest_timestamp is not None and latest <= self._latest_timestamp:
            return Snapshot([], recoverable=False)
        self._watermark = ids[-1]
        self._latest_timestamp = latest
        # Restart/regression or a missing Nr cannot be backfilled by this API.
        new_ids = [nr for nr in ids if previous is not None and nr > previous]
        gap = bool(new_ids) and (new_ids[0] != previous + 1 or new_ids[-1] - new_ids[0] + 1 != len(new_ids))
        saturated = previous is not None and len(payload) == self._limit and gap
        if stale or reset or gap:
            return Snapshot([], saturated=saturated, recoverable=False)
        if previous is None:
            return Snapshot([])
        spots = [spot for nr, _, spot in sorted(records, key=lambda row: (row[1], row[0])) if nr > previous]
        return Snapshot(spots)
