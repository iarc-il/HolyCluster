import asyncio
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from monitor import main


def test_main_initializes_monitor_sentry():
    with (
        patch("monitor.main.initialize_sentry") as initialize,
        patch("monitor.main.asyncio.run", side_effect=lambda coroutine: coroutine.close()) as run,
    ):
        main.main()

    initialize.assert_called_once_with(main.settings, "monitor")
    run.assert_called_once()


class MonitorTelemetryTest(IsolatedAsyncioTestCase):
    async def test_monitor_check_failure_reports_without_valkey_event(self):
        error = RuntimeError("monitor check failed")
        captured = []

        def capture_exception(error, **kwargs):
            captured.append((error, kwargs))

        settings = SimpleNamespace(
            monitor_enabled=True,
            valkey_effective_host="test",
            valkey_effective_port=1,
            valkey_db="0",
            telegram_bot_token="test",
            telegram_chat_id="test",
            instance_name="test",
            heartbeat_timeout=1,
            spot_flow_timeout=1,
            ws_url="ws://test",
            check_interval=1,
        )

        with (
            patch("monitor.main.settings", settings),
            patch("monitor.main.redis.asyncio.Redis"),
            patch("monitor.main.TelegramNotifier"),
            patch("monitor.main.check_metrics", AsyncMock(side_effect=error)),
            patch("monitor.main.check_websocket", AsyncMock(return_value=None)),
            patch("monitor.main.check_containers", AsyncMock(return_value=[])),
            patch("monitor.main.capture_exception", side_effect=capture_exception),
            patch("monitor.main.asyncio.sleep", side_effect=asyncio.CancelledError),
        ):
            with self.assertRaises(asyncio.CancelledError):
                await main.run_monitor()

        self.assertEqual(captured, [(error, {"operation": "monitor.metrics"})])
