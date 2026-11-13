"""Poll DXscape's bounded worldwide HTML spot snapshot."""

import math
import re
import time
from datetime import UTC, datetime, timedelta
from html.parser import HTMLParser

import httpx
from shared.http import FIREFOX_USER_AGENT

from ..adapters import Snapshot


class _PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._in_pre = False
        self._in_title = False
        self._pre_parts = []
        self._title_parts = []
        self.pre_blocks = []
        self.title = ""

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "pre":
            self._in_pre = True
            self._pre_parts = []
        elif tag.lower() == "title":
            self._in_title = True
            self._title_parts = []

    def handle_endtag(self, tag):
        if tag.lower() == "pre" and self._in_pre:
            self.pre_blocks.append("".join(self._pre_parts))
            self._in_pre = False
        elif tag.lower() == "title" and self._in_title:
            self.title = "".join(self._title_parts).strip()
            self._in_title = False

    def handle_data(self, data):
        if self._in_pre:
            self._pre_parts.append(data)
        if self._in_title:
            self._title_parts.append(data)


class DXscapeAdapter:
    service = "dxscape"
    MAX_BYTES = 512 * 1024
    MAX_ROW_AGE = timedelta(days=1)
    FUTURE_SKEW = timedelta(seconds=30)
    ROW_FUTURE_SKEW = timedelta(minutes=5)
    ROW = re.compile(r"^(.{12}) (\d{4}Z) (.{8}) (.{32})(.{1,})$")
    FOOTER = re.compile(r"^[A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} UTC \d{4}$")
    JST_FOOTER = re.compile(r"^[A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} JST \d{4}$")

    def __init__(
        self,
        *,
        session: httpx.AsyncClient | None = None,
        base_url: str = "http://www.dxscape.com",
        clock=time.time,
        poll_interval: float = 60.0,
        snapshot_limit: int = 500,
        stale_after: float = 180.0,
        request_timeout: float = 15.0,
    ):
        if not math.isfinite(poll_interval) or poll_interval < 60:
            raise ValueError("DXscape requires at least 60 seconds between requests")
        if type(snapshot_limit) is not int or snapshot_limit < 1:
            raise ValueError("DXscape snapshot limit must be positive")
        if not math.isfinite(stale_after) or stale_after <= 0:
            raise ValueError("DXscape stale threshold must be positive")
        if not math.isfinite(request_timeout) or request_timeout <= 0:
            raise ValueError("DXscape request timeout must be positive")
        self.session = session
        self._owns_session = session is None
        self._url = base_url.rstrip("/") + "/ww.html"
        self.clock = clock
        self.poll_interval = poll_interval
        self.snapshot_limit = snapshot_limit
        self.stale_after = stale_after
        self.timeout = httpx.Timeout(request_timeout)
        self._last_request = None
        self._previous = None
        self._closed = False

    async def close(self):
        if self._closed:
            return
        self._closed = True
        if self._owns_session and self.session is not None:
            await self.session.aclose()
            self.session = None

    @staticmethod
    def _callsign(value: str, *, strip_ssid: bool) -> str:
        call = value.strip().upper()
        if strip_ssid:
            call = re.sub(r"-\d+$", "", call)
        if not call or len(call) > 64 or any(character.isspace() for character in call):
            raise ValueError("Invalid DXscape callsign")
        return call

    def _parse(self, body: bytes, now: float):
        try:
            text = body.decode("utf-8")
        except UnicodeDecodeError:
            return None
        parser = _PageParser()
        try:
            parser.feed(text)
            parser.close()
        except ValueError:
            return None
        if parser.title != "DXSCAPE Web cluster" or len(parser.pre_blocks) != 1:
            return None
        lines = [line.rstrip("\r") for line in parser.pre_blocks[0].splitlines() if line.strip()]
        footer_indexes = [index for index, line in enumerate(lines) if self.FOOTER.fullmatch(line.strip())]
        if len(footer_indexes) != 1:
            return None
        footer_index = footer_indexes[0]
        if footer_index < 2 or footer_index != len(lines) - 1:
            return None
        row_end = footer_index - 1
        if not self.JST_FOOTER.fullmatch(lines[row_end].strip()):
            return None
        try:
            footer = datetime.strptime(lines[footer_index].strip(), "%a %b %d %H:%M:%S UTC %Y").replace(tzinfo=UTC)
        except ValueError:
            return None
        current = datetime.fromtimestamp(now, UTC)
        if current - footer > timedelta(seconds=self.stale_after) or footer - current > self.FUTURE_SKEW:
            return None

        records = []
        try:
            for line in lines[:row_end]:
                match = self.ROW.fullmatch(line)
                if not match:
                    raise ValueError("Invalid DXscape row")
                dx, spot_time, frequency, comment, spotter = match.groups()
                hour, minute = int(spot_time[:2]), int(spot_time[2:4])
                same_day = footer.replace(hour=hour, minute=minute, second=0, microsecond=0)
                candidate = min(
                    (same_day - timedelta(days=1), same_day, same_day + timedelta(days=1)),
                    key=lambda value: abs(value - footer),
                )
                if candidate - footer > self.ROW_FUTURE_SKEW or footer - candidate > self.MAX_ROW_AGE:
                    raise ValueError("DXscape row time is outside the snapshot window")
                frequency = float(frequency.strip())
                if not math.isfinite(frequency) or frequency <= 0:
                    raise ValueError("Invalid DXscape frequency")
                spot = {
                    "time": spot_time,
                    "dx_callsign": self._callsign(dx, strip_ssid=False),
                    "spotter_callsign": self._callsign(spotter, strip_ssid=True),
                    "frequency": frequency,
                    "comment": comment.rstrip(),
                    "observed_at": candidate.timestamp(),
                }
                fingerprint = (
                    spot["observed_at"],
                    spot["dx_callsign"],
                    spot["frequency"],
                    spot["comment"],
                    spot["spotter_callsign"],
                )
                records.append((fingerprint, spot))
        except (OverflowError, ValueError):
            return None
        if not records or len(records) > self.snapshot_limit:
            return None
        return records

    @staticmethod
    def _overlap(current, previous):
        matches = []
        current_keys = [record[0] for record in current]
        previous_keys = [record[0] for record in previous]
        for start in range(len(current_keys)):
            length = min(len(current_keys) - start, len(previous_keys))
            if current_keys[start : start + length] == previous_keys[:length]:
                matches.append(start)
        return matches[0] if len(matches) == 1 else None

    async def poll(self) -> Snapshot:
        if self._closed:
            raise RuntimeError("DXscape adapter is closed")
        now = self.clock()
        if self._last_request is not None and now - self._last_request < self.poll_interval:
            return Snapshot([], recoverable=False)
        self._last_request = now
        if self.session is None:
            self.session = httpx.AsyncClient(follow_redirects=False)
        async with self.session.stream(
            "GET",
            self._url,
            headers={"User-Agent": FIREFOX_USER_AGENT, "Accept": "text/html"},
            timeout=self.timeout,
        ) as response:
            response.raise_for_status()
            body = bytearray()
            async for chunk in response.aiter_bytes():
                if len(body) + len(chunk) > self.MAX_BYTES:
                    return Snapshot([], recoverable=False)
                body.extend(chunk)
        records = self._parse(bytes(body), now)
        if records is None:
            return Snapshot([], recoverable=False)
        if self._previous is None:
            self._previous = records
            return Snapshot([], recoverable=False)
        start = self._overlap(records, self._previous)
        if start is None:
            self._previous = records
            return Snapshot([], saturated=len(records) == self.snapshot_limit, recoverable=False)
        new = sorted((spot for _, spot in records[:start]), key=lambda spot: spot["observed_at"])
        self._previous = records
        return Snapshot(new)
