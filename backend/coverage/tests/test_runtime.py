import asyncio
import signal
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from urllib.request import urlopen

import fakeredis.aioredis
from prometheus_client import start_http_server

from coverage_comparator.main import run


class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_metrics_http_and_graceful_shutdown(self):
        redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
        settings = SimpleNamespace(
            coverage_enabled=True,
            coverage_services=(),
            coverage_metrics_port=0,
            valkey_effective_host="localhost",
            valkey_effective_port=6379,
            valkey_db="0",
            coverage_max_windows=100,
            coverage_max_samples=10,
            coverage_sample_max_bytes=4096,
            coverage_stale_after_seconds=120,
            coverage_holy_stream_maxlen=10000,
        )
        handlers = {}
        servers = []
        ready = asyncio.Event()

        def start_server(port, *, registry):
            result = start_http_server(port, addr="127.0.0.1", registry=registry)
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
            task = asyncio.create_task(run(settings))
            try:
                await asyncio.wait_for(ready.wait(), timeout=5)
                body = await asyncio.to_thread(fetch_metrics)
                self.assertIn(b"holycluster_coverage_identity_window_seconds 60.0", body)
                self.assertIn(b"holycluster_coverage_pending_windows", body)
                self.assertIn(b'holycluster_coverage_comparison_eligible{service="dxsummit"} 0.0', body)
                handlers[signal.SIGTERM]()
                await asyncio.wait_for(task, timeout=5)
                self.assertFalse(servers[0].socket.fileno() >= 0)
            finally:
                if not task.done():
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)
