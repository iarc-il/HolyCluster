import asyncio
import time

from loguru import logger
from shared.telemetry import capture_exception

from .adapters import Adapter, Snapshot, encode_spot, validate_source
from .matcher import Matcher


def retry_delay(attempt: int) -> float:
    return min(60, 2 ** min(attempt, 6))


async def consume_snapshot(matcher: Matcher, service: str, snapshot: Snapshot, now: float, *, max_spots=10000):
    validate_source(service)
    saturated = snapshot.saturated or len(snapshot.spots) >= max_spots
    if saturated or not snapshot.recoverable:
        await matcher.health(service, False, now, saturated=saturated, recoverable=snapshot.recoverable)
        return
    try:
        for spot in snapshot.spots:
            encode_spot(spot, matcher.sample_max_bytes)
    except (ValueError, TypeError):
        matcher.metrics.parse_errors.labels(service).inc()
        await matcher.health(service, False, now)
        return
    await matcher.health(service, True, now)
    for spot in snapshot.spots:
        await matcher.observe(service, spot, now)


async def run_adapter(matcher: Matcher, adapter: Adapter, *, max_spots=10000):
    validate_source(adapter.service)
    failures = 0
    try:
        while True:
            try:
                if failures:
                    await matcher.health(adapter.service, False, time.time())
                snapshot = await adapter.poll()
                await consume_snapshot(matcher, adapter.service, snapshot, time.time(), max_spots=max_spots)
                failures = 0
                await asyncio.sleep(adapter.poll_interval)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                failures += 1
                try:
                    await matcher.health(adapter.service, False, time.time())
                except Exception:
                    logger.warning("Cannot save {} feed health", adapter.service)
                matcher.metrics.reconnects.labels(adapter.service).inc()
                logger.warning("Coverage feed {} failed: {}", adapter.service, type(error).__name__)
                capture_exception(error, operation=f"coverage.poll.{adapter.service}")
                await asyncio.sleep(retry_delay(failures))
    finally:
        await adapter.close()


async def run_finalizer(matcher: Matcher):
    while True:
        try:
            await matcher.finalize(time.time())
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logger.exception("Coverage finalization failed")
            capture_exception(error, operation="coverage.finalize")
        await asyncio.sleep(1)
