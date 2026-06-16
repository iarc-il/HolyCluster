import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from api.main import app, build_propagation_history_response, get_propagation_history_data


class FakeScalarResult:
    def __init__(self, samples):
        self.samples = samples

    def all(self):
        return self.samples

    def first(self):
        return self.samples[0] if self.samples else None


class FakeExecuteResult:
    def __init__(self, samples):
        self.samples = samples

    def scalars(self):
        return FakeScalarResult(self.samples)


class FakeSession:
    def __init__(self, execute_results):
        self.execute_results = list(execute_results)
        self.statements = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, statement):
        self.statements.append(statement)
        return FakeExecuteResult(self.execute_results.pop(0))


class PropagationHistoryResponseTest(unittest.TestCase):
    def test_build_propagation_history_response_groups_metrics(self):
        response = build_propagation_history_response(
            100,
            300,
            range_samples=[
                SimpleNamespace(metric="k_index", timestamp=200, value=2.0),
                SimpleNamespace(metric="a_index", timestamp=250, value=7.0),
            ],
            previous_samples=[
                SimpleNamespace(metric="k_index", timestamp=50, value=1.0),
                SimpleNamespace(metric="sfi", timestamp=80, value=118.0),
            ],
        )

        self.assertEqual(
            response,
            {
                "start_time": 100,
                "end_time": 300,
                "metrics": {
                    "a_index": [{"timestamp": 250, "value": 7.0}],
                    "k_index": [
                        {"timestamp": 50, "value": 1.0},
                        {"timestamp": 200, "value": 2.0},
                    ],
                    "sfi": [{"timestamp": 80, "value": 118.0}],
                },
            },
        )


class PropagationHistoryQueryTest(unittest.IsolatedAsyncioTestCase):
    async def test_get_propagation_history_data_includes_previous_sample_per_metric(self):
        fake_session = FakeSession(
            [
                [SimpleNamespace(metric="k_index", timestamp=200, value=2.0)],
                [
                    SimpleNamespace(metric="a_index", timestamp=90, value=7.0),
                    SimpleNamespace(metric="k_index", timestamp=80, value=1.0),
                ],
            ]
        )

        with patch("api.main.async_session", new=lambda: fake_session):
            response = await get_propagation_history_data(100, 300)

        self.assertEqual(len(fake_session.statements), 2)
        self.assertEqual(
            response["metrics"],
            {
                "a_index": [{"timestamp": 90, "value": 7.0}],
                "k_index": [
                    {"timestamp": 80, "value": 1.0},
                    {"timestamp": 200, "value": 2.0},
                ],
                "sfi": [],
            },
        )


class PropagationHistoryEndpointTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_propagation_history_endpoint_returns_range_data(self):
        payload = {
            "start_time": 100,
            "end_time": 300,
            "metrics": {"a_index": [], "k_index": [], "sfi": []},
        }
        mock_get_history = AsyncMock(return_value=payload)

        with patch("api.main.get_propagation_history_data", new=mock_get_history):
            response = self.client.get("/propagation/history", params={"start_time": 100, "end_time": 300})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), payload)
        mock_get_history.assert_awaited_once_with(100, 300)

    def test_propagation_history_endpoint_rejects_invalid_range(self):
        response = self.client.get("/propagation/history", params={"start_time": 300, "end_time": 100})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "end_time must be greater than start_time")

    def test_propagation_history_endpoint_rejects_ranges_over_24_hours(self):
        response = self.client.get("/propagation/history", params={"start_time": 100, "end_time": 86501})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "time range cannot exceed 24 hours")


if __name__ == "__main__":
    unittest.main()
