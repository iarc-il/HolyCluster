import unittest
from unittest.mock import patch

from api.main import health


class FakeSession:
    def __init__(self):
        self.statement = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, statement):
        self.statement = statement


class HealthTest(unittest.IsolatedAsyncioTestCase):
    async def test_health_queries_spot_schema(self):
        session = FakeSession()
        with patch("api.main.async_session", new=lambda: session):
            self.assertEqual(await health(), {"status": "ok"})

        self.assertIn("holy_spots2", str(session.statement))
