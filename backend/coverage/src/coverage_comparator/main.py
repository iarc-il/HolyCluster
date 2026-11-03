import asyncio
import signal
import sys
import time
from pathlib import Path

from loguru import logger
from prometheus_client import CollectorRegistry, start_http_server
from redis.asyncio import Redis
from shared.logging import LogFilePolicy, add_bounded_file_sink
from shared.telemetry import initialize_sentry
from sqlalchemy.ext.asyncio import create_async_engine

from .adapters import Adapter
from .consumer import HolyConsumer
from .matcher import Matcher
from .metrics import Metrics
from .postgres_samples import PostgresSampleSink
from .samples import SampleSink
from .service import run_adapter, run_finalizer
from .settings import Settings


async def renew_lease(lease):
    while True:
        await asyncio.sleep(10)
        if not await lease.extend(30, replace_ttl=True):
            raise RuntimeError("Coverage process lease lost")


async def run(settings: Settings, adapters: tuple[Adapter, ...] = (), sink: SampleSink | None = None):
    if not settings.coverage_enabled:
        logger.info("Coverage comparator is disabled")
        return
    if sink is None:
        raise ValueError("Enabled coverage needs a SampleSink")
    enabled = set(settings.coverage_services)
    selected = [adapter for adapter in adapters if adapter.service in enabled]
    if {adapter.service for adapter in selected} != enabled or len(selected) != len(enabled):
        raise ValueError("Each enabled service needs one adapter")
    registry = CollectorRegistry()
    metrics = Metrics(registry)
    server, thread = start_http_server(settings.coverage_metrics_port, registry=registry)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    try:
        async with Redis(
            host=settings.valkey_effective_host,
            port=settings.valkey_effective_port,
            db=int(settings.valkey_db),
            decode_responses=True,
            socket_connect_timeout=10,
            socket_timeout=10,
        ) as redis:
            lease = redis.lock("coverage:process", timeout=30, blocking_timeout=1, thread_local=False)
            if not await lease.acquire():
                raise RuntimeError("A coverage comparator is already active")
            try:
                matcher = Matcher(
                    redis,
                    metrics,
                    sink,
                    max_windows=settings.coverage_max_windows,
                    max_samples=settings.coverage_max_samples,
                    sample_max_bytes=settings.coverage_sample_max_bytes,
                    stale_after=settings.coverage_stale_after_seconds,
                    services=tuple(settings.coverage_services),
                )
                await matcher.restart(time.time())
                async with asyncio.TaskGroup() as group:
                    tasks = [
                        group.create_task(renew_lease(lease)),
                        group.create_task(
                            HolyConsumer(
                                redis,
                                matcher,
                                max_stream_length=settings.coverage_holy_stream_maxlen,
                            ).run()
                        ),
                        group.create_task(run_finalizer(matcher)),
                    ]
                    tasks.extend(
                        group.create_task(
                            run_adapter(
                                matcher,
                                adapter,
                                max_spots=settings.coverage_max_snapshot_spots,
                            )
                        )
                        for adapter in selected
                    )
                    await stop.wait()
                    for task in tasks:
                        task.cancel()
            finally:
                if await lease.owned():
                    await lease.release()
    finally:
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.remove_signal_handler(sig)
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


async def run_with_database(settings: Settings, adapters: tuple[Adapter, ...] = ()):
    if not settings.coverage_enabled:
        await run(settings, adapters)
        return
    engine = create_async_engine(
        settings.db_url,
        isolation_level="READ COMMITTED",
        pool_pre_ping=True,
        pool_size=1,
        max_overflow=0,
    )
    try:
        sink = PostgresSampleSink(
            engine,
            retention_hours=settings.coverage_sample_retention_hours,
            max_samples=settings.coverage_sample_scope_cap,
            max_per_minute=settings.coverage_sample_max_per_minute,
        )
        await run(settings, adapters, sink)
    finally:
        await engine.dispose()


def main():
    settings = Settings()
    logger.remove()
    logger.add(sys.stderr)
    add_bounded_file_sink(
        Path(settings.log_dir) / "coverage" / "coverage.log",
        policy=LogFilePolicy(retention=3),
    )
    initialize_sentry(settings, "coverage-comparator")
    logger.info("Start coverage comparator")
    asyncio.run(run_with_database(settings))
