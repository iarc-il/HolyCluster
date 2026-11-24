import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from api.main import app


class FakeSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, statement):
        pass


class HeadRequestsTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_index_answers_head(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "index.html").write_text("<!doctype html>")
            with patch("api.main.settings.ui_dist_path", Path(directory)):
                response = self.client.head("/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "text/html; charset=utf-8")
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.content, b"")

    def test_health_answers_head(self):
        with patch("api.main.async_session", new=FakeSession):
            response = self.client.head("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"")
