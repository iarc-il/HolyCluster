"""Use the same read-only package inspector as the native CATServer."""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from .release_manifest import ReleaseManifestError


def validate_package(path: Path, platform: str, architecture: str, version: str):
    if platform not in {"windows", "linux"} or architecture != "x86_64":
        raise ReleaseManifestError("Unsupported package target")
    configured = os.environ.get("HOLY_ARTIFACT_VALIDATOR", "holy-artifact-validator")
    validator = shutil.which(configured)
    if validator is None:
        raise ReleaseManifestError("Package validator is unavailable")
    # A file bounds diagnostic memory even if a malformed input causes excessive
    # parser output. Never execute the input package or invoke a shell.
    with tempfile.TemporaryFile() as errors:
        try:
            result = subprocess.run(
                [validator, platform, version, str(path)],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=errors,
                timeout=60,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ReleaseManifestError("Package inspection failed") from error
        if result.returncode != 0:
            errors.seek(0)
            detail = errors.read(4096).decode("utf-8", errors="replace").strip()
            raise ReleaseManifestError(f"Invalid release package: {detail}")
