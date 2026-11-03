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

from .adapters import Adapter
from .consumer import HolyConsumer
from .matcher import Matcher
from .metrics import Metrics
from .samples import DisabledSampleSink, SampleSink
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
            host=settings.valkey_effective_host, port=settings.valkey_effective_port,
            db=int(settings.valkey_db), decode_responses=True,
            socket_connect_timeout=10, socket_timeout=10,
        ) as redis:
            lease = redis.lock("coverage:process", timeout=30, blocking_timeout=1, thread_local=False)
            if not await lease.acquire():
                raise RuntimeError("A coverage comparator is already active")
            try:
                matcher = Matcher(
                    redis, metrics, sink or DisabledSampleSink(),
                    max_windows=settings.coverage_max_windows, max_samples=settings.coverage_max_samples,
                    sample_max_bytes=settings.coverage_sample_max_bytes,
                    stale_after=settings.coverage_stale_after_seconds,
                )
                await matcher.restart(time.time())
                if sink is None:
                    logger.warning("Mismatch sample persistence is disabled; inject a SampleSink to enable it")
                async with asyncio.TaskGroup() as group:
                    tasks = [
                        group.create_task(renew_lease(lease)),
                        group.create_task(HolyConsumer(redis, matcher).run()),
                        group.create_task(run_finalizer(matcher)),
                    ]
                    tasks.extend(group.create_task(run_adapter(
                        matcher, adapter, max_spots=settings.coverage_max_snapshot_spots,
                    )) for adapter in selected)
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


def main():
    settings = Settings()
    logger.remove()
    logger.add(sys.stderr)
    add_bounded_file_sink(
        Path(settings.log_dir) / "coverage" / "coverage.log", policy=LogFilePolicy(retention=3),
    )
    initialize_sentry(settings, "coverage-comparator")
    logger.info("Start coverage comparator")
    asyncio.run(run(settings))
