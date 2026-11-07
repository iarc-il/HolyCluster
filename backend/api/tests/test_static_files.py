import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from starlette.applications import Starlette
from starlette.routing import Mount

from api.static_files import ImmutableStaticFiles


class StaticFilesTest(unittest.TestCase):
    def test_assets_are_cached_immutably(self):
        with tempfile.TemporaryDirectory() as directory:
            asset = Path(directory) / "app-core-abc12345.js"
            asset.write_text("export const value = 1;")
            app = Starlette(routes=[Mount("/assets", app=ImmutableStaticFiles(directory=directory))])

            client = TestClient(app)
            response = client.get(f"/assets/{asset.name}")
            not_modified = client.get(
                f"/assets/{asset.name}",
                headers={"If-None-Match": response.headers["etag"]},
            )
            missing = client.get("/assets/missing.js")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "public, max-age=31536000, immutable")
        self.assertEqual(not_modified.status_code, 304)
        self.assertEqual(not_modified.headers["cache-control"], "public, max-age=31536000, immutable")
        self.assertNotIn("cache-control", missing.headers)
