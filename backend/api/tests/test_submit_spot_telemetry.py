from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from api import submit_spot


class SubmitSpotTelemetryTest(IsolatedAsyncioTestCase):
    async def test_unexpected_submit_failure_reports_to_sentry_and_monitor(self):
        error = RuntimeError("cluster rejected K1ABC from FN31")
        monitor_event = AsyncMock()
        captured = []

        def capture_exception(error, **kwargs):
            captured.append((error, kwargs))

        with (
            patch("api.submit_spot.submit_spot_with_retries", side_effect=error),
            patch("api.submit_spot.capture_exception", side_effect=capture_exception),
            patch("api.submit_spot.push_exception_event", monitor_event),
        ):
            response = await submit_spot.handle_spot({"dx_callsign": "K1ABC", "frequency": 14074}, object())

        self.assertEqual(response["status"], "failure")
        self.assertEqual(captured, [(error, {"operation": "api.submit_spot"})])
        monitor_event.assert_awaited_once()
