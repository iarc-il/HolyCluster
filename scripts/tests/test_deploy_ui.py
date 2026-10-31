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
        (binary / "rm").write_text(
            "#!/usr/bin/env python3\n"
            "import os, sys\n"
            "if os.environ.get('FAIL_PRUNE_ASSET') and sys.argv[-1].endswith('/assets/' + os.environ['FAIL_PRUNE_ASSET']): sys.exit(93)\n"
            f"os.execv({shutil.which('rm')!r}, ['rm', *sys.argv[1:]])\n"
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

    def diagnostics(self):
        directory = self.target / ".ui-deployments"
        plans = sorted(directory.glob("*.json"))
        self.assertTrue(plans)
        return [
            (json.loads(plan.read_text()), [json.loads(line) for line in
             plan.with_suffix(".jsonl").read_text().splitlines()])
            for plan in plans
        ]

    def test_diagnostics_without_pruning(self):
        self.env["VITE_SENTRY_RELEASE"] = "v1.2.3"
        result = self.deploy(1, ("one.js", "shared.js"))
        self.assertEqual(result.returncode, 0, result.stderr)
        [(plan, events)] = self.diagnostics()
        self.assertEqual(plan["build"], f"{1:040x}")
        self.assertEqual(plan["release"], "v1.2.3")
        self.assertEqual(plan["published_assets"], ["assets/one.js", "assets/shared.js"])
        self.assertEqual(plan["retained_assets"], ["assets/legacy.js", "assets/one.js", "assets/shared.js"])
        self.assertEqual(plan["prune_candidates"], [])
        self.assertEqual([event["event"] for event in events], ["deployment_started", "publication_started", "published", "cleanup_completed"])
        self.assertGreater(events[2]["timestamp"], 0)
        self.assertEqual(len(plan["index_sha256"]), 64)
        self.assertNotIn(str(self.target), json.dumps(plan))
        directory = self.target / ".ui-deployments"
        self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
        self.assertTrue(all(file.stat().st_mode & 0o777 == 0o600 for file in directory.iterdir()))
        summaries = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{"event":')]
        self.assertEqual(len(summaries), 1)
        self.assertEqual(summaries[0]["attempt"], plan["attempt"])
        first_attempt = plan["attempt"]
        self.assertEqual(self.deploy(1, ("one.js", "shared.js")).returncode, 0)
        self.assertEqual(len(self.diagnostics()), 2)
        self.assertEqual(len({plan["attempt"] for plan, _ in self.diagnostics()}), 2)
        self.assertTrue(any(plan["attempt"] == first_attempt for plan, _ in self.diagnostics()))

    def test_diagnostics_record_actual_pruning_and_survive_retention(self):
        self.assertEqual(self.deploy(1, ("one.js", "obsolete.js", "shared.js")).returncode, 0)
        for number in range(2, 5):
            self.age_manifests()
            self.assertEqual(self.deploy(number).returncode, 0)
        (self.target / "assets/one.js").unlink()
        self.age_manifests()
        result = self.deploy(5)
        self.assertEqual(result.returncode, 0, result.stderr)
        records = self.diagnostics()
        self.assertEqual(len(records), 5)
        plan, events = next((plan, events) for plan, events in records if plan["build"] == f"{5:040x}")
        self.assertEqual(plan["prune_candidates"], ["assets/obsolete.js", "assets/one.js"])
        self.assertEqual([event["asset"] for event in events if event["event"] == "asset_pruned"], ["assets/obsolete.js"])
        self.assertNotIn(f"{1:040x}", plan["retained_releases"])
        legacy_events = [event for _, events in records for event in events if event["event"] == "asset_pruned"]
        self.assertEqual(sorted(event["asset"] for event in legacy_events), ["assets/legacy.js", "assets/obsolete.js"])
        self.assertFalse((self.target / "assets/legacy.js").exists())
        self.assertTrue((self.target / "assets/shared.js").exists())

    def test_diagnostics_do_not_report_failed_publication_as_success(self):
        result = self.deploy(1, fail="before-index")
        self.assertNotEqual(result.returncode, 0)
        [(plan, events)] = self.diagnostics()
        self.assertEqual([event["event"] for event in events], ["deployment_started", "publication_started"])
        self.assertEqual((self.target / "index.html").read_text(), "previous index")
        self.assertEqual(plan["published_assets"], ["assets/shared.js"])

    def test_diagnostics_do_not_report_failed_deletion_as_pruned(self):
        self.env["KEEP_RELEASES"] = "1"
        self.assertEqual(self.deploy(1, ("obsolete.js",)).returncode, 0)
        self.age_manifests()
        self.env["FAIL_PRUNE_ASSET"] = "obsolete.js"
        result = self.deploy(2)
        self.assertNotEqual(result.returncode, 0)
        plan, events = next((plan, events) for plan, events in self.diagnostics() if plan["build"] == f"{2:040x}")
        self.assertEqual(plan["prune_candidates"], ["assets/legacy.js", "assets/obsolete.js"])
        self.assertEqual([event["asset"] for event in events if event["event"] == "asset_pruned"], ["assets/legacy.js"])
        self.assertFalse(any(event["event"] == "cleanup_completed" for event in events))
        self.assertTrue((self.target / "assets/obsolete.js").exists())
        self.assertEqual((self.target / "index.html").read_text(), "index 2")

    def test_rejects_symbolic_diagnostics_directory(self):
        outside = self.root / "outside"
        outside.mkdir()
        (self.target / ".ui-deployments").symlink_to(outside)
        self.assertNotEqual(self.deploy(1).returncode, 0)
        self.assertEqual(list(outside.iterdir()), [])
        self.assertEqual((self.target / "index.html").read_text(), "previous index")

    def test_diagnostics_record_upload_failure(self):
        self.assertNotEqual(self.deploy(1, fail="assets/").returncode, 0)
        [(_, events)] = self.diagnostics()
        self.assertEqual([event["event"] for event in events], ["deployment_started"])
        self.assertEqual((self.target / "index.html").read_text(), "previous index")

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
