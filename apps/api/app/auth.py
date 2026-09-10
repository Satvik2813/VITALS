"""Supabase JWT verification for the v1 authenticated API.

The Next.js frontend obtains a Supabase session (Google OAuth -> Supabase Auth).
This module verifies HS256 with the backend secret, or ES256/RS256 with the
configured project's cached public JWKS. It validates issuer, audience, expiry,
issued-at, authenticated role and UUID subject before producing `CurrentUser`.

Environment:
  * SUPABASE_URL -- required project URL, also binds issuer/JWKS.
  * SUPABASE_JWT_SECRET -- backend-only, needed only for legacy HS256 tokens.
  * VITALIS_ALLOWED_EMAILS -- optional comma-separated allowlist enforced
                              server-side in addition to Supabase Auth.

In DEMO_MODE (default), a request without a Bearer token still 401s on v1;
demo endpoints under /api/* remain reachable via the legacy localhost bypass
in main.py. Set VITALIS_DEMO_USER=<email> to inject a synthetic user for local
integration tests without a real Supabase session.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Any
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .audit import write_audit

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str
    role: str = "authenticated"
    metadata: dict[str, Any] | None = None


def _allowed_emails() -> set[str]:
    raw = os.getenv("VITALIS_ALLOWED_EMAILS", "").strip()
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def _demo_user() -> CurrentUser | None:
    email = os.getenv("VITALIS_DEMO_USER", "").strip().lower()
    if not email:
        return None
    return CurrentUser(id=os.getenv("VITALIS_DEMO_USER_ID", "00000000-0000-0000-0000-000000000001"),
                       email=email, role="doctor")


def _verify_supabase_jwt(token: str) -> CurrentUser:
    if len(token) > 16384:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    secret = os.getenv("SUPABASE_JWT_SECRET", "")
    if not url:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Server is not configured for authenticated requests.")
    try:
        algorithm = jwt.get_unverified_header(token).get("alg")
        if algorithm == "HS256" and secret:
            key = secret
        elif algorithm in ("ES256", "RS256"):
            key = _jwks_client(url).get_signing_key_from_jwt(token).key
        else:
            raise jwt.InvalidAlgorithmError()
        payload = jwt.decode(
            token,
            key,
            algorithms=[algorithm],
            audience="authenticated",
            issuer=f"{url}/auth/v1",
            options={"require": ["exp", "sub", "iss", "aud", "iat", "role"]},
            # Tolerate small clock skew between this server and Supabase's auth
            # server for the exp/iat/nbf checks (PyJWT defaults to zero leeway,
            # which is unusually strict for a distributed system -- Auth0,
            # Cognito, and Okta client libraries all default to a similar
            # nonzero leeway for this exact reason).
            leeway=30,
        )
    except jwt.PyJWKClientConnectionError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Authentication temporarily unavailable") from exc
    except (jwt.PyJWTError, ValueError, TypeError) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token") from exc

    sub = payload.get("sub")
    email = payload.get("email")
    if not isinstance(email, str) or not email or len(email) > 320:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Malformed token")
    email = email.lower()
    try:
        UUID(sub)
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Malformed token") from exc
    if payload.get("role") != "authenticated" or payload.get("is_anonymous") is True:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Malformed token")

    allow = _allowed_emails()
    if allow and email not in allow:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Email not permitted")

    return CurrentUser(
        id=str(sub),
        email=email,
        role=payload.get("role", "authenticated"),
        metadata=payload.get("user_metadata") if isinstance(payload.get("user_metadata"), dict) else {},
    )


@lru_cache(maxsize=4)
def _jwks_client(url: str):
    # Never fetch a URL from an unverified JWT (iss/jku/x5u).
    return jwt.PyJWKClient(f"{url}/auth/v1/.well-known/jwks.json", timeout=5, lifespan=300)


def current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> CurrentUser:
    demo = _demo_user()
    engine = getattr(request.app.state, "platform_engine", None)
    local_demo = (
        os.getenv("DEMO_MODE", "true").lower() == "true"
        and request.client and request.client.host in ("127.0.0.1", "::1", "testclient")
        and request.url.hostname in ("localhost", "127.0.0.1", "testserver")
        and engine is not None and engine.dialect.name == "sqlite"
    )
    if demo is not None and local_demo and (creds is None or not creds.credentials):
        return demo
    try:
        if creds is None or not creds.credentials:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authorization required")
        user = _verify_supabase_jwt(creds.credentials)
        write_audit(engine, user.id, None, "AUTHENTICATED", {
            "source": "verified_jwt", "resource_id": user.id,
        })
        return user
    except HTTPException as exc:
        write_audit(engine, None, None, "AUTHENTICATION_FAILED", {
            "outcome": "failure", "status_code": exc.status_code,
        })
        if exc.status_code == 401:
            exc.headers = {**(exc.headers or {}), "WWW-Authenticate": "Bearer"}
        raise
