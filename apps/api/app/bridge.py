"""Permanent VITALIS Bridge Code and Android bridge-device credentials.

The pairing story, end to end:

  1. An authenticated patient opens their dashboard. `GET /api/v1/bridge/code`
     mints (once, lazily) one permanent code for their patient record and
     returns it: ``VTL-8F4K-29QX``.
  2. The patient types that code into the VITALIS-Bridge Android app, which
     calls `POST /api/v1/bridge/pair` -- an unauthenticated endpoint whose
     *only* input is the code plus the handset's self-reported identity.
  3. The backend resolves the code to exactly one patient and returns an
     opaque bearer credential (``vtb_...``). The Android client never sends,
     and is never trusted with, a patient id.
  4. Every later bridge call authenticates with that credential; the patient
     identity is derived from it server-side.

Security properties this module is responsible for:

  * The code carries no identity. It is 40 bits of ``secrets``-grade entropy
    over an unambiguous alphabet -- nothing about the patient, their email,
    or a JWT is recoverable from it.
  * The code is looked up by SHA-256 digest, never by plaintext equality, so
    a submitted code never lands in a query predicate or statement log.
  * The device credential is stored only as a SHA-256 digest. The plaintext
    exists exactly once, in the pairing response.
  * Nothing here ever logs a code or a token.

Codes are permanent by design (the patient reads it once and keeps it).
Brute force is bounded instead by the dedicated per-peer rate limit on
`POST /api/v1/bridge/pair` (see app.security.SecurityControls) and by the
patient's ability to rotate the code from their dashboard.
"""

from __future__ import annotations

import hashlib
import os
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import and_, select, update
from sqlalchemy.engine import Engine

from .db_platform import app_bridge_devices, app_patients

# Crockford-style base32 without I, L, O and U: no character pair that is
# ambiguous when read aloud, handwritten, or typed on a phone keyboard.
CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
CODE_BODY_LENGTH = 8
CODE_PREFIX = "VTL"
CODE_PATTERN = re.compile(r"^VTL-[0-9A-HJKMNP-TVWXYZ]{4}-[0-9A-HJKMNP-TVWXYZ]{4}$")

# Typo repair applied to the *body* only -- never to the "VTL" prefix, whose
# own L would otherwise be rewritten to 1.
_CONFUSABLES = str.maketrans({"O": "0", "I": "1", "L": "1"})

TOKEN_PREFIX = "vtb_"
TOKEN_BYTES = 32
MAX_DEVICE_ID = 128
MAX_DEVICE_NAME = 120
# Avoid a database write on every single bridge request just to move a
# last-seen clock forward by a few seconds.
LAST_SEEN_THROTTLE = timedelta(seconds=60)

bridge_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class BridgeDevice:
    """The authenticated caller behind a ``vtb_`` credential."""

    id: str
    patient_id: str
    device_id: str
    device_name: str | None
    created_at: datetime
    last_seen_at: datetime | None
    # The patient's own login identity, when they have one. Used as the
    # provenance actor for rows the bridge writes; never taken from the client.
    patient_user_id: str | None


def generate_bridge_code() -> str:
    body = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_BODY_LENGTH))
    return f"{CODE_PREFIX}-{body[:4]}-{body[4:]}"


def normalize_bridge_code(raw: str | None) -> str:
    """Canonicalise user input to ``VTL-XXXX-XXXX`` or raise ValueError.

    Accepts the code with any (or no) separators and in any case, and repairs
    the classic confusions (O/0, I/1, L/1) so a patient reading the code off a
    screen onto a phone keypad is not punished for a font.
    """
    if not isinstance(raw, str) or len(raw) > 64:
        raise ValueError("Invalid bridge code")
    compact = re.sub(r"[^A-Za-z0-9]", "", raw).upper()
    if not compact.startswith(CODE_PREFIX):
        raise ValueError("Invalid bridge code")
    body = compact[len(CODE_PREFIX):].translate(_CONFUSABLES)
    if len(body) != CODE_BODY_LENGTH or any(c not in CODE_ALPHABET for c in body):
        raise ValueError("Invalid bridge code")
    return f"{CODE_PREFIX}-{body[:4]}-{body[4:]}"


