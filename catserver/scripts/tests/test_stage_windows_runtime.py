import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "stage-windows-runtime.py"


def pe(dll=True, payload=b""):
    data = bytearray(0x100)
    data[:2] = b"MZ"
    data[0x3C:0x40] = (0x80).to_bytes(4, "little")
    data[0x80:0x84] = b"PE\0\0"
    data[0x96:0x98] = (0x2000 if dll else 0x0002).to_bytes(2, "little")
    return bytes(data) + payload


class RuntimeStageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.build = self.root / "target/release"
        self.build.mkdir(parents=True)
        self.hamlib = self.build / "build/hamlib-src-test/out/prefix"
        self.libusb = self.root / "libusb"
        for prefix in (self.hamlib, self.libusb):
            (prefix / "bin").mkdir(parents=True)
        source = self.hamlib.parent / "source/hamlib-4.7.2"
        source.mkdir(parents=True)
        (source / "COPYING").write_text("Hamlib LGPL fixture\n")
        license_dir = self.libusb / "share/licenses/libusb"
        license_dir.mkdir(parents=True)
        (license_dir / "COPYING").write_text("libusb LGPL fixture\n")
        self.imports = {}
        self.objdump = self.root / "objdump"
        self.gcc = self.root / "gcc"
        self.objdump.write_text("#!/usr/bin/env python3\nimport json, os, sys\nfor name in json.loads(os.environ['IMPORTS']).get(sys.argv[-1].split('/')[-1], []): print(' DLL Name: ' + name)\n")
        self.gcc.write_text("#!/bin/sh\nprintf '%s\\n' \"${1#*=}\"\n")
        self.objdump.chmod(0o755)
        self.gcc.chmod(0o755)
        self.write(self.build / "HolyCluster.exe", pe(False))

    def tearDown(self):
        self.temp.cleanup()

    def write(self, path, content):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    def stage(self):
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--build-dir", str(self.build), "--libusb-prefix", str(self.libusb),
             "--objdump", str(self.objdump), "--gcc", str(self.gcc)],
            env={**__import__("os").environ, "IMPORTS": json.dumps(self.imports)}, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )

    def test_recurses_and_emits_a_deterministic_manifest(self):
        self.write(self.hamlib / "bin/libhamlib-4.dll", pe(True, b"hamlib"))
        self.write(self.libusb / "bin/libusb-1.0.dll", pe(True, b"libusb"))
        self.imports = {"HolyCluster.exe": ["LIBHAMLIB-4.DLL", "KERNEL32.dll"], "libhamlib-4.dll": ["libusb-1.0.dll"]}
        self.assertEqual(self.stage().returncode, 0)
        manifest = self.build / "runtime/runtime-manifest.tsv"
        first = manifest.read_bytes()
        self.assertEqual(self.stage().returncode, 0)
        self.assertEqual(manifest.read_bytes(), first)
        self.assertEqual(manifest.read_text().splitlines()[1:], sorted(manifest.read_text().splitlines()[1:]))
        self.assertIn("hamlib-prefix/bin/libhamlib-4.dll", manifest.read_text())
        self.assertNotIn(str(self.root), manifest.read_text())
        self.assertEqual(hashlib.sha256((self.build / "runtime/licenses/Hamlib-LGPL.txt").read_bytes()).hexdigest(), hashlib.sha256(b"Hamlib LGPL fixture\n").hexdigest())

    def test_rejects_an_unresolved_transitive_import(self):
        self.write(self.hamlib / "bin/libhamlib-4.dll", pe(True))
        self.imports = {"HolyCluster.exe": ["libhamlib-4.dll"], "libhamlib-4.dll": ["missing.dll"]}
        result = self.stage()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unresolved DLL import: missing.dll", result.stderr)

    def test_rejects_a_same_name_hash_collision(self):
        self.write(self.hamlib / "bin/libhamlib-4.dll", pe(True, b"one"))
        self.write(self.libusb / "bin/libhamlib-4.dll", pe(True, b"two"))
        self.imports = {"HolyCluster.exe": ["libhamlib-4.dll"]}
        result = self.stage()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("DLL name collision", result.stderr)

    def test_rejects_a_forbidden_msys_artifact(self):
        self.imports = {"HolyCluster.exe": ["msys-2.0.dll"]}
        result = self.stage()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("forbidden runtime artifact", result.stderr)


if __name__ == "__main__":
    unittest.main()
