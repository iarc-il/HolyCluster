import hashlib
import json
from pathlib import Path

from shared.release_manifest import ARTIFACT_NAME_PATTERN, ReleaseArtifact, ReleaseManifestError, parse_release_manifest


def load_release_manifest(release_dir: Path):
    manifest_path = release_dir / "latest.json"
    try:
        raw_manifest = json.loads(manifest_path.read_text())
    except FileNotFoundError as e:
        raise ReleaseManifestError("No releases found") from e
    except (OSError, json.JSONDecodeError) as e:
        raise ReleaseManifestError("Release manifest is invalid") from e
    return parse_release_manifest(raw_manifest)


def artifact_path(release_dir: Path, name: str):
    if not ARTIFACT_NAME_PATTERN.fullmatch(name):
        raise ReleaseManifestError("Artifact not found")

    artifacts_dir = (release_dir / "artifacts").resolve()
    path = (artifacts_dir / name).resolve()
    if not path.is_relative_to(artifacts_dir) or not path.is_file():
        raise ReleaseManifestError("Artifact not found")
    return path


def verify_artifact(path: Path, artifact: ReleaseArtifact):
    if path.stat().st_size != artifact.size:
        raise ReleaseManifestError("Artifact does not match release manifest")

    with path.open("rb") as file:
        digest = hashlib.file_digest(file, "sha256").hexdigest()
    if digest != artifact.sha256:
        raise ReleaseManifestError("Artifact does not match release manifest")
