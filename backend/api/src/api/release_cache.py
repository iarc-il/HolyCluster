from starlette.types import ASGIApp, Message, Receive, Scope, Send


class ReleaseCacheMiddleware:
    """Release metadata and downloads must not survive an upstream change."""

    def __init__(self, app: ASGIApp):
        self.app = app

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

        await self.app(scope, receive, send_uncached)
