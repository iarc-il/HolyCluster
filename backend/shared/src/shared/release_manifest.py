import re
from dataclasses import dataclass


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


def validate_version(version: str):
    if not isinstance(version, str) or not VERSION_PATTERN.fullmatch(version):
        raise ReleaseManifestError("Invalid version")


def validate_release_target(platform: str, architecture: str, name: str):
    if not isinstance(platform, str) or platform not in PLATFORMS:
        raise ReleaseManifestError("Invalid platform")
    if not isinstance(architecture, str) or architecture not in ARCHITECTURES:
        raise ReleaseManifestError("Invalid architecture")
    if not isinstance(name, str) or not ARTIFACT_NAME_PATTERN.fullmatch(name) or not name.endswith(PLATFORMS[platform]):
        raise ReleaseManifestError("Invalid artifact name")


def create_release_artifact(version: str, platform: str, architecture: str, name: str, sha256: str, size: int):
    validate_version(version)
    validate_release_target(platform, architecture, name)
    if not isinstance(sha256, str) or not SHA256_PATTERN.fullmatch(sha256):
        raise ReleaseManifestError("Invalid artifact checksum")
    if not isinstance(size, int) or isinstance(size, bool) or size < 0:
        raise ReleaseManifestError("Invalid artifact size")
    return ReleaseArtifact(version, platform, architecture, name, f"/catserver/artifacts/{name}", sha256, size)


def parse_release_artifact(release):
    if not isinstance(release, dict) or not isinstance(release.get("artifact"), dict):
        raise ReleaseManifestError("Release manifest is invalid")

    artifact = release["artifact"]
    try:
        parsed = create_release_artifact(
            release.get("version"),
            release.get("platform"),
            release.get("architecture"),
            artifact.get("name"),
            artifact.get("sha256"),
            artifact.get("size"),
        )
    except ReleaseManifestError as e:
        raise ReleaseManifestError("Release manifest is invalid") from e
    if artifact.get("location") != parsed.location:
        raise ReleaseManifestError("Release manifest is invalid")
    return parsed


def parse_release_manifest(raw_manifest):
    if not isinstance(raw_manifest, dict) or raw_manifest.get("schema_version") != 1:
        raise ReleaseManifestError("Release manifest is invalid")
    releases = raw_manifest.get("releases")
    if not isinstance(releases, list) or not releases:
        raise ReleaseManifestError("Release manifest is invalid")

    artifacts = []
    seen_targets = set()
    for release in releases:
        artifact = parse_release_artifact(release)
        target = (artifact.platform, artifact.architecture)
        if target in seen_targets:
            raise ReleaseManifestError("Release manifest is invalid")
        seen_targets.add(target)
        artifacts.append(artifact)
    return ReleaseManifest(tuple(artifacts))