def hash_bridge_code(code: str) -> str:
    """Lookup digest for a canonical code.

    Not a password hash: the code is also stored readably so the patient can
    display it, so a slow KDF here would buy nothing. Its job is to keep the
    plaintext out of SQL predicates and statement logs.
    """
    return hashlib.sha256(code.encode("ascii")).hexdigest()


def issue_device_token() -> tuple[str, str]:
    """Return ``(plaintext, digest)``. Only the digest is ever persisted."""
    token = TOKEN_PREFIX + secrets.token_urlsafe(TOKEN_BYTES)
    return token, hash_device_token(token)


def hash_device_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def sanitize_device_id(raw: str | None) -> str:
    """A stable, client-chosen handset identifier -- opaque to us.

    It is scoped to the patient it pairs with (UNIQUE (patient_id, device_id)),
    so it grants nothing on its own; we only bound it and strip control
    characters so it is safe to store and echo back.
    """
    value = "".join(c for c in (raw or "").strip() if c.isprintable())[:MAX_DEVICE_ID]
    if not value:
        raise ValueError("device_id is required")
    return value


def sanitize_device_name(raw: str | None) -> str | None:
    value = "".join(c for c in (raw or "").strip() if c.isprintable())[:MAX_DEVICE_NAME]
    return value or None


def pair_rate_limit() -> int:
    try:
        return max(1, int(os.getenv("VITALIS_BRIDGE_PAIR_RATE_LIMIT", "10")))
    except ValueError:
        return 10


def _engine(request: Request) -> Engine:
    engine = getattr(request.app.state, "platform_engine", None)
    if engine is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Platform database is not configured.")
    return engine


def current_bridge_device(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bridge_scheme),
) -> BridgeDevice:
    """Authenticate a paired Android device from its ``vtb_`` bearer token.

    Deliberately shaped like app.auth.current_user so the two credential
    families cannot be confused: a Supabase JWT will not authenticate a bridge
    route, and a device token will not authenticate a patient route.
    """
    token = creds.credentials if creds else ""
    if not token or not token.startswith(TOKEN_PREFIX) or len(token) > 512:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Bridge device credential required",
                            headers={"WWW-Authenticate": "Bearer"})
    engine = _engine(request)
    now = datetime.now(timezone.utc)
    with engine.connect() as conn:
        row = conn.execute(
            select(
                app_bridge_devices.c.id,
                app_bridge_devices.c.patient_id,
                app_bridge_devices.c.device_id,
                app_bridge_devices.c.device_name,
                app_bridge_devices.c.created_at,
                app_bridge_devices.c.last_seen_at,
                app_bridge_devices.c.revoked_at,
                app_patients.c.user_id,
            )
            .select_from(app_bridge_devices.join(
                app_patients, app_patients.c.id == app_bridge_devices.c.patient_id
            ))
            .where(app_bridge_devices.c.token_hash == hash_device_token(token))
        ).mappings().first()
    # One generic answer for "no such token" and "revoked token": a caller
    # holding a stale credential learns only that it no longer works.
    if not row or row["revoked_at"] is not None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Bridge device is not paired",
                            headers={"WWW-Authenticate": "Bearer"})

    last_seen = row["last_seen_at"]
    if last_seen is not None and last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    if last_seen is None or now - last_seen >= LAST_SEEN_THROTTLE:
        with engine.begin() as conn:
            conn.execute(
                update(app_bridge_devices)
                .where(and_(app_bridge_devices.c.id == row["id"],
                            app_bridge_devices.c.revoked_at.is_(None)))
                .values(last_seen_at=now)
            )
        last_seen = now

    return BridgeDevice(
        id=str(row["id"]),
        patient_id=str(row["patient_id"]),
        device_id=row["device_id"],
        device_name=row["device_name"],
        created_at=row["created_at"],
        last_seen_at=last_seen,
        patient_user_id=None if row["user_id"] is None else str(row["user_id"]),
    )
