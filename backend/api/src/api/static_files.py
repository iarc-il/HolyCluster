from fastapi.staticfiles import StaticFiles

IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable"


class ImmutableStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code in {200, 304}:
            response.headers["Cache-Control"] = IMMUTABLE_CACHE_CONTROL
        return response
