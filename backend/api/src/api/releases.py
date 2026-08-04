import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path


ARTIFACT_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
VERSION_PATTERN = re.compile(r"^catserver-v\d+\.\d+\.\d+(?:-\d+-g[0-9a-f]+)?$")
PLATFORMS = {"linux": ".AppImage", "windows": ".msi"}
ARCHITECTURES = {"x86_64"}


class ReleaseManifestError(ValueError):
    pass


@dataclass(frozen=True)
class ReleaseArtifact:
    version: str
    platform: str
    architecture: str
    name: str
    location: str
    sha256: str
    size: int

    def as_dict(self):
        return {
            "version": self.version,
            "platform": self.platform,
            "architecture": self.architecture,
            "artifact": {
                "location": self.location,
                "name": self.name,
                "sha256": self.sha256,
                "size": self.size,
            },
        }


@dataclass(frozen=True)
class ReleaseManifest:
    artifacts: tuple[ReleaseArtifact, ...]

    def as_dict(self):
        return {"schema_version": 1, "releases": [artifact.as_dict() for artifact in self.artifacts]}

    def select(self, platform: str, architecture: str):
        for artifact in self.artifacts:
            if artifact.platform == platform and artifact.architecture == architecture:
                return artifact
        return None


def load_release_manifest(release_dir: Path):
    manifest_path = release_dir / "latest.json"
    try:
        raw_manifest = json.loads(manifest_path.read_text())
    except FileNotFoundError as e:
        raise ReleaseManifestError("No releases found") from e
    except (OSError, json.JSONDecodeError) as e:
        raise ReleaseManifestError("Release manifest is invalid") from e

    if not isinstance(raw_manifest, dict) or raw_manifest.get("schema_version") != 1:
        raise ReleaseManifestError("Release manifest is invalid")
    releases = raw_manifest.get("releases")
    if not isinstance(releases, list) or not releases:
        raise ReleaseManifestError("Release manifest is invalid")

    artifacts = []
    seen_targets = set()
    for release in releases:
        artifacts.append(parse_release_artifact(release, seen_targets))
    return ReleaseManifest(tuple(artifacts))


def parse_release_artifact(release, seen_targets):
    if not isinstance(release, dict):
        raise ReleaseManifestError("Release manifest is invalid")

    version = release.get("version")
    platform = release.get("platform")
    architecture = release.get("architecture")
    artifact = release.get("artifact")
    if (
        not isinstance(version, str)
        or not VERSION_PATTERN.fullmatch(version)
        or platform not in PLATFORMS
        or architecture not in ARCHITECTURES
        or not isinstance(artifact, dict)
    ):
        raise ReleaseManifestError("Release manifest is invalid")

    name = artifact.get("name")
    location = artifact.get("location")
    sha256 = artifact.get("sha256")
    size = artifact.get("size")
    if (
        not isinstance(name, str)
        or not ARTIFACT_NAME_PATTERN.fullmatch(name)
        or not name.endswith(PLATFORMS[platform])
        or location != f"/catserver/artifacts/{name}"
        or not isinstance(sha256, str)
        or not SHA256_PATTERN.fullmatch(sha256)
        or not isinstance(size, int)
        or isinstance(size, bool)
        or size < 0
    ):
        raise ReleaseManifestError("Release manifest is invalid")

    target = (platform, architecture)
    if target in seen_targets:
        raise ReleaseManifestError("Release manifest is invalid")
    seen_targets.add(target)
    return ReleaseArtifact(version, platform, architecture, name, location, sha256, size)


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
