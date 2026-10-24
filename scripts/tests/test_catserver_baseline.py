import functools
import hashlib
import http.server
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / ".github/scripts/catserver_baseline.py"
FIXTURES = ROOT / "backend/shared/artifact-validator/fixtures"
spec = importlib.util.spec_from_file_location("update_gate", ROOT / ".github/scripts/catserver_update_gate.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class BaselineTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.output = self.root / "baseline"
        self.requests = []
        requests = self.requests

        class Handler(http.server.SimpleHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                super().do_GET()

            def log_message(self, *args):
                pass

        self.server = http.server.ThreadingHTTPServer(
            ("127.0.0.1", 0), functools.partial(Handler, directory=str(self.root))
        )
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(thread.join)
        self.addCleanup(self.server.shutdown)
        self.origin = f"http://127.0.0.1:{self.server.server_port}"
        self.manifest_url = self.origin + "/catserver/releases/latest"
        self.manifest_path = self.root / "catserver/releases/latest"
        self.manifest_path.parent.mkdir(parents=True)
        artifact_dir = self.root / "catserver/artifacts"
        artifact_dir.mkdir()
        self.manifest = {"schema_version": 1, "releases": []}
        for platform, suffix in (("linux", "AppImage"), ("windows", "msi")):
            name = f"valid-{platform}.{suffix}"
            content = (FIXTURES / name).read_bytes()
            (artifact_dir / name).write_bytes(content)
            self.manifest["releases"].append(
                {
                    "version": "catserver-v1.2.3",
                    "platform": platform,
                    "architecture": "x86_64",
                    "artifact": {
                        "name": name,
                        "location": f"/catserver/artifacts/{name}",
                        "size": len(content),
                        "sha256": hashlib.sha256(content).hexdigest(),
                    },
                }
            )
        self.validator = os.environ.get("HOLY_ARTIFACT_VALIDATOR", "holy-artifact-validator")

    def run_snapshot(self, validator=None, raw_manifest=None):
        self.manifest_path.write_text(json.dumps(self.manifest) if raw_manifest is None else raw_manifest)
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--manifest-url",
                self.manifest_url,
                "--output-dir",
                str(self.output),
                "--validator",
                validator or self.validator,
            ],
            capture_output=True,
            text=True,
            check=False,
        )

    def assert_failed(self, result):
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertFalse((self.output / "baseline.json").exists())

    def test_snapshots_and_inspects_both_packages(self):
        result = self.run_snapshot()
        self.assertEqual(result.returncode, 0, result.stderr)
        descriptor = json.loads((self.output / "baseline.json").read_text())
        self.assertEqual(descriptor["schema_version"], 1)
        snapshot = (self.output / descriptor["manifest"]["path"]).read_bytes()
        self.assertEqual(snapshot, self.manifest_path.read_bytes())
        self.assertEqual(descriptor["manifest"]["sha256"], hashlib.sha256(snapshot).hexdigest())
        self.assertEqual(descriptor["manifest"]["url"], self.manifest_url)
        self.assertEqual(len(descriptor["releases"]), 2)
        for release, expected in zip(descriptor["releases"], self.manifest["releases"]):
            for key, value in expected.items():
                self.assertEqual(release[key], value)
            content = (self.output / release["path"]).read_bytes()
            self.assertEqual(hashlib.sha256(content).hexdigest(), expected["artifact"]["sha256"])
            self.assertEqual(release["url"], self.origin + expected["artifact"]["location"])
        self.assertEqual(self.requests.count("/catserver/releases/latest"), 1)
        self.assertEqual(len(self.requests), 3)

    def test_snapshot_reaches_both_gate_scenarios(self):
        result = self.run_snapshot()
        self.assertEqual(result.returncode, 0, result.stderr)
        descriptor_path = self.output / "baseline.json"
        descriptor_bytes = descriptor_path.read_bytes()
        descriptor = json.loads(descriptor_bytes)
        packages = {release["platform"]: self.output / release["path"] for release in descriptor["releases"]}
        linux = self.root / "candidate.AppImage"
        windows = self.root / "candidate.msi"
        shutil.copyfile(FIXTURES / "valid-linux.AppImage", linux)
        shutil.copyfile(FIXTURES / "valid-windows.msi", windows)
        attestation = self.root / "attestation.json"
        commands = []

        def run_scenario(command, **kwargs):
            self.assertEqual(command[:2], ["node", "ui/scripts/linux_update_product.mjs"])
            commands.append(command)
            return 0

        with patch.object(gate.subprocess, "call", side_effect=run_scenario):
            self.assertTrue(gate.run(self.output, linux, windows, "catserver-v1.2.3", self.root, attestation))
        self.assertEqual(
            commands,
            [
                [
                    "node",
                    "ui/scripts/linux_update_product.mjs",
                    "--baseline",
                    str(packages["linux"]),
                    "--candidate",
                    str(linux),
                    "--version",
                    "catserver-v1.2.3",
                    "--dist",
                    str(self.root),
                    "--scenario",
                    scenario,
                ]
                for scenario in ("update", "corrupt-download")
            ],
        )
        self.assertEqual(descriptor_path.read_bytes(), descriptor_bytes)
        self.assertEqual(json.loads(attestation.read_text())["baseline"], descriptor["releases"])
        gate.verify(attestation, linux, windows, "catserver-v1.2.3")

    def test_changed_snapshot_stops_gate_before_scenarios(self):
        result = self.run_snapshot()
        self.assertEqual(result.returncode, 0, result.stderr)
        descriptor = json.loads((self.output / "baseline.json").read_bytes())
        packages = {release["platform"]: self.output / release["path"] for release in descriptor["releases"]}
        attestation = self.root / "attestation.json"
        for platform, package in packages.items():
            with self.subTest(platform=platform):
                original = package.read_bytes()
                package.write_bytes(bytes([original[0] ^ 1]) + original[1:])
                with patch.object(gate.subprocess, "call") as call:
                    with self.assertRaisesRegex(ValueError, "Baseline bytes differ from snapshot"):
                        gate.run(
                            self.output,
                            packages["linux"],
                            packages["windows"],
                            "catserver-v1.2.3",
                            self.root,
                            attestation,
                        )
                    call.assert_not_called()
                self.assertFalse(attestation.exists())
                package.write_bytes(original)

    def test_rejects_missing_and_malformed_targets_before_download(self):
        original = json.loads(json.dumps(self.manifest))
        for mutation in ("missing", "duplicate", "schema", "size", "sha256", "location", "architecture"):
            with self.subTest(mutation=mutation):
                self.manifest = json.loads(json.dumps(original))
                release = self.manifest["releases"][0]
                if mutation == "missing":
                    self.manifest["releases"].pop()
                elif mutation == "duplicate":
                    self.manifest["releases"].append(release)
                elif mutation == "schema":
                    self.manifest["schema_version"] = 2
                elif mutation == "architecture":
                    release["architecture"] = "aarch64"
                else:
                    release["artifact"][mutation] = {
                        "size": True,
                        "sha256": "invalid",
                        "location": "https://other.invalid/package",
                    }[mutation]
                self.requests.clear()
                self.assert_failed(self.run_snapshot())
                self.assertEqual(self.requests, ["/catserver/releases/latest"])
                shutil.rmtree(self.output, ignore_errors=True)

    def test_rejects_invalid_json(self):
        self.assert_failed(self.run_snapshot(raw_manifest="{invalid"))
        self.assertEqual(self.requests, ["/catserver/releases/latest"])

    def test_rejects_size_and_digest_mismatches(self):
        size = self.manifest["releases"][0]["artifact"]["size"]
        for field, value in (("size", 1), ("size", size + 1), ("sha256", "0" * 64)):
            with self.subTest(field=field):
                artifact = self.manifest["releases"][0]["artifact"]
                original = artifact[field]
                artifact[field] = value
                result = self.run_snapshot()
                self.assert_failed(result)
                self.assertIn("does not match release manifest", result.stderr)
                artifact[field] = original
                shutil.rmtree(self.output, ignore_errors=True)

    def test_rejects_package_identity_mismatch(self):
        self.manifest["releases"][0]["version"] = "catserver-v1.2.4"
        result = self.run_snapshot()
        self.assert_failed(result)
        self.assertIn("Invalid release package", result.stderr)

    def test_rejects_missing_validator(self):
        result = self.run_snapshot(validator=str(self.root / "missing-validator"))
        self.assert_failed(result)
        self.assertIn("validator is unavailable", result.stderr)

    def test_rejects_http_failure(self):
        (self.root / "catserver/artifacts/valid-windows.msi").unlink()
        self.assert_failed(self.run_snapshot())

    def test_does_not_reuse_an_existing_baseline(self):
        result = self.run_snapshot()
        self.assertEqual(result.returncode, 0, result.stderr)
        before = (self.output / "baseline.json").read_bytes()
        result = self.run_snapshot()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.output / "baseline.json").read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
