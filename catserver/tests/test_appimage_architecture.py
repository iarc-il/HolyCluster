#!/usr/bin/env python3
"""Exercise the packaging shell script with isolated libraries and stub packagers."""
import os
from pathlib import Path
import re
import struct
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "build_appimage.sh"


def elf(bits=64, machine=None):
    machine = machine if machine is not None else (62 if bits == 64 else 3)
    ident = b"\x7fELF" + bytes([2 if bits == 64 else 1, 1, 1]) + bytes(9)
    if bits == 64:
        return ident + struct.pack("<HHIQQQIHHHHHH", 3, machine, 1, 0, 0, 0, 0, 64, 0, 0, 0, 0, 0)
    return ident + struct.pack("<HHIIIIIHHHHHH", 3, machine, 1, 0, 0, 0, 0, 52, 0, 0, 0, 0, 0)


class AppImageArchitectureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="catserver-appimage-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.sysroot = self.root / "sysroot"
        # Redirect only absolute lookup paths, not AppDir paths or validation.
        # The old wildcard lookup also runs against this isolated filesystem.
        source = re.sub(r"(?m)^(        )(/(?:usr/)?lib/)",
                        lambda m: m[1] + str(self.sysroot) + m[2], SCRIPT.read_text())
        self.script = self.root / "build_appimage.sh"
        self.script.write_text(source)
        (self.root / "appimage").mkdir()
        (self.root / "appimage/HolyCluster.desktop").write_text("fixture")
        self.build = self.root / "target/x86_64-unknown-linux-gnu/release"
        self.build.mkdir(parents=True)
        (self.build / "catserver").write_bytes(elf())
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.tool("convert", 'for arg do output=$arg; done\ntouch "$output"')
        self.tool("linuxdeploy", 'touch "$DEPLOY_MARKER"\nif [ -n "${INJECT_LIBRARY:-}" ]; then cp "$INJECT_LIBRARY" "$CARGO_TARGET_DIR/x86_64-unknown-linux-gnu/release/AppDir/usr/lib/injected.so"; fi')
        self.tool("appimagetool", 'for arg do output=$arg; done\ntouch "$output"')
        (self.root / "runtime").touch()
        self.env = dict(os.environ)
        for key in ("APPINDICATOR_LIBRARY", "LIBUSB_LIBRARY", "INJECT_LIBRARY"):
            self.env.pop(key, None)
        self.env.update(PATH=str(self.bin) + ":" + os.environ["PATH"],
                        CARGO_TARGET_DIR=str(self.root / "target"),
                        CATSERVER_VERSION="catserver-vtest", SOURCE_DATE_EPOCH="1",
                        APPIMAGETOOL=str(self.bin / "appimagetool"),
                        LINUXDEPLOY=str(self.bin / "linuxdeploy"),
                        APPIMAGE_RUNTIME=str(self.root / "runtime"),
                        DEPLOY_MARKER=str(self.root / "deployed"))
        for arch, bits in (("i386-linux-gnu", 32), ("x86_64-linux-gnu", 64)):
            for name in ("libusb-1.0.so.0", "libayatana-appindicator3.so.1"):
                self.library(arch, name, elf(bits))

    def tool(self, name, body):
        path = self.bin / name
        path.write_text("#!/bin/sh\nset -eu\n" + body + "\n")
        path.chmod(0o755)

    def library(self, arch, name, data):
        path = self.sysroot / "usr/lib" / arch / name
        path.parent.mkdir(parents=True, exist_ok=True)
        resolved = path.with_name(name + ".fixture")
        resolved.write_bytes(data)
        if not path.is_symlink():
            path.symlink_to(resolved.name)
        return path

    def run_package(self):
        return subprocess.run(["sh", str(self.script)], env=self.env,
                              text=True, capture_output=True)

    def assert_rejected(self):
        result = self.run_package()
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("Expected x86_64 ELF file:", result.stderr)
        self.assertFalse(list(self.build.glob("*.AppImage")))
        return result

    def test_both_architectures_choose_x86_64(self):
        result = self.run_package()
        self.assertEqual(result.returncode, 0, result.stderr)
        for name in ("libusb-1.0.so.0", "libayatana-appindicator3.so.1"):
            self.assertEqual((self.build / "AppDir/usr/lib" / name).read_bytes(), elf())
        self.assertEqual(len(list(self.build.glob("*.AppImage"))), 1)

    def test_invalid_explicit_overrides_fail_before_deploy(self):
        for variable, name in (("LIBUSB_LIBRARY", "libusb-1.0.so.0"),
                               ("APPINDICATOR_LIBRARY", "libayatana-appindicator3.so.1")):
            for value in ("", str(self.root / "missing"),
                          str(self.sysroot / "usr/lib/i386-linux-gnu" / name)):
                with self.subTest(variable=variable, value=value):
                    self.env[variable] = value
                    self.assert_rejected()
                    self.assertFalse((self.root / "deployed").exists())
            del self.env[variable]

    def test_wrong_machine_even_with_elf64_is_rejected(self):
        path = self.library("x86_64-linux-gnu", "libusb-1.0.so.0", elf(64, 183))
        self.env["LIBUSB_LIBRARY"] = str(path)
        self.assert_rejected()

    def test_wrong_architecture_default_is_rejected(self):
        self.library("x86_64-linux-gnu", "libayatana-appindicator3.so.1", elf(32))
        self.assert_rejected()

    def test_wrong_architecture_transitive_bundle_is_rejected(self):
        path = self.root / "wrong.so"
        path.write_bytes(elf(32))
        self.env["INJECT_LIBRARY"] = str(path)
        self.assert_rejected()
        self.assertTrue((self.root / "deployed").exists())

    def test_wrong_architecture_external_library_symlink_is_rejected(self):
        path = self.root / "outside-appdir.so"
        path.write_bytes(elf(32))
        self.env["INJECT_LIBRARY"] = str(path)
        self.tool("linuxdeploy", 'touch "$DEPLOY_MARKER"\nln -s "$INJECT_LIBRARY" "$CARGO_TARGET_DIR/x86_64-unknown-linux-gnu/release/AppDir/usr/lib/injected.so"')
        self.assert_rejected()
        self.assertTrue((self.build / "AppDir/usr/lib/injected.so").is_symlink())
        self.assertTrue((self.root / "deployed").exists())

    def test_wrong_architecture_executable_is_rejected(self):
        (self.build / "catserver").write_bytes(elf(32))
        self.assert_rejected()
        self.assertFalse((self.root / "deployed").exists())


if __name__ == "__main__":
    unittest.main()
