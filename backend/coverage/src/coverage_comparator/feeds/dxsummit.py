"""Read the public DX Summit JSON feed. Treat times without an offset as UTC."""

import json
import math
import re
import time
from collections.abc import Callable
from datetime import datetime, timezone

import aiohttp
from shared.http import FIREFOX_USER_AGENT

from ..adapters import Snapshot


class DXSummitAdapter:
    """Keep one numeric high-water ID. Do not use upstream IDs as spot identity.

    The endpoint returns the newest records first. Request an overlapping time
    range and require the previous high-water record in each response. If that
    record is absent, coverage is unknown. Rebase after a gap so the next poll
    can recover. Do not replay records from the initial historical response.
    """

    service = "dxsummit"
    poll_interval = 15.0
    user_agent = FIREFOX_USER_AGENT
    timeout = aiohttp.ClientTimeout(total=12, connect=5)
    max_response_bytes = 2 * 1024 * 1024

    def __init__(
        self,
        *,
        session: aiohttp.ClientSession | None = None,
        base_url: str = "https://www.dxsummit.fi",
        clock: Callable[[], float] = time.time,
        limit: int = 1000,
        overlap_seconds: int = 120,
    ):
        if type(limit) is not int or not 2 <= limit <= 10000:
            raise ValueError("limit must be between 2 and 10000")
        if type(overlap_seconds) is not int or not 1 <= overlap_seconds <= 3600:
            raise ValueError("overlap_seconds must be between 1 and 3600")
        self._session = session
        self._owns_session = session is None
        self._url = base_url.rstrip("/") + "/api/v1/spots"
        self._clock = clock
        self._limit = limit
        self._overlap = overlap_seconds
        self._cursor: int | None = None
        self._cursor_time = 0.0
        self._closed = False

    @staticmethod
    def _normalize(record: dict) -> tuple[int, dict]:
        if not isinstance(record, dict):
            raise ValueError("Expected a spot object")
        upstream_id = record["id"]
        if type(upstream_id) is not int or not 0 < upstream_id <= 2**63 - 1:
            raise ValueError("Invalid upstream ID")
        timestamp = record["time"]
        if not isinstance(timestamp, str) or len(timestamp) > 40 or "T" not in timestamp:
            raise ValueError("Invalid spot time")
        date = datetime.fromisoformat(timestamp)
        if date.tzinfo is None:
            date = date.replace(tzinfo=timezone.utc)
        date = date.astimezone(timezone.utc)
        dx, spotter = record["dx_call"], record["de_call"]
        if any(not isinstance(call, str) or not call.strip() or len(call) > 64 for call in (dx, spotter)):
            raise ValueError("Invalid callsign")
        frequency = record["frequency"]
        if isinstance(frequency, bool) or not isinstance(frequency, (str, int, float)):
            raise ValueError("Invalid frequency")
        frequency = float(frequency)
        if not math.isfinite(frequency) or frequency <= 0:
            raise ValueError("Invalid frequency")
        # The public API also uses 'info' for the comment field.
        comment = record.get("comment", record.get("info", ""))
        if comment is None:
            comment = ""
        if not isinstance(comment, str) or len(comment) > 2048:
            raise ValueError("Invalid comment")
        return upstream_id, {
            "time": date.strftime("%H%MZ"),
            "dx_callsign": dx.strip().upper(),
            "spotter_callsign": re.sub(r"-(?:\d+|@)$", "", spotter.strip().upper()),
            "frequency": frequency,
            "comment": comment,
            "observed_at": date.timestamp(),
        }

    async def poll(self) -> Snapshot:
        if self._closed:
            raise RuntimeError("Adapter is closed")
        if self._session is None:
            self._session = aiohttp.ClientSession()
        params = {"limit": self._limit}
        if self._cursor is not None:
            # DX Summit history parameters use epoch seconds, not ISO strings.
            params.update(
                from_time=max(0, int(self._cursor_time) - self._overlap),
                to_time=int(self._clock()) + 1,
            )
        async with self._session.get(
            self._url, params=params, headers={"User-Agent": self.user_agent}, timeout=self.timeout
        ) as response:
            response.raise_for_status()
            body = bytearray()
            async for chunk in response.content.iter_chunked(65536):
                body.extend(chunk)
                if len(body) > self.max_response_bytes:
                    return Snapshot([], saturated=True, recoverable=False)
        try:
            payload = json.loads(body)
            if not isinstance(payload, list):
                raise ValueError("Expected a spot list")
            if len(payload) > self._limit:
                return Snapshot([], saturated=True, recoverable=False)
            records = {}
            for record in payload:
                upstream_id, spot = self._normalize(record)
                if upstream_id in records and records[upstream_id] != spot:
                    raise ValueError("Conflicting upstream ID")
                records[upstream_id] = spot
        except (ValueError, KeyError, TypeError, OverflowError):
            # Reject the whole response. Do not move the cursor past bad data.
            return Snapshot([], recoverable=False)

        saturated = len(payload) >= self._limit
        if not records:
            return Snapshot([], recoverable=False)
        newest = max(records)
        if self._cursor is not None and newest < self._cursor:
            return Snapshot([], saturated=saturated, recoverable=False)
        continuous = self._cursor is not None and self._cursor in records
        spots = [spot for key, spot in records.items() if self._cursor is not None and key > self._cursor]
        chronological = all(spot["observed_at"] >= self._cursor_time for spot in spots)
        self._cursor = newest
        self._cursor_time = max(self._cursor_time, *(spot["observed_at"] for spot in records.values()))
        if saturated or not continuous or not chronological:
            return Snapshot([], saturated=saturated, recoverable=False)
        spots.sort(key=lambda spot: spot["observed_at"])
        return Snapshot(spots)

    async def close(self) -> None:
        """Close the owned session. The caller must close an injected session."""
        self._closed = True
        if self._owns_session and self._session is not None:
            await self._session.close()
            self._session = None
