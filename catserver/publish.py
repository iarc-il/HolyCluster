#!/usr/bin/env python3

import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend" / "shared" / "src"))

from shared.release_manifest import (
    ReleaseManifestError,
    create_release_artifact,
    validate_release_target,
    validate_version,
)

REMOTE_DIRECTORY_PATTERN = re.compile(r"^/[A-Za-z0-9_./-]+$")
REMOTE_PUBLISH_SCRIPT = """\
set -euo pipefail

release_dir=$1
run_id=$2
shift 2
stage="$release_dir/.staging/$run_id"

exec 9>"$release_dir/.publish.lock"
flock 9
mkdir -p "$release_dir/artifacts"

for name in "$@"; do
    staged_artifact="$stage/$name"
    staged_hash="$stage/$name.sha256"
    expected_hash=$(cut -d ' ' -f 1 "$staged_hash")
    actual_hash=$(sha256sum "$staged_artifact" | cut -d ' ' -f 1)
    [ "$actual_hash" = "$expected_hash" ] || { echo "Artifact hash mismatch: $name" >&2; exit 1; }

    if [ -e "$release_dir/artifacts/$name" ]; then
        cmp -s "$staged_artifact" "$release_dir/artifacts/$name" || { echo "Immutable artifact already exists: $name" >&2; exit 1; }
        rm "$staged_artifact"
    else
        mv "$staged_artifact" "$release_dir/artifacts/$name"
    fi
    mv "$staged_hash" "$release_dir/artifacts/$name.sha256"
done

mv "$stage/latest.json" "$release_dir/latest.json"
rmdir "$stage"
"""


@dataclass(frozen=True)
class Artifact:
    platform: str
    architecture: str
    path: Path
    name: str

    @property
    def sha256(self):
        with self.path.open("rb") as file:
            return hashlib.file_digest(file, "sha256").hexdigest()

    @property
    def size(self):
        return self.path.stat().st_size

    def release_artifact(self, version: str):
        return create_release_artifact(version, self.platform, self.architecture, self.name, self.sha256, self.size)


def parse_artifact(value: str):
    try:
        platform, architecture, path, name = value.split(":", 3)
    except ValueError as e:
        raise argparse.ArgumentTypeError(f"Invalid artifact: {value}") from e

    try:
        validate_release_target(platform, architecture, name)
    except ReleaseManifestError as e:
        raise argparse.ArgumentTypeError(str(e)) from e

    artifact_path = Path(path)
    if not artifact_path.is_file():
        raise argparse.ArgumentTypeError(f"Artifact does not exist: {artifact_path}")
    return Artifact(platform, architecture, artifact_path, name)


def parse_remote_directory(value: str):
    if not REMOTE_DIRECTORY_PATTERN.fullmatch(value) or ".." in value:
        raise argparse.ArgumentTypeError("Invalid remote artifact directory")
    return value


def parse_version(value: str):
    try:
        validate_version(value)
    except ReleaseManifestError as e:
        raise argparse.ArgumentTypeError(str(e)) from e
    return value


def parse_arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument("--deploy-user", required=True)
    parser.add_argument("--deploy-host", required=True)
    parser.add_argument("--remote-artifact-dir", required=True, type=parse_remote_directory)
    parser.add_argument("--version", required=True, type=parse_version)
    parser.add_argument("--artifact", required=True, action="append", type=parse_artifact)
    arguments = parser.parse_args()

    targets = {(artifact.platform, artifact.architecture) for artifact in arguments.artifact}
    names = {artifact.name for artifact in arguments.artifact}
    if len(targets) != len(arguments.artifact):
        parser.error("Duplicate release target")
    if len(names) != len(arguments.artifact):
        parser.error("Duplicate artifact name")
    return arguments


def write_publish_files(directory: Path, version: str, artifacts: list[Artifact]):
    manifest = {
        "schema_version": 1,
        "releases": [artifact.release_artifact(version).as_dict() for artifact in artifacts],
    }
    (directory / "latest.json").write_text(json.dumps(manifest, separators=(",", ":")))
    for artifact in artifacts:
        (directory / f"{artifact.name}.sha256").write_text(f"{artifact.sha256}  {artifact.name}\n")


def run(command, **kwargs):
    subprocess.run(command, check=True, **kwargs)


def publish(arguments):
    remote = f"{arguments.deploy_user}@{arguments.deploy_host}"
    run_id = uuid.uuid4().hex
    remote_stage = f"{arguments.remote_artifact_dir}/.staging/{run_id}"

    with tempfile.TemporaryDirectory() as temporary_directory:
        staging_directory = Path(temporary_directory)
        write_publish_files(staging_directory, arguments.version, arguments.artifact)
        run(["ssh", remote, "mkdir", "-p", "--", remote_stage])

        for artifact in arguments.artifact:
            run(["scp", str(artifact.path), f"{remote}:{remote_stage}/{artifact.name}"])
            run(
                [
                    "scp",
                    str(staging_directory / f"{artifact.name}.sha256"),
                    f"{remote}:{remote_stage}/{artifact.name}.sha256",
                ]
            )
        run(["scp", str(staging_directory / "latest.json"), f"{remote}:{remote_stage}/latest.json"])
        run(
            [
                "ssh",
                remote,
                "bash",
                "-s",
                "--",
                arguments.remote_artifact_dir,
                run_id,
                *[a.name for a in arguments.artifact],
            ],
            input=REMOTE_PUBLISH_SCRIPT,
            text=True,
        )


def main():
    publish(parse_arguments())


if __name__ == "__main__":
    main()
