import importlib.util
import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = (
    Path(__file__).resolve().parents[2] / ".github/scripts/catserver_update_gate.py"
)
spec = importlib.util.spec_from_file_location("update_gate", SCRIPT)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class UpdateGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.linux = self.root / "candidate.AppImage"
        self.windows = self.root / "candidate.msi"
        self.linux.write_bytes(b"linux candidate")
        self.windows.write_bytes(b"windows candidate")
        self.baseline = self.root / "baseline"
        self.baseline.mkdir()
        releases = []
        for platform, suffix in (("linux", "AppImage"), ("windows", "msi")):
            artifact = self.baseline / f"baseline-{platform}.{suffix}"
            artifact.write_bytes(platform.encode())
            releases.append(
                {
                    "artifact": gate.identity(artifact),
                    "platform": platform,
                    "path": artifact.name,
                }
            )
        (self.baseline / "baseline.json").write_text(json.dumps({"releases": releases}))
        self.output = self.root / "attestation.json"

    def run_gate(self, codes=(0, 0)):
        with patch.object(gate.subprocess, "call", side_effect=codes) as call:
            result = gate.run(
                self.baseline,
                self.linux,
                self.windows,
                "catserver-v2",
                self.root,
                self.output,
            )
        self.assertEqual(call.call_count, 2)
        return result

    def test_extraction_mode_is_rejected_before_execution(self):
        with (
            patch.dict(gate.os.environ, {"APPIMAGE_EXTRACT_AND_RUN": "1"}),
            patch.object(gate.subprocess, "call", return_value=0) as call,
        ):
            with self.assertRaisesRegex(ValueError, "direct FUSE"):
                gate.run(
                    self.baseline,
                    self.linux,
                    self.windows,
                    "catserver-v2",
                    self.root,
                    self.output,
                )
            call.assert_not_called()

    def test_failure_is_recorded_and_rejected(self):
        self.assertFalse(self.run_gate((1, 0)))
        with self.assertRaises(ValueError):
            gate.verify(self.output, self.linux, self.windows, "catserver-v2")

    def test_changed_candidate_is_rejected(self):
        self.run_gate()
        for artifact in (self.linux, self.windows):
            original = artifact.read_bytes()
            artifact.write_bytes(b"changed")
            with self.assertRaises(ValueError):
                gate.verify(self.output, self.linux, self.windows, "catserver-v2")
            artifact.write_bytes(original)

    def test_wrong_version_and_missing_scenario_are_rejected(self):
        self.run_gate()
        with self.assertRaises(ValueError):
            gate.verify(self.output, self.linux, self.windows, "catserver-v3")
        data = json.loads(self.output.read_text())
        del data["scenarios"]["corrupt-download"]
        self.output.write_text(json.dumps(data))
        with self.assertRaises(ValueError):
            gate.verify(self.output, self.linux, self.windows, "catserver-v2")


class UpdateWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        workflow = SCRIPT.parents[1] / "workflows/catserver.yml"
        cls.text = workflow.read_text()
        sections = re.split(
            r"^  ([a-z][a-z-]+):\n",
            cls.text.split("\njobs:\n", 1)[1],
            flags=re.MULTILINE,
        )
        cls.jobs = dict(zip(sections[1::2], sections[2::2], strict=True))

    def step(self, job, command):
        matches = [
            step
            for step in re.split(r"(?=^      - )", self.jobs[job], flags=re.MULTILINE)
            if command in step
        ]
        self.assertEqual(len(matches), 1, command)
        return matches[0]

    def test_production_baseline_requires_package_validation(self):
        step = self.step("inspect-candidate-packages", "catserver_baseline.py")
        self.assertIn("if: startsWith(github.ref, 'refs/tags/')", step)
        self.assertIn("--validator", step)

    def test_product_scenarios_require_offline_direct_fuse(self):
        smoke = self.jobs["smoke-linux-release"]
        self.assertNotIn("APPIMAGE_EXTRACT_AND_RUN", self.text)
        command = "catserver_update_gate.py run"
        step = self.step("smoke-linux-release", command)
        for required in (
            "unshare --net",
            "setpriv",
            "xvfb-run",
            "--baseline",
            "--attestation",
        ):
            self.assertIn(required, step)
        self.assertIn("if: startsWith(github.ref, 'refs/tags/')", step)
        for required in (
            "test -c /dev/fuse",
            'ctypes.CDLL("libfuse.so.2")',
            'os.open("/dev/fuse", os.O_RDWR)',
            "TMPDIR=",
        ):
            self.assertIn(required, smoke)
        build = self.step("smoke-linux-release", "npm run build")
        self.assertIn("if: startsWith(github.ref, 'refs/tags/')", build)

    def test_aggregate_and_publication_fail_closed(self):
        aggregate = self.jobs["update-process-gate"]
        self.assertIn("if: always()", aggregate)
        self.assertIn(
            "needs: [inspect-candidate-packages, smoke-linux-release]", aggregate
        )
        self.assertIn("needs.inspect-candidate-packages.result", aggregate)
        self.assertIn("needs.smoke-linux-release.result", aggregate)
        self.assertIn('test "$BASELINE_RESULT" = success', aggregate)
        self.assertIn('test "$LINUX_RESULT" = success', aggregate)
        self.assertIn("name: Linux-update-attestation", aggregate)
        self.assertIn("test -s update-results/attestation.json", aggregate)
        self.assertIn("!startsWith(github.ref, 'refs/tags/')", aggregate)
        publish = self.jobs["publish-catserver"]
        self.assertIn("update-process-gate]", publish)
        self.assertIn(
            "if: startsWith(github.ref, 'refs/tags/')",
            self.step("publish-catserver", "catserver_update_gate.py verify"),
        )
        self.assertLess(
            publish.index("catserver_update_gate.py verify"),
            publish.index("catserver/publish.py"),
        )


if __name__ == "__main__":
    unittest.main()
