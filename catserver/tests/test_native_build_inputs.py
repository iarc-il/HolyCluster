"""Exercise hamlib-sys build output without Cargo or native libraries."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
STUBS = """
mod cc {
    pub struct Build;
    impl Build {
        pub fn new() -> Self { Self }
        pub fn file(&mut self, _: &str) -> &mut Self { self }
        pub fn include(&mut self, _: String) -> &mut Self { self }
        pub fn compile(&mut self, _: &str) {}
    }
}
mod pkg_config {
    pub struct Config;
    impl Config {
        pub fn new() -> Self { Self }
        pub fn probe(&self, _: &str) -> Result<(), &str> { Ok(()) }
    }
}
"""


class NativeBuildInputs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        source = cls.root / "build.rs"
        source.write_text(STUBS + (ROOT / "crates/hamlib-sys/build.rs").read_text())
        cls.binary = cls.root / "build-script"
        subprocess.run(["rustc", "--edition=2024", str(source), "-o", str(cls.binary)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def run_build(self, target):
        archive = self.root / "libhamlib.a"
        archive.write_bytes(b"!<arch>\n")
        env = os.environ.copy()
        env.update({
            "TARGET": target,
            "DEP_HAMLIB_SRC_VERSION": "4.7.2",
            "DEP_HAMLIB_SRC_INCLUDE": str(self.root),
            "DEP_HAMLIB_SRC_LIBDIR": str(self.root),
            "DEP_HAMLIB_SRC_LIBRARY_FILE": archive.name,
        })
        if target == "x86_64-pc-windows-gnu":
            include = self.root / "libusb-1.0"
            include.mkdir(exist_ok=True)
            (include / "libusb.h").touch()
            usb = self.root / "libusb.a"
            usb.write_bytes(b"!<arch>\n")
            pthread = self.root / "libwinpthread.a"
            pthread.write_bytes(b"!<arch>\n")
            compiler = self.root / "x86_64-w64-mingw32-gcc"
            compiler.write_text(f"#!/bin/sh\nprintf '%s\\n' '{pthread}'\n")
            compiler.chmod(0o755)
            env.update({
                "PATH": str(self.root) + os.pathsep + env["PATH"],
                "DEP_HAMLIB_SRC_LIBUSB_INCLUDE": str(self.root),
                "DEP_HAMLIB_SRC_LIBUSB_LIBDIR": str(self.root),
                "DEP_HAMLIB_SRC_LIBUSB_ARTIFACT": str(usb),
            })
        result = subprocess.run([str(self.binary)], env=env, text=True, capture_output=True, check=True)
        return result.stdout.splitlines()

    def test_watches_host_archive_at_metadata_path(self):
        lines = self.run_build("x86_64-unknown-linux-gnu")
        self.assertIn(f"cargo:rerun-if-changed={self.root / 'libhamlib.a'}", lines)
        self.assertIn("cargo:rustc-link-lib=static=hamlib", lines)
        self.assertIn("cargo:rustc-link-lib=dylib=dl", lines)

    def test_watches_all_windows_bundled_archives(self):
        lines = self.run_build("x86_64-pc-windows-gnu")
        for archive in ["libhamlib.a", "libusb.a", "libwinpthread.a"]:
            self.assertIn(f"cargo:rerun-if-changed={self.root / archive}", lines)
        for library in ["hamlib", "usb-1.0", "winpthread"]:
            self.assertIn(f"cargo:rustc-link-lib=static={library}", lines)


if __name__ == "__main__":
    unittest.main()
