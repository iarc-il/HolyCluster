"""Conservative cursor reader for DXWatch's public UI (no challenge bypass).

IDs need not be contiguous. A full page cannot prove continuity, so it is
rebaselined as unknown rather than treated as complete coverage. Only a high
water mark is retained; overlapping IDs never require an unbounded seen set.
"""

import math
import re
import time
from datetime import UTC, datetime, timedelta

import httpx

from ..adapters import Snapshot

USER_AGENT = "HolyCluster coverage comparator (https://holycluster.iarc.org/)"
MONTHS = {
    month: index
    for index, month in enumerate(
        ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"), 1
    )
}
MAX_AGE = timedelta(days=1)
FUTURE_SKEW = timedelta(minutes=5)


def _timestamp(value: str, now: datetime) -> datetime:
    match = re.fullmatch(r"(\d{2})(\d{2})[zZ]\s+(\d{1,2})\s+([A-Za-z]{3})", value.strip())
    if not match:
        raise ValueError("Invalid DXWatch time")
    hour, minute, day, month = match.groups()
    candidates = []
    for year in (now.year - 1, now.year, now.year + 1):
        try:
            candidate = datetime(year, MONTHS[month.lower()], int(day), int(hour), int(minute), tzinfo=UTC)
        except (ValueError, KeyError):
            continue
        if now - MAX_AGE <= candidate <= now + FUTURE_SKEW:
            candidates.append(candidate)
    if len(candidates) != 1:
        raise ValueError("DXWatch time outside the unambiguous freshness window")
    return candidates[0]


def _normalize(fields: list, now: datetime) -> dict:
    if not isinstance(fields, list) or len(fields) < 5:
        raise ValueError("Invalid DXWatch spot array")
    spotter, frequency, dx, comment, timestamp = fields[:5]
    if not all(isinstance(value, str) for value in (spotter, dx, comment, timestamp)):
        raise ValueError("Invalid DXWatch text fields")
    spotter = re.sub(r"-\d+$", "", spotter.strip().upper())
    dx = dx.strip().upper()
    if not spotter or not dx or isinstance(frequency, bool):
        raise ValueError("Invalid DXWatch identity")
    frequency = float(frequency)
    if not math.isfinite(frequency) or frequency <= 0:
        raise ValueError("Invalid DXWatch frequency")
    observed = _timestamp(timestamp, now)
    return {
        "time": observed.strftime("%H%MZ"),
        "spotter_callsign": spotter,
        "frequency": frequency,
        "dx_callsign": dx,
        "comment": comment.strip(),
        "observed_at": observed.timestamp(),
    }


class DXWatchAdapter:
    service = "dxwatch"
    poll_interval = 30.0

    def __init__(self, *, session=None, base_url="https://www.dxwatch.com", clock=time.time, rows=100):
        if not isinstance(rows, int) or isinstance(rows, bool) or not 1 <= rows <= 1000:
            raise ValueError("DXWatch rows must be between 1 and 1000")
        self.session = session
        self._owns_session = session is None
        self.base_url = base_url.rstrip("/")
        self.clock = clock
        self.rows = rows
        self._last_id = None
        self._last_success = None

    async def close(self) -> None:
        if self._owns_session and self.session is not None:
            await self.session.aclose()
            self.session = None

    async def poll(self) -> Snapshot:
        now = datetime.fromtimestamp(self.clock(), UTC)
        if self.session is None:
            self.session = httpx.AsyncClient(follow_redirects=False)
        try:
            response = await self.session.get(
                f"{self.base_url}/dxsd1/s.php",
                params={"s": self._last_id or 0, "r": self.rows},
                headers={"User-Agent": USER_AGENT},
                timeout=15.0,
            )
            response.raise_for_status()
            # Parse the body, not PHP's sometimes generic content type. HTML
            # challenges (even HTTP 200) fail JSON decoding; never bypass them.
            data = response.json()
            if not isinstance(data, dict) or not isinstance(data.get("s"), dict):
                return Snapshot([], recoverable=False)
            spots = data["s"]
            if len(spots) > self.rows:
                return Snapshot([], saturated=True, recoverable=False)
            records = []
            for spot_id, fields in spots.items():
                if not isinstance(spot_id, str) or not re.fullmatch(r"[1-9]\d{0,19}", spot_id):
                    raise ValueError("Invalid DXWatch spot ID")
                records.append((int(spot_id), _normalize(fields, now)))
        except (httpx.HTTPError, ValueError, TypeError, OverflowError):
            return Snapshot([], recoverable=False)

        saturated = len(records) >= self.rows
        maximum = max((spot_id for spot_id, _ in records), default=None)
        if self._last_id is not None and maximum is not None and maximum < self._last_id:
            # Never lower the high water mark and replay IDs after a server reset.
            return Snapshot([], saturated=saturated, recoverable=False)
        seed = self._last_id is None
        gap = self._last_success is not None and (now < self._last_success or now - self._last_success > MAX_AGE)
        records.sort(key=lambda record: (record[1]["observed_at"], record[0]))
        new = [spot for spot_id, spot in records if self._last_id is not None and spot_id > self._last_id]
        if maximum is not None:
            self._last_id = maximum
        self._last_success = now
        if seed or gap or saturated:
            return Snapshot([], saturated=saturated, recoverable=False)
        return Snapshot(new)
