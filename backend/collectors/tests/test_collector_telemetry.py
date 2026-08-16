import asyncio
import os
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from collectors import utils

SETTINGS_ENV = {
    "POSTGRES_USER": "test",
    "POSTGRES_PASSWORD": "test",
    "POSTGRES_HOST": "test",
    "POSTGRES_PORT": "1",
    "POSTGRES_HOST_LOCAL": "test",
    "POSTGRES_PORT_LOCAL": "1",
    "QRZ_USER": "test",
    "QRZ_PASSWORD": "test",
    "QRZ_API_KEY": "test",
    "SENTRY_ENVIRONMENT": "dev",
    "SENTRY_RELEASE": "test",
    "VALKEY_HOST": "test",
    "VALKEY_PORT": "1",
    "VALKEY_HOST_LOCAL": "test",
    "VALKEY_PORT_LOCAL": "1",
    "USERNAME_FOR_TELNET_CLUSTERS": "test",
}


class JsonCollectorTelemetryTest(IsolatedAsyncioTestCase):
    async def test_poll_failure_reports_to_sentry_and_monitor(self):
        error = RuntimeError("source failed for K1ABC at FN31")
        valkey_client = object()
        monitor_event = AsyncMock()
        captured = []

        with (
            patch.dict(os.environ, SETTINGS_ENV, clear=True),
            patch("collectors.db.valkey_config.get_valkey_client", return_value=valkey_client),
            patch("collectors.utils.fetch_json_list", side_effect=error),
            patch("collectors.utils.set_value", AsyncMock()) as set_value,
            patch("collectors.utils.capture_exception", side_effect=lambda error, **kwargs: captured.append(error)),
            patch("collectors.utils.push_exception_event", monitor_event),
            patch("collectors.utils.asyncio.sleep", side_effect=asyncio.CancelledError),
        ):
            with self.assertRaises(asyncio.CancelledError):
                await utils.run_json_spot_collector(
                    asyncio.Queue(),
                    source_label="test",
                    metric_name="test",
                    url="https://example.invalid/spots",
                    poll_interval=1,
                    request_timeout=1,
                    spot_expiration=1,
                    get_spot_key=lambda spot: "test",
                    parse_spot=lambda spot: spot,
                    sort_key=lambda spot: 0,
                )

        set_value.assert_awaited_once_with(valkey_client, "collector:test:connected", 0)
        self.assertEqual(captured, [error])
        monitor_event.assert_awaited_once_with(valkey_client, "collector", "test: source failed for K1ABC at FN31")
