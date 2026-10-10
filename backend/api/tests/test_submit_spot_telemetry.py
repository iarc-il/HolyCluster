from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

from api import submit_spot


class SubmitSpotTelemetryTest(IsolatedAsyncioTestCase):
    async def test_unexpected_submit_failure_reports_to_sentry(self):
        error = RuntimeError("cluster rejected K1ABC from FN31")
        captured = []

        def capture_exception(error, **kwargs):
            captured.append((error, kwargs))

        with (
            patch("api.submit_spot.submit_spot_with_retries", side_effect=error),
            patch("api.submit_spot.capture_exception", side_effect=capture_exception),
        ):
            response = await submit_spot.handle_spot({"dx_callsign": "K1ABC", "frequency": 14074})

        self.assertEqual(response["status"], "failure")
        self.assertEqual(captured, [(error, {"operation": "api.submit_spot"})])
