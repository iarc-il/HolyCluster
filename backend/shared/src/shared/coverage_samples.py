"""PostgreSQL persistence for external coverage samples, independent of the comparator."""

from collections.abc import Sequence
from datetime import datetime
from typing import Literal

from pydantic import TypeAdapter
from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from shared.db import SpotCoverageSample

Direction = Literal["holy_only", "service_only"]


def _validate_scope(service: str, direction: Direction, max_samples: int) -> None:
    if not 1 <= len(service) <= 64:
        raise ValueError("service must contain 1 to 64 characters")
    TypeAdapter(Direction).validate_python(direction)
    if isinstance(max_samples, bool) or not isinstance(max_samples, int) or max_samples < 0:
        raise ValueError("max_samples must be a non-negative integer")


async def _lock_scope(session: AsyncSession, service: str, direction: Direction) -> None:
    # Serialize insert and prune so concurrent writers cannot exceed the cap.
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:scope, 0))"),
        {"scope": f"spot_coverage_samples:{direction}:{service}"},
    )


async def _prune(
    session: AsyncSession, service: str, direction: Direction, retention_cutoff: datetime, max_samples: int
) -> int:
    table = SpotCoverageSample.__table__
    scope = (table.c.service == service) & (table.c.direction == direction)
    expired = await session.execute(delete(table).where(scope, table.c.finalized_at < retention_cutoff))
    excess = (
        select(table.c.id).where(scope).order_by(table.c.finalized_at.desc(), table.c.id.desc()).offset(max_samples)
    )
    capped = await session.execute(delete(table).where(table.c.id.in_(excess)))
    return expired.rowcount + capped.rowcount


async def prune_coverage_samples(
    session: AsyncSession,
    *,
    service: str,
    direction: Direction,
    retention_cutoff: datetime,
    max_samples: int,
) -> int:
    """Prune one scope. The caller must commit the READ COMMITTED transaction.

    Use the same helper for all writers to keep the cap safe under concurrency.
    A zero cap removes all samples in this scope. Rows at the cutoff are kept.
    """
    _validate_scope(service, direction, max_samples)
    await _lock_scope(session, service, direction)
    return await _prune(session, service, direction, retention_cutoff, max_samples)


async def insert_coverage_samples(
    session: AsyncSession,
    samples: Sequence[SpotCoverageSample],
    *,
    service: str,
    direction: Direction,
    retention_cutoff: datetime,
    max_samples: int,
) -> int:
    """Insert without replacing duplicates, then prune in the caller's transaction.

    Use READ COMMITTED isolation. Return the insert count before pruning.
    Retry identity is service/direction/digest/window, not finalized_at.
    Deleted samples have no deduplication tombstone; the comparator owns window progress.
    """
    _validate_scope(service, direction, max_samples)
    rows = []
    for sample in samples:
        validated = SpotCoverageSample.model_validate(sample.model_dump())
        if validated.service != service or validated.direction != direction:
            raise ValueError("all samples must match the requested service and direction")
        rows.append(validated.model_dump(exclude={"id"}))

    await _lock_scope(session, service, direction)
    inserted = 0
    # Single-row statements avoid PostgreSQL's parameter limit for large input batches.
    for row in rows:
        statement = (
            insert(SpotCoverageSample)
            .values(**row)
            .on_conflict_do_nothing(constraint="uc_spot_coverage_samples")
            .returning(SpotCoverageSample.id)
        )
        result = await session.execute(statement)
        inserted += result.scalar_one_or_none() is not None
    await _prune(session, service, direction, retention_cutoff, max_samples)
    return inserted
