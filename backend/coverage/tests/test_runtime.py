import asyncio
import signal
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.request import urlopen

import fakeredis.aioredis
from prometheus_client import start_http_server

from coverage_comparator.adapters import SERVICES
from coverage_comparator.main import METRICS_PORT, default_adapters, main, run, run_with_database
from coverage_comparator.samples import DisabledSampleSink


class IdleAdapter:
    poll_interval = 1

    def __init__(self, service):
        self.service = service

    async def poll(self):
        await asyncio.Future()

    async def close(self):
        pass


class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_metrics_http_and_graceful_shutdown(self):
        redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
        settings = SimpleNamespace(
            valkey_effective_host="localhost",
            valkey_effective_port=6379,
            valkey_db="0",
        )
        adapters = tuple(IdleAdapter(service) for service in SERVICES)
        handlers = {}
        servers = []
        ready = asyncio.Event()

        def start_server(port, *, registry):
            self.assertEqual(port, METRICS_PORT)
            result = start_http_server(0, addr="127.0.0.1", registry=registry)
            servers.append(result[0])
            ready.set()
            return result

        def fetch_metrics():
            with urlopen(f"http://127.0.0.1:{servers[0].server_port}/metrics", timeout=5) as response:
                return response.read()

        loop = asyncio.get_running_loop()
        with (
            patch("coverage_comparator.main.Redis", return_value=redis),
            patch("coverage_comparator.main.start_http_server", side_effect=start_server),
            patch.object(
                loop, "add_signal_handler", side_effect=lambda sig, callback: handlers.update({sig: callback})
            ),
            patch.object(loop, "remove_signal_handler"),
        ):
            task = asyncio.create_task(run(settings, adapters, DisabledSampleSink()))
            try:
                await asyncio.wait_for(ready.wait(), timeout=5)
                body = await asyncio.to_thread(fetch_metrics)
                self.assertIn(b"holycluster_coverage_identity_window_seconds 180.0", body)
                self.assertIn(b"holycluster_coverage_pending_windows", body)
                self.assertIn(b'holycluster_coverage_comparison_eligible{service="dxsummit"} 0.0', body)
                self.assertIn(b'holycluster_coverage_comparison_eligible{service="dxscape"} 0.0', body)
                handlers[signal.SIGTERM]()
                await asyncio.wait_for(task, timeout=5)
                self.assertFalse(servers[0].socket.fileno() >= 0)
            finally:
                if not task.done():
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)

    def test_default_adapters_match_services(self):
        adapters = default_adapters()
        self.assertEqual(tuple(adapter.service for adapter in adapters), SERVICES)
        self.assertEqual(len({adapter.service for adapter in adapters}), len(SERVICES))


class DatabaseRuntimeTests(unittest.IsolatedAsyncioTestCase):
    def settings(self):
        return SimpleNamespace(db_url="postgresql+asyncpg://user:password@localhost/coverage")

    async def test_default_sink_and_engine_disposal(self):
        settings = self.settings()
        engine = MagicMock(dispose=AsyncMock())
        sink = MagicMock()
        with (
            patch("coverage_comparator.main.create_async_engine", return_value=engine) as create,
            patch("coverage_comparator.main.PostgresSampleSink", return_value=sink) as factory,
            patch("coverage_comparator.main.run", new_callable=AsyncMock) as runner,
        ):
            await run_with_database(settings, ())
        create.assert_called_once_with(
            settings.db_url, isolation_level="READ COMMITTED", pool_pre_ping=True, pool_size=1, max_overflow=0
        )
        factory.assert_called_once_with(engine)
        runner.assert_awaited_once_with(settings, (), sink)
        engine.dispose.assert_awaited_once()

    async def test_disposal_after_failure_and_cancellation(self):
        for error in (RuntimeError("startup failed"), asyncio.CancelledError()):
            with self.subTest(error=error):
                engine = MagicMock(dispose=AsyncMock())
                with (
                    patch("coverage_comparator.main.create_async_engine", return_value=engine),
                    patch("coverage_comparator.main.run", new_callable=AsyncMock, side_effect=error),
                    self.assertRaises(type(error)),
                ):
                    await run_with_database(self.settings(), ())
                engine.dispose.assert_awaited_once()

    async def test_disposal_after_sink_setup_failure(self):
        engine = MagicMock(dispose=AsyncMock())
        with (
            patch("coverage_comparator.main.create_async_engine", return_value=engine),
            patch("coverage_comparator.main.PostgresSampleSink", side_effect=ValueError("bad limits")),
            self.assertRaises(ValueError),
        ):
            await run_with_database(self.settings(), ())
        engine.dispose.assert_awaited_once()

    async def test_enabled_run_requires_explicit_sink(self):
        with self.assertRaisesRegex(ValueError, "SampleSink"):
            await run(self.settings(), ())

    def test_main_uses_database_runner(self):
        settings = SimpleNamespace(log_dir="/unused")
        with (
            patch("coverage_comparator.main.Settings", return_value=settings),
            patch("coverage_comparator.main.logger"),
            patch("coverage_comparator.main.add_bounded_file_sink"),
            patch("coverage_comparator.main.initialize_sentry"),
            patch("coverage_comparator.main.run_with_database", new_callable=AsyncMock) as runner,
        ):
            main()
        runner.assert_awaited_once_with(settings)
