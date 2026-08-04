import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from api.main import (
    catserver_release,
    download_catserver_artifact,
    download_catserver,
    latest_catserver,
    latest_catserver_release,
)


class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.release_dir = Path(self.temp_dir.name)
        self.artifacts_dir = self.release_dir / "artifacts"
        self.artifacts_dir.mkdir()
        self.windows = self.write_artifact("catserver-v1.2.3-windows-x86_64.msi", b"windows installer")
        self.linux = self.write_artifact("catserver-v1.2.3-linux-x86_64.AppImage", b"linux appimage")
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
        self.assertEqual(response.headers["cache-control"], "public, max-age=31536000, immutable")

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

    def test_malformed_manifest_is_unavailable(self):
        self.write_manifest([{"version": "catserver-v1.2.3", "platform": "windows"}])

        with self.assertRaises(HTTPException) as raised:
            latest_catserver_release()
        self.assertEqual(raised.exception.status_code, 503)
