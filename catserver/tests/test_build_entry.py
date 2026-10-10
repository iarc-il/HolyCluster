"""Check the optional wrapper without running Cargo."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class CargoEntry(unittest.TestCase):
    def test_wrapper_forwards_arguments_and_caller_flags(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cargo = root / "cargo"
            cargo.write_text(
                "#!/usr/bin/env python3\n"
                "import json, os, sys\n"
                "print(json.dumps({'args': sys.argv[1:], 'cwd': os.getcwd(), "
                "'env': {key: os.environ.get(key) for key in "
                "['RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'CFLAGS', 'CXXFLAGS']}}))\n"
            )
            cargo.chmod(0o755)
            env = os.environ.copy()
            flags = {
                "RUSTFLAGS": "-C debuginfo=1",
                "CARGO_ENCODED_RUSTFLAGS": "-C\x1fdebuginfo=2",
                "CFLAGS": "-g -DTEST_C",
                "CXXFLAGS": "-g -DTEST_CXX",
            }
            env.update(flags)
            env["PATH"] = str(root) + os.pathsep + env["PATH"]
            result = subprocess.run(
                ["bash", str(ROOT / "build_windows.sh"), "--offline"],
                cwd=root, env=env, text=True, capture_output=True, check=True,
            )
            output = json.loads(result.stdout)
            self.assertEqual(output["args"], [
                "build", "--workspace", "--target", "x86_64-pc-windows-gnu",
                "--release", "--locked", "--offline",
            ])
            self.assertEqual(Path(output["cwd"]), ROOT)
            self.assertEqual(output["env"], flags)


if __name__ == "__main__":
    unittest.main()
