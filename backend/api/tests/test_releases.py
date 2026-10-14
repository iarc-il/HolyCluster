import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from api.main import (
    app,
    catserver_release,
    download_catserver_artifact,
    download_catserver,
    download_catserver_release,
    latest_catserver,
    latest_catserver_release,
)


FIXTURES = Path(__file__).resolve().parents[2] / "shared/artifact-validator/fixtures"


class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.release_dir = Path(self.temp_dir.name)
        self.artifacts_dir = self.release_dir / "artifacts"
        self.artifacts_dir.mkdir()
        self.windows_content = (FIXTURES / "valid-windows.msi").read_bytes()
        self.linux_content = (FIXTURES / "valid-linux.AppImage").read_bytes()
        self.windows = self.write_artifact("catserver-v1.2.3-windows-x86_64.msi", self.windows_content)
        self.linux = self.write_artifact("catserver-v1.2.3-linux-x86_64.AppImage", self.linux_content)
        self.write_manifest([self.windows, self.linux])
        self.settings_patch = patch("api.main.settings.catserver_msi_dir", self.release_dir)
        self.settings_patch.start()

    def tearDown(self):
        self.settings_patch.stop()
        self.temp_dir.cleanup()

    def write_artifact(self, name, content):
        (self.artifacts_dir / name).write_bytes(content)
        return {
            "version": "catserver-v1.2.3",
            "platform": "windows" if name.endswith(".msi") else "linux",
            "architecture": "x86_64",
            "artifact": {
                "location": f"/catserver/artifacts/{name}",
                "name": name,
                "sha256": hashlib.sha256(content).hexdigest(),
                "size": len(content),
            },
        }

    def write_manifest(self, releases):
        (self.release_dir / "latest.json").write_text(json.dumps({"schema_version": 1, "releases": releases}))

    def test_structured_manifest_addresses_windows_and_linux(self):
        manifest = latest_catserver_release()

        self.assertEqual(manifest["schema_version"], 1)
        self.assertEqual(catserver_release("windows", "x86_64"), self.windows)
        self.assertEqual(catserver_release("linux", "x86_64"), self.linux)

    def test_legacy_windows_endpoints_use_structured_manifest(self):
        self.assertEqual(latest_catserver(), self.windows["artifact"]["name"])

        response = download_catserver()
        self.assertEqual(response.path, str(self.artifacts_dir / self.windows["artifact"]["name"]))
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_platform_download_endpoint_uses_matching_artifact(self):
        windows = download_catserver_release("windows", "x86_64")
        linux = download_catserver_release("linux", "x86_64")

        self.assertEqual(windows.path, str(self.artifacts_dir / self.windows["artifact"]["name"]))
        self.assertEqual(linux.path, str(self.artifacts_dir / self.linux["artifact"]["name"]))
        self.assertEqual(windows.headers["cache-control"], "no-store")
        self.assertEqual(linux.headers["cache-control"], "no-store")

    def test_download_cache_policy_preserves_bytes_and_download_headers(self):
        client = TestClient(app)
        for release, content in ((self.windows, self.windows_content), (self.linux, self.linux_content)):
            routes = [
                (f"/catserver/download/{release['platform']}/{release['architecture']}", "no-store"),
                (release["artifact"]["location"], "no-store"),
            ]
            if release == self.windows:
                routes.append(("/catserver/download", "no-store"))
            for route, cache_control in routes:
                with self.subTest(route=route):
                    response = client.get(route)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.headers["cache-control"], cache_control)
                    self.assertEqual(response.content, content)
                    self.assertEqual(response.headers["content-type"], "application/octet-stream")
                    filename = release["artifact"]["name"].replace("catserver", "HolyCluster")
                    self.assertEqual(response.headers["content-disposition"], f'attachment; filename="{filename}"')

    def test_download_rejects_unknown_and_traversal_artifacts(self):
        for name in ("missing.msi", "../latest.json"):
            with self.assertRaises(HTTPException) as raised:
                download_catserver_artifact(name)
            self.assertEqual(raised.exception.status_code, 404)

    def test_download_rejects_artifact_that_does_not_match_manifest(self):
        path = self.artifacts_dir / self.windows["artifact"]["name"]
        path.write_bytes(b"modified installer")

        with self.assertRaises(HTTPException) as raised:
            download_catserver()
        self.assertEqual(raised.exception.status_code, 404)

    def test_release_metadata_and_errors_cannot_be_cached(self):
        client = TestClient(app)
        for route, status in (
            ("/catserver/releases/latest", 200),
            ("/catserver/releases/windows/x86_64", 200),
            ("/catserver/latest", 200),
            ("/catserver/artifacts/missing.msi", 404),
            ("/catserver/releases/missing/x86_64", 404),
        ):
            with self.subTest(route=route):
                response = client.get(route, headers={"If-None-Match": '"stale"'})
                self.assertEqual(response.status_code, status)
                self.assertEqual(response.headers["cache-control"], "no-store")
                self.assertNotIn("etag", response.headers)
                self.assertNotIn("last-modified", response.headers)
        self.write_manifest([{"version": "broken"}])
        response = client.get("/catserver/releases/latest")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_matching_checksum_cannot_disguise_an_appimage_as_an_msi(self):
        self.windows = self.write_artifact(self.windows["artifact"]["name"], self.linux_content)
        self.write_manifest([self.windows, self.linux])
        response = TestClient(app).get(self.windows["artifact"]["location"])
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertNotEqual(response.content, self.linux_content)

    def test_package_version_must_match_the_manifest(self):
        self.windows["version"] = "catserver-v1.2.4"
        self.write_manifest([self.windows, self.linux])
        with self.assertRaises(HTTPException):
            download_catserver()

    def test_malformed_manifest_is_unavailable(self):
        self.write_manifest([{"version": "catserver-v1.2.3", "platform": "windows"}])

        with self.assertRaises(HTTPException) as raised:
            latest_catserver_release()
        self.assertEqual(raised.exception.status_code, 503)
