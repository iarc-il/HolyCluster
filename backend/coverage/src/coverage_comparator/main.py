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

from .adapters import SERVICES, Adapter
from .consumer import HolyConsumer
from .feeds.dxdata import DXDataAdapter
from .feeds.dxheat import DXHeatAdapter
from .feeds.dxsummit import DXSummitAdapter
from .feeds.dxwatch import DXWatchAdapter
from .feeds.hamqth import HamQTHAdapter
from .matcher import Matcher
from .metrics import Metrics
from .postgres_samples import PostgresSampleSink
from .samples import SampleSink
from .service import run_adapter, run_finalizer
from .settings import Settings

METRICS_PORT = 9102


def default_adapters() -> tuple[Adapter, ...]:
    return (DXSummitAdapter(), DXHeatAdapter(), DXWatchAdapter(), DXDataAdapter(), HamQTHAdapter())


async def renew_lease(lease):
    while True:
        await asyncio.sleep(10)
        if not await lease.extend(30, replace_ttl=True):
            raise RuntimeError("Coverage process lease lost")


async def run(settings: Settings, adapters: tuple[Adapter, ...], sink: SampleSink | None = None):
    if sink is None:
        raise ValueError("Coverage needs a SampleSink")
    if {adapter.service for adapter in adapters} != set(SERVICES) or len(adapters) != len(SERVICES):
        raise ValueError("Coverage needs one adapter for each service")
    registry = CollectorRegistry()
    metrics = Metrics(registry)
    server, thread = start_http_server(METRICS_PORT, registry=registry)
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
                matcher = Matcher(redis, metrics, sink)
                await matcher.restart(time.time())
                async with asyncio.TaskGroup() as group:
                    tasks = [
                        group.create_task(renew_lease(lease)),
                        group.create_task(HolyConsumer(redis, matcher).run()),
                        group.create_task(run_finalizer(matcher)),
                    ]
                    tasks.extend(group.create_task(run_adapter(matcher, adapter)) for adapter in adapters)
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


async def run_with_database(settings: Settings, adapters: tuple[Adapter, ...] | None = None):
    engine = create_async_engine(
        settings.db_url,
        isolation_level="READ COMMITTED",
        pool_pre_ping=True,
        pool_size=1,
        max_overflow=0,
    )
    try:
        sink = PostgresSampleSink(engine)
        await run(settings, default_adapters() if adapters is None else adapters, sink)
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
