from starlette.middleware.errors import ServerErrorMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class ReleaseCacheMiddleware:
    """Release metadata and downloads must not survive an upstream change."""

    def __init__(self, app: ASGIApp):
        self.app = app
        self.error_boundary = ServerErrorMiddleware(app)

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        path = scope.get("path", "")
        if scope["type"] != "http" or not (path == "/catserver" or path.startswith("/catserver/")):
            await self.app(scope, receive, send)
            return

        async def send_uncached(message: Message):
            if message["type"] == "http.response.start":
                message = {
                    **message,
                    "headers": [
                        (key, value)
                        for key, value in message.get("headers", [])
                        if key.lower() not in {b"cache-control", b"etag", b"last-modified", b"expires"}
                    ]
                    + [(b"cache-control", b"no-store")],
                }
            await send(message)

        # FastAPI's outer error handler otherwise emits 500 outside this policy.
        # This boundary still re-raises the exception for logging and monitoring.
        await self.error_boundary(scope, receive, send_uncached)
