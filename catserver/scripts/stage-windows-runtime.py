#!/usr/bin/env python3
"""Stage the verified Windows DLL closure for the future MSI package."""

import argparse
import hashlib
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path


SYSTEM_DLLS = {
    "advapi32.dll", "bcrypt.dll", "bcryptprimitives.dll", "comctl32.dll", "comdlg32.dll", "crypt32.dll",
    "gdi32.dll", "imm32.dll", "kernel32.dll", "kernelbase.dll", "mpr.dll",
    "msvcrt.dll", "ntdll.dll", "ole32.dll", "oleaut32.dll", "rpcrt4.dll",
    "secur32.dll", "setupapi.dll", "shell32.dll", "shlwapi.dll", "user32.dll",
    "uxtheme.dll", "version.dll", "winhttp.dll", "winmm.dll", "winspool.drv",
    "ws2_32.dll", "wtsapi32.dll",
}
GCC_RUNTIME_DLLS = {"libgcc_s_seh-1.dll", "libstdc++-6.dll", "libwinpthread-1.dll"}
FORBIDDEN_PREFIXES = ("msys-", "cyg")
FORBIDDEN_GPL_DLL_PREFIXES = ("libgfortran-", "libgomp-", "libquadmath-", "libssp-")


class StageError(Exception):
    pass


def metadata(script_dir):
    plan = (script_dir.parent / "crates/hamlib-src/src/plan.rs").read_text()
    version = re.search(r'pub const HAMLIB_VERSION: &str = "([^"]+)"', plan)
    sha256 = re.search(r'pub const HAMLIB_SHA256: &str = "([^"]+)"', plan)
    url = re.search(r'pub const HAMLIB_ARCHIVE_URL: &str =\s*"([^"]+)"', plan)
    if not version or not sha256 or not url:
        raise StageError("cannot read pinned Hamlib metadata")
    shell = (script_dir / "windows-runtime-metadata.sh").read_text()
    values = {}
    for name in ("LIBUSB_VERSION", "LIBUSB_SHA256", "LIBUSB_SOURCE_URL", "LIBUSB_LICENSE"):
        match = re.search(rf'^{name}=\$?\{{?{name}:-([^}}\n]+)\}}?|^{name}=([^\n]+)', shell, re.M)
        if not match:
            raise StageError(f"cannot read {name} from shared runtime metadata")
        values[name] = (match.group(1) or match.group(2)).strip('"')
    return {"hamlib_version": version.group(1), "hamlib_sha256": sha256.group(1),
            "hamlib_url": url.group(1), **values}


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_pe(path):
    data = path.read_bytes()
    if len(data) < 0x100 or data[:2] != b"MZ":
        return False
    offset = struct.unpack_from("<I", data, 0x3C)[0]
    if offset + 24 > len(data) or data[offset:offset + 4] != b"PE\0\0":
        return False
    return True


def is_pe_dll(path):
    if not is_pe(path):
        return False
    data = path.read_bytes()
    offset = struct.unpack_from("<I", data, 0x3C)[0]
    characteristics = struct.unpack_from("<H", data, offset + 22)[0]
    return bool(characteristics & 0x2000)


