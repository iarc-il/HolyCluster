import tempfile
from pathlib import Path

from shared.release_manifest import ReleaseArtifact, ReleaseManifestError
from starlette.responses import FileResponse
from starlette.types import Receive, Scope, Send

from .releases import verify_artifact

MAX_PACKAGE_SIZE = 512 * 1024 * 1024


class ValidatedArtifactResponse(FileResponse):
    def __init__(self, snapshot, artifact: ReleaseArtifact):
        self.snapshot = snapshot
        super().__init__(
            Path(snapshot.name) / artifact.name,
            filename=artifact.name.replace("catserver", "HolyCluster"),
            media_type="application/octet-stream",
            headers={"Cache-Control": "no-store"},
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        # Keep file lifetime under this response, not a server-specific path sender.
        scope = {
            **scope,
            "extensions": {
                key: value for key, value in scope.get("extensions", {}).items() if key != "http.response.pathsend"
            },
        }
        try:
            await super().__call__(scope, receive, send)
        finally:
            self.snapshot.cleanup()


def validated_response(source: Path, artifact: ReleaseArtifact):
    if not 0 < artifact.size <= MAX_PACKAGE_SIZE:
        raise ReleaseManifestError("Package size is outside allowed bounds")
    snapshot = tempfile.TemporaryDirectory(prefix="holy-release-")
    try:
        path = Path(snapshot.name) / artifact.name
        total = 0
        with source.open("rb") as reader, path.open("xb") as writer:
            while block := reader.read(1024 * 1024):
                total += len(block)
                if total > artifact.size:
                    raise ReleaseManifestError("Artifact exceeds its declared size")
                writer.write(block)
        verify_artifact(path, artifact)
        return ValidatedArtifactResponse(snapshot, artifact)
    except BaseException:
        snapshot.cleanup()
        raise
