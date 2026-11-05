import asyncio
import time

import redis.asyncio
from redis.asyncio.retry import Retry
from redis.backoff import NoBackoff
from shared.spot_identity import build_spot_key

from . import metrics
from .settings import settings

COVERAGE_STREAM = "coverage-holy"
COVERAGE_MAXLEN = 100_000
COVERAGE_QUEUE_SIZE = 1_000
COVERAGE_BATCH_SIZE = 100
COVERAGE_TIMEOUT = 0.5
IDENTITY_FIELDS = ("time", "dx_callsign", "frequency", "spotter_callsign", "comment")


class CoveragePublisher:
    def __init__(self):
        self.queue = asyncio.Queue(maxsize=COVERAGE_QUEUE_SIZE)

    def submit(self, spot):
        try:
            # Dedicated activity feeds are not comparable with general DX clusters.
            if spot.get("type"):
                metrics.COVERAGE_PUBLICATIONS.labels("excluded").inc()
                return
            record = {field: spot[field] for field in IDENTITY_FIELDS}
            record["observed_at"] = time.time()
            record["spot_key"] = build_spot_key(spot)
            self.queue.put_nowait(record)
        except Exception:
            metrics.COVERAGE_PUBLICATIONS.labels("error").inc()

    async def run(self):
        client = None
        try:
            while True:
                batch = [await self.queue.get()]
                while not self.queue.empty() and len(batch) < COVERAGE_BATCH_SIZE:
                    batch.append(self.queue.get_nowait())
                try:
                    # A separate pool and no retries keep monitoring off the user path.
                    if client is None:
                        client = redis.asyncio.Redis(
                            host=settings.valkey_effective_host,
                            port=settings.valkey_effective_port,
                            db=int(settings.valkey_db),
                            decode_responses=True,
                            socket_timeout=COVERAGE_TIMEOUT,
                            socket_connect_timeout=COVERAGE_TIMEOUT,
                            retry=Retry(NoBackoff(), 0),
                        )
                    async with asyncio.timeout(COVERAGE_TIMEOUT):
                        async with client.pipeline(transaction=False) as pipeline:
                            for record in batch:
                                pipeline.xadd(COVERAGE_STREAM, record, maxlen=COVERAGE_MAXLEN, approximate=False)
                            await pipeline.execute()
                except asyncio.CancelledError:
                    metrics.COVERAGE_PUBLICATIONS.labels("error").inc(len(batch))
                    raise
                except Exception:
                    metrics.COVERAGE_PUBLICATIONS.labels("error").inc(len(batch))
                else:
                    metrics.COVERAGE_PUBLICATIONS.labels("success").inc(len(batch))
        finally:
            metrics.COVERAGE_PUBLICATIONS.labels("error").inc(self.queue.qsize())
            if client is not None:
                await client.aclose()
