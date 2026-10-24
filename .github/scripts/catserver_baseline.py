#!/usr/bin/env python3

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend/shared/src"))

from shared.artifact_validation import validate_package
from shared.release_manifest import ReleaseManifestError, parse_release_manifest

PRODUCTION_MANIFEST = "https://holycluster.iarc.org/catserver/releases/latest"


def snapshot(manifest_url: str, output: Path):
    if urlsplit(manifest_url).scheme not in {"https", "http"} or not urlsplit(manifest_url).netloc:
        raise ReleaseManifestError("Manifest URL must use HTTP or HTTPS")
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ReleaseManifestError("Output directory must be empty")

    with urlopen(manifest_url, timeout=60) as response:
        raw = response.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ReleaseManifestError("Release manifest is too large")
    data = json.loads(raw)
    manifest = parse_release_manifest(data)
    if type(data["schema_version"]) is not int:
        raise ReleaseManifestError("Release manifest is invalid")
    selected = [manifest.select(platform, "x86_64") for platform in ("linux", "windows")]
    if any(artifact is None for artifact in selected):
        raise ReleaseManifestError("Both Linux and Windows x86_64 releases are required")

    (output / "latest.json").write_bytes(raw)
    releases = []
    for artifact in selected:
        url = urljoin(manifest_url, artifact.location)
        relative_path = Path("artifacts") / artifact.platform / artifact.name
        path = output / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        size = 0
        with urlopen(url, timeout=60) as response, path.open("wb") as file:
            while chunk := response.read(min(1024 * 1024, artifact.size - size + 1)):
                size += len(chunk)
                if size > artifact.size:
                    raise ReleaseManifestError("Artifact size does not match release manifest")
                digest.update(chunk)
                file.write(chunk)
        if size != artifact.size:
            raise ReleaseManifestError("Artifact size does not match release manifest")
        if digest.hexdigest() != artifact.sha256:
            raise ReleaseManifestError("Artifact SHA-256 does not match release manifest")
        validate_package(path, artifact.platform, artifact.architecture, artifact.version)
        releases.append({**artifact.as_dict(), "url": url, "path": relative_path.as_posix()})

    descriptor = {
        "schema_version": 1,
        "manifest": {"url": manifest_url, "path": "latest.json", "sha256": hashlib.sha256(raw).hexdigest()},
        "releases": releases,
    }
    # Only a complete, validated snapshot can become a baseline.
    temporary = output / "baseline.json.tmp"
    temporary.write_text(json.dumps(descriptor, indent=2) + "\n")
    temporary.replace(output / "baseline.json")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest-url", default=PRODUCTION_MANIFEST)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--validator", default=os.environ.get("HOLY_ARTIFACT_VALIDATOR", "holy-artifact-validator"))
    args = parser.parse_args()
    os.environ["HOLY_ARTIFACT_VALIDATOR"] = args.validator
    try:
        snapshot(args.manifest_url, args.output_dir)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Baseline snapshot failed: {error}\n")


if __name__ == "__main__":
    main()
