import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "deploy_ui.sh"


class DeployUiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / "ui/dist"
        self.target = self.root / "site"
        binary = self.root / "bin"
        for directory in (self.source / "assets", self.target / "assets", binary):
            directory.mkdir(parents=True)
        (self.target / "index.html").write_text("previous index")
        (self.target / "assets/legacy.js").write_text("legacy")
        (binary / "rsync").write_text(
            "#!/usr/bin/env python3\n"
            "import os, signal, sys\n"
            "with open(os.environ['UPLOAD_LOG'], 'a') as log: log.write(sys.argv[-2] + '\\n')\n"
            "args = [arg.removeprefix('user@host:') for arg in sys.argv[1:]]\n"
            "if os.environ.get('FAIL_MATCH') == 'disconnect':\n"
            "    os.kill(os.getppid(), signal.SIGKILL)\n"
            "    sys.exit(23)\n"
            "if os.environ.get('FAIL_MATCH') and os.environ['FAIL_MATCH'] in args[-2]: sys.exit(23)\n"
            f"os.execv({shutil.which('rsync')!r}, ['rsync', *args])\n"
        )
        (binary / "mv").write_text(
            "#!/usr/bin/env python3\n"
            "import os, subprocess, sys\n"
            "index = sys.argv[-1].endswith('/index.html')\n"
            "failure = os.environ.get('FAIL_MATCH')\n"
            "if index and failure == 'before-index': sys.exit(91)\n"
            f"subprocess.run([{shutil.which('mv')!r}, *sys.argv[1:]], check=True)\n"
            "if index and failure == 'after-index': sys.exit(92)\n"
        )
        (binary / "ssh").write_text('#!/bin/sh\nshift\nprintf "%s\\n" "$*" >> "$SSH_LOG"\nexec sh -c "$*"\n')
        for executable in binary.iterdir():
            executable.chmod(0o755)
        self.env = {
            **os.environ, "PATH": f"{binary}:{os.environ['PATH']}",
            "UPLOAD_LOG": str(self.root / "uploads"), "SSH_LOG": str(self.root / "ssh"),
        }

    def deploy(self, number, assets=("shared.js",), fail="", release=None):
        for file in (self.source / "assets").iterdir():
            file.unlink()
        for asset in assets:
            (self.source / "assets" / asset).write_text(asset)
        (self.source / "index.html").write_text(f"index {number}")
        return subprocess.run(
            ["bash", str(SCRIPT), "user", "host", str(self.target), release or f"{number:040x}"],
            cwd=self.root, env={**self.env, "FAIL_MATCH": fail}, capture_output=True, text=True,
        )

    def age_manifests(self):
        for file in (self.target / ".ui-releases").glob("*.json"):
            data = json.loads(file.read_text())
            data["published_at"] -= 8 * 86400
            file.write_text(json.dumps(data))

    def test_retention_and_migration(self):
        self.assertEqual(self.deploy(1, ("one.js", "shared.js")).returncode, 0)
        self.assertTrue((self.target / "assets/legacy.js").exists())
        for number in range(2, 7):
            self.age_manifests()
            result = self.deploy(number)
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.target / "assets/one.js").exists())
        self.assertFalse((self.target / "assets/legacy.js").exists())
        self.assertTrue((self.target / "assets/shared.js").exists())
        self.assertEqual(len(list((self.target / ".ui-releases").glob("*.json"))), 4)

    def test_newest_four_successful_releases_ignore_legacy_baseline(self):
        for number in range(1, 5):
            if number > 1:
                self.age_manifests()
            result = self.deploy(number, (f"{number}.js",))
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.target / "assets/1.js").exists())
        self.assertFalse((self.target / "assets/legacy.js").exists())

    def test_upload_order_and_abandoned_deployment_cleanup(self):
        self.assertEqual(self.deploy(1).returncode, 0)
        self.assertNotEqual(self.deploy(2, ("abandoned.js",), fail="index.html").returncode, 0)
        self.assertTrue((self.target / "assets/abandoned.js").exists())
        self.assertEqual(self.deploy(3).returncode, 0)
        self.assertFalse((self.target / "assets/abandoned.js").exists())
        uploads = (self.root / "uploads").read_text().splitlines()
        assets = uploads.index("ui/dist/assets/")
        metadata = next(index for index, name in enumerate(uploads) if name.endswith("/metadata/"))
        index = uploads.index("ui/dist/index.html")
        self.assertLess(assets, metadata)
        self.assertLess(metadata, index)

    def test_does_not_scan_or_delete_unknown_files_after_migration(self):
        self.assertEqual(self.deploy(1).returncode, 0)
        unknown = self.target / "assets/unrelated.js"
        unknown.write_text("unrelated")
        outside = self.root / "outside"
        outside.write_text("outside")
        (self.target / "assets/link").symlink_to(outside)
        for number in range(2, 7):
            self.age_manifests()
            self.assertEqual(self.deploy(number).returncode, 0)
        self.assertTrue(unknown.exists())
        self.assertEqual(outside.read_text(), "outside")

    def test_uses_only_posix_shell_remotely(self):
        self.assertEqual(self.deploy(1).returncode, 0)
        commands = (self.root / "ssh").read_text()
        self.assertNotIn("python", commands)
        self.assertNotIn("flock", commands)
        self.assertNotIn("docker", commands)

    def test_lock_releases_when_the_runner_is_killed(self):
        result = self.deploy(1, fail="disconnect")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.target / ".ui-deploy-lock").exists())
        self.assertEqual((self.target / "index.html").read_text(), "previous index")
        self.assertEqual(self.deploy(1).returncode, 0)

    def test_stale_lock_fails_closed(self):
        lock = self.target / ".ui-deploy-lock"
        lock.mkdir()
        self.assertNotEqual(self.deploy(1).returncode, 0)
        self.assertTrue(lock.is_dir())
        self.assertEqual((self.target / "index.html").read_text(), "previous index")
        lock.rmdir()
        self.assertEqual(self.deploy(1).returncode, 0)
        self.assertFalse(lock.exists())

    def test_interrupted_publication_keeps_release_assets(self):
        self.assertEqual(self.deploy(1).returncode, 0)
        result = self.deploy(2, ("active.js",), fail="after-index")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.target / "index.html").read_text(), "index 2")
        self.assertTrue((self.target / ".ui-releases" / f"{2:040x}.json").exists())
        self.assertFalse((self.target / ".ui-deploy-lock").exists())
        self.age_manifests()
        self.assertEqual(self.deploy(3).returncode, 0)
        self.assertTrue((self.target / "assets/active.js").exists())
        record = json.loads((self.target / ".ui-releases" / f"{2:040x}.json").read_text())
        self.assertTrue(record["published"])

    def test_unpublished_manifests_do_not_displace_successful_releases(self):
        for number in range(1, 5):
            self.assertEqual(self.deploy(number, (f"{number}.js",)).returncode, 0)
        self.assertNotEqual(self.deploy(5, ("failed.js",), fail="before-index").returncode, 0)
        self.assertEqual((self.target / "index.html").read_text(), "index 4")
        self.age_manifests()
        self.assertEqual(self.deploy(6).returncode, 0)
        self.assertTrue((self.target / "assets/2.js").exists())
        self.assertFalse((self.target / "assets/1.js").exists())
        self.assertFalse((self.target / "assets/failed.js").exists())

    def test_rejects_symbolic_asset_targets(self):
        outside = self.root / "outside"
        outside.write_text("outside")
        (self.target / "assets/shared.js").symlink_to(outside)
        self.assertNotEqual(self.deploy(1).returncode, 0)
        self.assertEqual(outside.read_text(), "outside")
        self.assertEqual((self.target / "index.html").read_text(), "previous index")

    def test_recent_releases_exceed_minimum(self):
        for number in range(1, 7):
            result = self.deploy(number, (f"{number}.js",))
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.target / "assets/1.js").exists())
        self.assertEqual(len(list((self.target / ".ui-releases").glob("*.json"))), 7)

    def test_failure_keeps_index_and_releases(self):
        self.assertEqual(self.deploy(1).returncode, 0)
        before = list((self.target / ".ui-releases").glob("*.json"))
        for failure in ("assets/", "pending.json", "index.html"):
            result = self.deploy(2, fail=failure)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((self.target / "index.html").read_text(), "index 1")
            self.assertEqual(list((self.target / ".ui-releases").glob("*.json")), before)

    def test_rejects_release_and_manifest_paths(self):
        self.assertNotEqual(self.deploy(1, release="../bad").returncode, 0)
        self.assertEqual(self.deploy(1).returncode, 0)
        manifest = next((self.target / ".ui-releases").glob("*.json"))
        data = json.loads(manifest.read_text())
        data["assets"] = ["../index.html"]
        manifest.write_text(json.dumps(data))
        self.assertNotEqual(self.deploy(2).returncode, 0)
        self.assertEqual((self.target / "index.html").read_text(), "index 1")


if __name__ == "__main__":
    unittest.main()
