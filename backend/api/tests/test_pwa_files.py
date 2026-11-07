import unittest

from fastapi.testclient import TestClient

from api.main import app


class PwaFilesTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_manifest_is_served_as_a_manifest(self):
        response = self.client.get("/manifest.webmanifest")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "application/manifest+json")
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.json()["name"], "HolyCluster")

    def test_icons_are_served_as_pngs(self):
        for path in (
            "/icons/holycluster-192.png",
            "/icons/holycluster-512.png",
            "/icons/holycluster-maskable-512.png",
        ):
            with self.subTest(path=path):
                response = self.client.get(path)

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["content-type"], "image/png")
                self.assertTrue(response.content.startswith(b"\x89PNG\r\n\x1a\n"))
