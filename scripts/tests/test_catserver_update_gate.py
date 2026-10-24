import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / ".github/scripts/catserver_update_gate.py"
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
        for platform in ("linux", "windows"):
            artifact = self.baseline / platform
            artifact.write_bytes(platform.encode())
            releases.append({**gate.identity(artifact), "platform": platform,
                             "architecture": "x86_64", "version": "catserver-v1",
                             "path": platform})
        (self.baseline / "baseline.json").write_text(json.dumps({"releases": releases}))
        self.output = self.root / "attestation.json"

    def run_gate(self, codes=(0, 0)):
        with patch.object(gate.subprocess, "call", side_effect=codes) as call:
            result = gate.run(self.baseline, self.linux, self.windows, "catserver-v2",
                              self.root, self.output)
        self.assertEqual(call.call_count, 2)
        return result

    def test_pass_and_verify(self):
        self.assertTrue(self.run_gate())
        gate.verify(self.output, self.linux, self.windows, "catserver-v2")
        data = json.loads(self.output.read_text())
        self.assertEqual(set(data["scenarios"]), {"update", "corrupt-download"})
        self.assertEqual(len(data["baseline"]), 2)

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

    def test_changed_baseline_is_rejected_before_execution(self):
        (self.baseline / "linux").write_bytes(b"changed")
        with patch.object(gate.subprocess, "call") as call:
            with self.assertRaises(ValueError):
                gate.run(self.baseline, self.linux, self.windows, "catserver-v2",
                         self.root, self.output)
            call.assert_not_called()


if __name__ == "__main__":
    unittest.main()
