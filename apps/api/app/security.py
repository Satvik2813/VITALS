"""Small single-process HTTP controls.

Client identity for rate limiting
---------------------------------
By default the ASGI peer address is the identity and no forwarded header is
trusted -- correct when the backend is reached directly.

In the deployed topology it is not reached directly: every browser and Android
request arrives via the Next.js server-side proxy, so the peer is a single
address and a "per-peer" limit silently degrades into one global bucket for the
entire platform. That inverts the control -- the pairing brute-force bound
becomes a trivial denial of service against all patients, and a handful of
bridge devices exhausts the platform's whole write allowance.

The fix is an explicitly authenticated proxy, never an unauthenticated header:

  * `VITALIS_PROXY_SECRET` is a shared secret held only by the web tier and
    this service. A request may declare a client identity ONLY if it presents
    that secret in `X-Vitalis-Proxy-Secret` (constant-time compared).
  * With the secret valid, the identity comes from `X-Vitalis-Client` (set by
    the Next proxy from its own platform-trusted client address), falling back
    to the right-most `X-Forwarded-For` entry -- the hop appended by the
    nearest trusted proxy, not a value a client can prepend.
  * Without the secret configured, or with a wrong/absent one, the peer
    address is used exactly as before. An untrusted caller can therefore never
    choose its own rate-limit bucket by sending a header.

Set `VITALIS_PROXY_SECRET` only when the web tier itself sits behind a trusted
edge that overwrites `X-Forwarded-For` (e.g. Vercel). See docs/DEPLOYMENT.md.
"""

import logging
import os
import secrets
import threading
import time
from collections import OrderedDict
from urllib.parse import urlsplit

from starlette.datastructures import MutableHeaders
from starlette.responses import JSONResponse

from .bridge import pair_rate_limit as bridge_pair_rate_limit

log = logging.getLogger("vitalis.security")

# Bounded so a hostile header cannot bloat limiter keys, and restricted to the
# characters an IPv4/IPv6 address or hostname can contain.
MAX_CLIENT_ID = 64
_CLIENT_ID_CHARS = set("0123456789abcdefABCDEF.:_-")


def proxy_secret() -> str:
    return os.getenv("VITALIS_PROXY_SECRET", "").strip()


def _sanitize_client_id(raw: str | None) -> str | None:
    if not raw:
        return None
    value = raw.strip()
    if not value or len(value) > MAX_CLIENT_ID:
        return None
    if not all(c in _CLIENT_ID_CHARS for c in value):
        return None
    return value


def client_identity(scope, secret: str) -> str:
    """The rate-limit bucket key for this request.

    Returns a namespaced key so a forwarded identity can never collide with a
    peer identity.
    """
    peer = (scope.get("client") or ("unknown", 0))[0]
    if not secret:
        return f"peer:{peer}"
    headers = {k.decode("latin-1").lower(): v.decode("latin-1")
               for k, v in scope.get("headers") or []}
    presented = headers.get("x-vitalis-proxy-secret", "")
    if not presented or not secrets.compare_digest(presented, secret):
        # Wrong or missing secret: fall back to the peer. Never honour a
        # client-declared identity.
        return f"peer:{peer}"
    forwarded = _sanitize_client_id(headers.get("x-vitalis-client"))
    if forwarded is None:
        chain = headers.get("x-forwarded-for", "")
        # Right-most entry: appended by the nearest proxy. Left-most entries
        # are client-supplied and must not be trusted.
        forwarded = _sanitize_client_id(chain.rsplit(",", 1)[-1]) if chain else None
    if forwarded is None:
        return f"peer:{peer}"
    return f"fwd:{forwarded}"


def cors_origins(demo_mode: bool) -> list[str]:
    raw = os.getenv("VITALIS_CORS_ORIGINS")
    origins = raw.split(",") if raw is not None else (
        ["http://localhost:3000", "http://127.0.0.1:3000"] if demo_mode else []
    )
    result = []
    for value in origins:
        origin = value.strip().rstrip("/")
        if not origin:
            continue
        parsed = urlsplit(origin)
        if (parsed.scheme not in ("http", "https") or not parsed.hostname
                or "*" in origin or parsed.username or parsed.password
                or parsed.path or parsed.query or parsed.fragment):
            raise ValueError("VITALIS_CORS_ORIGINS must contain explicit HTTP(S) origins")
        result.append(origin)
    return list(dict.fromkeys(result))


