"""Store a bounded set of mismatch examples. Do not sample outcome metrics."""

import hashlib
import re
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from loguru import logger
from shared.coverage_samples import insert_coverage_samples
from shared.db import SpotCoverageSample
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from .adapters import SERVICES


def sample_row(sample_id: str, sample: dict) -> SpotCoverageSample:
    """Convert a source sample without guessing a malformed source time."""
    spot = sample["spot"]
    source_time = spot["time"]
    if not isinstance(source_time, str) or not re.fullmatch(r"[0-9]{4}Z?", source_time):
        raise ValueError("Expected HHMM or HHMMZ source time")
    spot_time = datetime.strptime(source_time[:4], "%H%M").time()
    opened = datetime.fromtimestamp(sample["opened"], UTC)
    observed = spot.get("observed_at", spot.get("timestamp"))
    if observed is None:
        observed_at = opened
    elif isinstance(observed, datetime):
        observed_at = observed
    elif isinstance(observed, str):
        observed_at = datetime.fromisoformat(observed)
    else:
        observed_at = datetime.fromtimestamp(observed, UTC)
    if observed_at.tzinfo is None:
        raise ValueError("Observation time must include a time zone")
    if sample["service"] not in SERVICES:
        raise ValueError("Unknown coverage service")
    return SpotCoverageSample.model_validate(
        dict(
            service=sample["service"],
            direction=sample["result"],
            finalized_at=datetime.fromtimestamp(sample["finalized"], UTC),
            window_started_at=opened,
            spot_time=spot_time,
            observed_at=observed_at.astimezone(UTC),
            spotter_callsign=str(spot["spotter_callsign"]),
            dx_callsign=str(spot["dx_callsign"]),
            frequency=str(spot["frequency"]),
            comment=str(spot.get("comment", "")),
            identity_digest=hashlib.sha256(sample_id.encode()).hexdigest(),
        )
    )


class PostgresSampleSink:
    """Pace inserts per scope with no burst credit, including after a restart.

    Start each scope empty. A restart must wait for a full interval again.
    Reserve an interval before database I/O, also when a transaction fails.
    The shared helper owns database deduplication and scope cap enforcement.
    The caller owns the engine and must dispose of it after all writes stop.
    """

    def __init__(
        self,
        engine: AsyncEngine,
        *,
        retention_hours: int = 24,
        max_samples: int = 1000,
        max_per_minute: int = 10,
        clock: Callable[[], float] = time.monotonic,
        utcnow: Callable[[], datetime] = lambda: datetime.now(UTC),
    ):
        if retention_hours < 1 or max_samples < 0 or max_per_minute < 1:
            raise ValueError("Invalid sample write limits")
        self.sessions = async_sessionmaker(engine, expire_on_commit=False)
        self.retention = timedelta(hours=retention_hours)
        self.max_samples = max_samples
        self.interval = 60 / max_per_minute
        self.clock = clock
        self.utcnow = utcnow
        started = clock()
        self.next_write = {
            (service, direction): started + self.interval
            for service in SERVICES
            for direction in ("holy_only", "service_only")
        }
        self.next_log = started

    def skipped(self, reason: str, now: float) -> None:
        # One diagnostic per minute across all scopes. Never log source data.
        if now >= self.next_log:
            self.next_log = now + 60
            logger.warning("Coverage example skipped: {} (diagnostics limited to one per minute)", reason)

    async def put(self, sample_id: str, sample: dict) -> None:
        now = self.clock()
        try:
            row = sample_row(sample_id, sample)
        except (ValueError, TypeError, KeyError, OverflowError, OSError):
            self.skipped("invalid sample", now)
            return
        scope = (row.service, row.direction)
        cutoff = self.utcnow() - self.retention
        if row.finalized_at < cutoff:
            self.skipped("expired sample", now)
            return
        if now < self.next_write[scope]:
            self.skipped("write rate limit", now)
            return
        self.next_write[scope] = now + self.interval
        async with self.sessions.begin() as session:
            await insert_coverage_samples(
                session,
                [row],
                service=row.service,
                direction=row.direction,
                retention_cutoff=cutoff,
                max_samples=self.max_samples,
            )
