import unittest
from datetime import datetime
from unittest.mock import patch

from sqlalchemy.dialects import postgresql

from api.main import build_propagation_measurement_rows, upsert_propagation_history


class FakeSession:
    def __init__(self):
        self.statement = None
        self.committed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, statement):
        self.statement = statement

    async def commit(self):
        self.committed = True


class PropagationPersistenceTest(unittest.TestCase):
    def test_build_propagation_measurement_rows_flattens_metric_samples(self):
        collected_at = datetime(2026, 6, 16, 12)

        rows = build_propagation_measurement_rows(
            {
                "k_index": [
                    {"value": 2, "timestamp": "1780000000"},
                    {"error": "no data"},
                ],
                "a_index": [{"value": 7, "timestamp": 1780003600}],
                "sfi": [],
            },
            collected_at,
        )

        self.assertEqual(
            rows,
            [
                {
                    "metric": "k_index",
                    "timestamp": 1780000000,
                    "value": 2.0,
                    "collected_at": collected_at,
                },
                {
                    "metric": "a_index",
                    "timestamp": 1780003600,
                    "value": 7.0,
                    "collected_at": collected_at,
                },
            ],
        )


class PropagationPersistenceAsyncTest(unittest.IsolatedAsyncioTestCase):
    async def test_upsert_propagation_history_uses_conflict_update(self):
        fake_session = FakeSession()

        with patch("api.main.async_session", new=lambda: fake_session):
            count = await upsert_propagation_history(
                {
                    "k_index": [{"value": 2, "timestamp": 1780000000}],
                    "a_index": [],
                    "sfi": [],
                }
            )

        compiled = str(fake_session.statement.compile(dialect=postgresql.dialect()))

        self.assertEqual(count, 1)
        self.assertTrue(fake_session.committed)
        self.assertIn("ON CONFLICT (metric, timestamp) DO UPDATE", compiled)
        self.assertIn("collected_at = excluded.collected_at", compiled)

    async def test_upsert_propagation_history_skips_empty_history(self):
        with patch("api.main.async_session", side_effect=AssertionError("session should not be opened")):
            count = await upsert_propagation_history({"k_index": [], "a_index": [], "sfi": []})

        self.assertEqual(count, 0)


if __name__ == "__main__":
    unittest.main()
