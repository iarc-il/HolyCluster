"""Regenerate structural fixtures with GCC, MinGW, mksquashfs, and the MSI crate.

The payload loops forever. These files test inspection, not installation.
No input package is executed. All generated payload code is in payload.c.
"""

import json
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    elf = root / "payload.elf"
    pe = root / "payload.exe"
    subprocess.run(
        ["cc", "-nostdlib", "-fno-ident", "-Wl,--build-id=none", "-s", str(HERE / "payload.c"), "-o", str(elf)],
        check=True,
    )
    subprocess.run(
        [
            "x86_64-w64-mingw32-gcc",
            "-nostdlib",
            "-fno-ident",
            "-Wl,-e,_start",
            "-Wl,--no-insert-timestamp",
            "-s",
            str(HERE / "payload.c"),
            "-o",
            str(pe),
        ],
        check=True,
    )
    subprocess.run(
        [
            "cargo",
            "run",
            "--locked",
            "--manifest-path",
            str(HERE.parent / "Cargo.toml"),
            "--example",
            "make_msi_fixture",
            "--",
            str(pe),
            str(HERE / "valid-windows.msi"),
        ],
        check=True,
    )
    appdir = root / "AppDir"
    (appdir / "usr/bin").mkdir(parents=True)
    shutil.copyfile(elf, appdir / "usr/bin/HolyCluster")
    (appdir / "usr/share/applications").mkdir(parents=True)
    (appdir / "usr/share/applications/HolyCluster.desktop").write_text(
        "[Desktop Entry]\nType=Application\nName=HolyCluster\nExec=HolyCluster\n"
    )
    (appdir / "HolyCluster.desktop").symlink_to("usr/share/applications/HolyCluster.desktop")
    (appdir / "AppRun").write_text('#!/bin/sh\nAPPDIR=$(dirname "$0")\nexec "$APPDIR/usr/bin/HolyCluster" "$@"\n')
    (appdir / "holy-release.json").write_text(
        json.dumps({"version": "catserver-v1.2.3", "platform": "linux", "architecture": "x86_64"})
    )
    squashfs = root / "fixture.squashfs"
    subprocess.run(
        [
            "mksquashfs",
            str(appdir),
            str(squashfs),
            "-noappend",
            "-comp",
            "gzip",
            "-processors",
            "1",
            "-all-time",
            "0",
            "-no-xattrs",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    runtime = bytearray(elf.read_bytes())
    section_offset = struct.unpack_from("<Q", runtime, 40)[0]
    section_size, section_count = struct.unpack_from("<HH", runtime, 58)
    assert section_offset + section_size * section_count == len(runtime)
    runtime[8:11] = b"AI\x02"
    (HERE / "valid-linux.AppImage").write_bytes(runtime + squashfs.read_bytes())