class WindowLimiter:
    def __init__(self, clock=time.monotonic, max_keys=4096):
        self.clock = clock
        self.max_keys = max_keys
        self.entries = OrderedDict()
        self.lock = threading.Lock()

    def allow(self, key, limit):
        with self.lock:
            now = self.clock()
            while self.entries and next(iter(self.entries.values()))[0] <= now - 60:
                self.entries.popitem(last=False)
            entry = self.entries.get(key)
            if entry is None:
                if len(self.entries) >= self.max_keys:
                    return False
                entry = [now, 0]
                self.entries[key] = entry
            if entry[1] >= limit:
                return False
            entry[1] += 1
            return True


class SecurityControls:
    def __init__(self, app):
        self.app = app
        self.limiter = WindowLimiter()
        self.auth_limit = max(1, int(os.getenv("VITALIS_AUTH_RATE_LIMIT", "120")))
        self.upload_limit = max(1, int(os.getenv("VITALIS_UPLOAD_RATE_LIMIT", "20")))
        self.mutation_limit = max(1, int(os.getenv("VITALIS_MUTATION_RATE_LIMIT", "120")))
        # Bridge codes are permanent, so pairing is the one endpoint where a
        # patient attacker gets unlimited guesses at a fixed secret. Bound it
        # far more tightly than ordinary mutations.
        self.bridge_pair_limit = bridge_pair_rate_limit()
        # Continuous wearable ingestion is high-frequency by design and must
        # not share the general mutation budget: at the documented ~2s cadence
        # one handset alone is 30 writes/minute, so a shared 120/min bucket is
        # exhausted by four devices. Its own category, sized for one reading
        # per second per client.
        self.bridge_vitals_limit = max(
            1, int(os.getenv("VITALIS_BRIDGE_VITALS_RATE_LIMIT", "60"))
        )
        self.read_limit = max(1, int(os.getenv("VITALIS_READ_RATE_LIMIT", "600")))
        self.proxy_secret = proxy_secret()
        # Only worth shouting about where it actually matters. In local demo
        # mode the peer IS the client, so peer-keyed limits are correct.
        if not self.proxy_secret and os.getenv("DEMO_MODE", "true").lower() != "true":
            log.warning(
                "VITALIS_PROXY_SECRET is not set: rate limits are keyed on the ASGI peer "
                "address. If this service is reached through the Next.js proxy, that is a "
                "single global bucket for the whole platform. See docs/DEPLOYMENT.md."
            )

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def secure_send(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["X-Content-Type-Options"] = "nosniff"
                headers["X-Frame-Options"] = "DENY"
                headers["Referrer-Policy"] = "no-referrer"
                headers["Cache-Control"] = "no-store"
            await send(message)

        path, method = scope["path"], scope["method"]
        client = client_identity(scope, self.proxy_secret)
        category, limit = None, None
        if path == "/api/v1/bridge/pair" and method == "POST":
            category, limit = "bridge_pair", self.bridge_pair_limit
        elif path == "/api/v1/bridge/vitals" and method == "POST":
            category, limit = "bridge_vitals", self.bridge_vitals_limit
        elif method in ("POST", "PUT", "PATCH", "DELETE") and path.startswith("/api/"):
            category, limit = ("upload", self.upload_limit) if path.endswith("/documents") else (
                "mutation", self.mutation_limit
            )
        elif path == "/api/v1/me":
            category, limit = "auth", self.auth_limit
        # Bound authentication attempts on all v1 reads as well as /me.
        if path.startswith("/api/v1/") and category is None:
            category, limit = "read", self.read_limit
        if category and not self.limiter.allow((client, category), limit):
            log.warning("Rate limit exceeded category=%s", category)
            return await JSONResponse(
                {"detail": "Too many requests"}, status_code=429, headers={"Retry-After": "60"}
            )(scope, receive, secure_send)
        await self.app(scope, receive, secure_send)
