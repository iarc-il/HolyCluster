import os

from fastapi.staticfiles import StaticFiles

IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable"


class ImmutableStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code in {200, 304}:
            response.headers["Cache-Control"] = IMMUTABLE_CACHE_CONTROL
        return response


class OptionalStaticFiles(StaticFiles):
    """Serves 404 instead of failing while its directory does not exist."""

    def __init__(self, *, directory):
        super().__init__(directory=directory, check_dir=False)

    async def check_config(self):
        if self.directory is not None and os.path.isdir(self.directory):
            await super().check_config()