def imports(objdump, path):
    output = subprocess.run([str(objdump), "-p", str(path)], check=True, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
    return sorted({match.group(1).lower() for match in re.finditer(r"DLL Name:\s*([^\s]+)", output)})


def is_system_dll(name):
    return name in SYSTEM_DLLS or name.startswith(("api-ms-win-", "ext-ms-win-"))


def reject_name(name):
    if not name.endswith(".dll"):
        raise StageError(f"import is not a DLL: {name}")
    if name.startswith(FORBIDDEN_PREFIXES) or name.startswith(FORBIDDEN_GPL_DLL_PREFIXES):
        raise StageError(f"forbidden runtime artifact: {name}")
    if name.endswith("d.dll"):
        raise StageError(f"debug runtime artifact: {name}")


def files_named(root, name):
    if not root.is_dir():
        return []
    root = root.resolve()
    result = []
    for path in root.rglob("*"):
        if path.name.lower() == name and path.is_file() and not path.is_symlink():
            resolved = path.resolve()
            if resolved.is_relative_to(root):
                result.append(resolved)
    return sorted(result)


def resolve(name, hamlib_prefix, libusb_prefix, gcc):
    candidates = []
    for root in (hamlib_prefix / "bin", libusb_prefix / "bin"):
        candidates.extend(files_named(root, name))
    gcc_path = None
    if not candidates:
        gcc_path = Path(subprocess.run([str(gcc), f"-print-file-name={name}"], check=True, text=True,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout.strip())
        if gcc_path.name.lower() == name and gcc_path.is_file():
            candidates.append(gcc_path.resolve())
    if not candidates:
        raise StageError(f"unresolved DLL import: {name}")
    for path in candidates:
        if not is_pe_dll(path):
            raise StageError(f"resolved artifact is not a PE DLL: {path}")
        path_text = str(path).lower()
        if "msys" in path_text or "debug" in path_text:
            raise StageError(f"forbidden runtime artifact: {path}")
    hashes = {sha256(path) for path in candidates}
    if len(hashes) != 1:
        paths = ", ".join(str(path) for path in candidates)
        raise StageError(f"DLL name collision with different hashes for {name}: {paths}")
    for root in (hamlib_prefix / "bin", libusb_prefix / "bin"):
        paths = files_named(root, name)
        if paths:
            return paths[0]
    if name not in GCC_RUNTIME_DLLS or gcc_path is None:
        raise StageError(f"target GCC supplied unexpected DLL: {name}")
    return gcc_path.resolve()


def source_label(path, hamlib_prefix, libusb_prefix):
    for label, root in (
        ("hamlib-prefix/bin", hamlib_prefix / "bin"),
        ("libusb-prefix/bin", libusb_prefix / "bin"),
    ):
        try:
            return f"{label}/{path.relative_to(root)}"
        except ValueError:
            pass
    return f"mingw-runtime/{path.name}"


def discover_prefix(build_dir):
    prefixes = sorted(build_dir.glob("build/hamlib-src-*/out/prefix"))
    if len(prefixes) != 1:
        raise StageError(f"expected exactly one release Hamlib prefix, found {len(prefixes)}")
    return prefixes[0].resolve()


def hamlib_license(prefix, version):
    source = prefix.parent / "source" / f"hamlib-{version}"
    for name in ("COPYING.LIB", "LICENSE", "COPYING"):
        candidate = source / name
        if candidate.is_file():
            return candidate
    raise StageError(f"Hamlib license is missing from verified source: {source}")


def stage(args):
    script_dir = Path(__file__).resolve().parent
    info = metadata(script_dir)
    build_dir = args.build_dir.resolve()
    executable = build_dir / "HolyCluster.exe"
    if not executable.is_file() or not is_pe(executable):
        raise StageError(f"HolyCluster.exe is not a PE executable: {executable}")
    hamlib_prefix = discover_prefix(build_dir)
    libusb_prefix = args.libusb_prefix.resolve()
    if not (hamlib_prefix / "bin").is_dir() or not (libusb_prefix / "bin").is_dir():
        raise StageError("Hamlib and libusb prefixes must contain bin directories")
    stage_dir = args.stage_dir.resolve()
    temp_dir = Path(tempfile.mkdtemp(prefix=f".{stage_dir.name}.", dir=stage_dir.parent))
    backup = None
    try:
        dll_dir = temp_dir / "dll"
        dll_dir.mkdir(parents=True)
        pending = [executable.resolve()]
        staged = {}
        while pending:
            binary = pending.pop(0)
            for name in imports(args.objdump, binary):
                if is_system_dll(name):
                    continue
                reject_name(name)
                dependency = resolve(name, hamlib_prefix, libusb_prefix, args.gcc)
                previous = staged.get(name)
                if previous and sha256(previous) != sha256(dependency):
                    raise StageError(f"DLL name collision with different hashes for {name}")
                if not previous:
                    staged[name] = dependency
                    pending.append(dependency)
        manifest = ["name\tsource\tsha256"]
        for name, source in sorted(staged.items()):
            destination = dll_dir / name
            shutil.copyfile(source, destination)
            manifest.append(
                f"{name}\t{source_label(source, hamlib_prefix, libusb_prefix)}\t{sha256(source)}"
            )
        (temp_dir / "runtime-manifest.tsv").write_text("\n".join(manifest) + "\n")
        licenses = temp_dir / "licenses"
        licenses.mkdir()
        hamlib_license_destination = licenses / "Hamlib-LGPL.txt"
        shutil.copyfile(hamlib_license(hamlib_prefix, info["hamlib_version"]), hamlib_license_destination)
        libusb_license = libusb_prefix / "share/licenses/libusb/COPYING"
        if any(path.name == "libusb-1.0.dll" for path in staged.values()) and not libusb_license.is_file():
            raise StageError(f"libusb license is missing: {libusb_license}")
        if libusb_license.is_file():
            shutil.copyfile(libusb_license, licenses / "libusb-LGPL.txt")
        notice = [
            f"Hamlib {info['hamlib_version']}", "License: LGPL-2.1-or-later",
            f"Source: {info['hamlib_url']}", f"SHA-256: {info['hamlib_sha256']}", "",
            f"libusb {info['LIBUSB_VERSION']}", f"License: {info['LIBUSB_LICENSE']}",
            f"Source: {info['LIBUSB_SOURCE_URL']}", f"SHA-256: {info['LIBUSB_SHA256']}", "",
            f"Hamlib license SHA-256: {sha256(hamlib_license_destination)}",
        ]
        if libusb_license.is_file():
            notice.append(f"libusb license SHA-256: {sha256(licenses / 'libusb-LGPL.txt')}")
        notice.extend(f"Runtime {name} SHA-256: {sha256(source)}" for name, source in sorted(staged.items()))
        (temp_dir / "THIRD_PARTY_NOTICES.txt").write_text("\n".join(notice))
        backup = stage_dir.with_name(f".{stage_dir.name}.previous")
        if backup.exists():
            shutil.rmtree(backup)
        if stage_dir.exists():
            stage_dir.rename(backup)
        temp_dir.rename(stage_dir)
        if backup.exists():
            shutil.rmtree(backup)
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        if backup and backup.exists() and not stage_dir.exists():
            backup.rename(stage_dir)
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--build-dir", type=Path, required=True)
    parser.add_argument("--libusb-prefix", type=Path, required=True)
    parser.add_argument("--stage-dir", type=Path)
    parser.add_argument("--objdump", type=Path, default=Path("x86_64-w64-mingw32-objdump"))
    parser.add_argument("--gcc", type=Path, default=Path("x86_64-w64-mingw32-gcc"))
    args = parser.parse_args()
    args.stage_dir = args.stage_dir or args.build_dir / "runtime"
    try:
        stage(args)
    except (OSError, subprocess.CalledProcessError, StageError) as error:
        print(f"runtime staging failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
