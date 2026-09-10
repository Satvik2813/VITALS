"""Bound POST bodies before multipart parsing, including chunked transfers."""

from starlette.responses import JSONResponse


class BodyLimit:
    def __init__(self, app, limit: int = 5 * 1024 * 1024 + 16384):
        self.app = app
        self.limit = limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in ("POST", "PUT", "PATCH", "DELETE"):
            return await self.app(scope, receive, send)
        # JSON mutations have no reason to consume the full document allowance.
        limit = self.limit if scope["path"].endswith("/documents") else 64 * 1024
        data = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(data) + len(chunk) > limit:
                return await JSONResponse({"detail": "Request body exceeds size limit"}, status_code=413)(
                    scope, receive, send
                )
            data.extend(chunk)
            if not message.get("more_body", False):
                break
        sent = False

        async def replay():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": bytes(data), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)
