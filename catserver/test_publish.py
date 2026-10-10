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


class PublishTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.bin_dir = self.root / "bin"
        self.bin_dir.mkdir()
        self.remote_dir = self.root / "remote"
        self.remote_dir.mkdir()
        self.write_command(
            "scp",
            """#!/usr/bin/env bash
set -euo pipefail
source=$1
destination=${2#*:}
mkdir -p "$(dirname "$destination")"
cp "$source" "$destination"
""",
        )
        self.write_command(
            "ssh",
            """#!/usr/bin/env bash
set -euo pipefail
shift
"$@"
""",
        )
        self.windows = self.write_artifact("HolyCluster.msi", b"windows installer")
        self.linux = self.write_artifact("HolyCluster.AppImage", b"linux appimage")

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

    def test_publishes_platform_artifacts_and_manifest_atomically(self):
        environment = {**os.environ, "PATH": f"{self.bin_dir}:{os.environ['PATH']}"}
        subprocess.run(
            [
                sys.executable,
                str(PUBLISH_SCRIPT),
                "--deploy-user",
                "deploy",
                "--deploy-host",
                "host",
                "--remote-artifact-dir",
                str(self.remote_dir),
                "--version",
                "catserver-v1.2.3",
                "--artifact",
                f"windows:x86_64:{self.windows}:catserver-v1.2.3-windows-x86_64.msi",
                "--artifact",
                f"linux:x86_64:{self.linux}:catserver-v1.2.3-linux-x86_64.AppImage",
            ],
            check=True,
            env=environment,
        )

        manifest = json.loads((self.remote_dir / "latest.json").read_text())
        self.assertEqual(manifest["schema_version"], 1)
        self.assertEqual(
            {(release["platform"], release["architecture"]) for release in manifest["releases"]},
            {("windows", "x86_64"), ("linux", "x86_64")},
        )
        for release in manifest["releases"]:
            artifact = release["artifact"]
            published = self.remote_dir / "artifacts" / artifact["name"]
            self.assertTrue(published.is_file())
            self.assertEqual(hashlib.sha256(published.read_bytes()).hexdigest(), artifact["sha256"])
            self.assertEqual(published.stat().st_size, artifact["size"])
            self.assertEqual(
                (self.remote_dir / "artifacts" / f"{artifact['name']}.sha256").read_text(),
                f"{artifact['sha256']}  {artifact['name']}\n",
            )


if __name__ == "__main__":
    unittest.main()
