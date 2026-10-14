#!/usr/bin/env python3
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PUBLISH_SCRIPT = Path(__file__).with_name("publish.py")
FIXTURES = PUBLISH_SCRIPT.parent.parent / "backend/shared/artifact-validator/fixtures"


class PublishTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.bin_dir = self.root / "bin"
        self.bin_dir.mkdir()
        self.remote_dir = self.root / "remote"
        self.remote_dir.mkdir()
        self.write_command("scp", """#!/usr/bin/env bash
set -euo pipefail
source=$1
destination=${2#*:}
mkdir -p "$(dirname "$destination")"
cp "$source" "$destination"
""")
        self.write_command("ssh", """#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$PUBLISH_SSH_LOG"
shift
"$@"
""")
        self.windows = self.write_artifact("HolyCluster.msi", (FIXTURES / "valid-windows.msi").read_bytes())
        self.linux = self.write_artifact("HolyCluster.AppImage", (FIXTURES / "valid-linux.AppImage").read_bytes())

    def tearDown(self):
        self.temporary_directory.cleanup()

    def write_command(self, name, content):
        path = self.bin_dir / name
        path.write_text(content)
        path.chmod(0o755)

    def write_artifact(self, name, content):
        path = self.root / name
        path.write_bytes(content)
        return path

    def publish(self, version="catserver-v1.2.3", environment=None):
        env = {**os.environ, "PATH": f"{self.bin_dir}:{os.environ['PATH']}", "PUBLISH_SSH_LOG": str(self.root / "ssh.log")}
        env.update(environment or {})
        return subprocess.run([
            sys.executable, str(PUBLISH_SCRIPT), "--deploy-user", "deploy", "--deploy-host", "host",
            "--remote-artifact-dir", str(self.remote_dir), "--version", version,
            "--artifact", f"windows:x86_64:{self.windows}:{version}-windows-x86_64.msi",
            "--artifact", f"linux:x86_64:{self.linux}:{version}-linux-x86_64.AppImage",
        ], env=env, text=True, capture_output=True)

    def test_publishes_inspected_artifacts_and_manifest_atomically(self):
        result = self.publish()
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads((self.remote_dir / "latest.json").read_text())
        self.assertEqual(manifest["schema_version"], 1)
        self.assertEqual({(release["platform"], release["architecture"]) for release in manifest["releases"]},
                         {("windows", "x86_64"), ("linux", "x86_64")})
        for release in manifest["releases"]:
            artifact = release["artifact"]
            published = self.remote_dir / "artifacts" / artifact["name"]
            self.assertEqual(hashlib.sha256(published.read_bytes()).hexdigest(), artifact["sha256"])
            self.assertEqual(published.stat().st_size, artifact["size"])
            self.assertEqual((self.remote_dir / "artifacts" / f"{artifact['name']}.sha256").read_text(),
                             f"{artifact['sha256']}  {artifact['name']}\n")

    def test_swapped_bytes_fail_before_remote_access(self):
        self.windows.write_bytes(self.linux.read_bytes())
        result = self.publish()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Invalid release package", result.stderr)
        self.assertFalse((self.root / "ssh.log").exists())
        self.assertFalse((self.remote_dir / "latest.json").exists())

    def test_wrong_version_does_not_replace_an_active_release(self):
        result = self.publish()
        self.assertEqual(result.returncode, 0, result.stderr)
        before = (self.remote_dir / "latest.json").read_bytes()
        log = (self.root / "ssh.log").read_bytes()
        result = self.publish("catserver-v1.2.4")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.remote_dir / "latest.json").read_bytes(), before)
        self.assertEqual((self.root / "ssh.log").read_bytes(), log)

    def test_missing_inspector_fails_closed(self):
        result = self.publish(environment={"HOLY_ARTIFACT_VALIDATOR": "/missing/validator"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Package validator is unavailable", result.stderr)
        self.assertFalse((self.root / "ssh.log").exists())


if __name__ == "__main__":
    unittest.main()
