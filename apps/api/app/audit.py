"""Bounded, non-secret platform audit records; never retry through the logger."""

import logging
import re
from datetime import datetime, timezone

from sqlalchemy import insert, select
from sqlalchemy.exc import SQLAlchemyError

from .db_platform import app_audit, app_patients, app_profiles, new_uuid

log = logging.getLogger("vitalis.audit")
SAFE_KEYS = {
    "resource_id", "vitals_id", "alert_id", "state", "is_mock", "fields",
    "outcome", "status_code", "reason", "model_version", "source",
    "bridge_device_id",
}

SENSITIVE_KEYS = re.compile(r"password|secret|token|api.?key|authorization|cookie|document.?text|raw.?text", re.I)
SECRET_TEXT = re.compile(
    r"(?i)\bBearer\s+\S+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"
    r"|\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+"
    r"|(?:password|secret|token|api[_-]?key)\s*[:=]\s*\S+"
)


def redact_metadata(value, depth=0):
    """Preserve legacy demo messages while removing credential-shaped content."""
    if depth > 5:
        return "[omitted]"
    if isinstance(value, dict):
        return {str(k): "[redacted]" if SENSITIVE_KEYS.search(str(k)) else redact_metadata(v, depth + 1)
                for k, v in list(value.items())[:64]}
    if isinstance(value, list):
        return [redact_metadata(v, depth + 1) for v in value[:64]]
    if isinstance(value, str):
        return SECRET_TEXT.sub("[redacted]", value)[:1024]
    return value


def safe_metadata(details: dict) -> dict:
    """Allow structural metadata only, not arbitrary requests or document text."""
    result = {}
    for key, value in details.items():
        if key not in SAFE_KEYS:
            continue
        if isinstance(value, bool) or isinstance(value, int) or value is None:
            result[key] = value
        elif key == "fields" and isinstance(value, list):
            result[key] = [v for v in value[:32] if isinstance(v, str) and v.isidentifier()][:32]
        elif isinstance(value, str) and len(value) <= 128:
            # IDs/enums/version identifiers only; free-form strings can contain credentials.
            if all(c.isalnum() or c in "_.:-" for c in value) and not value.startswith(("eyJ", "sb_")):
                result[key] = value
    result.setdefault("outcome", "success")
    return result


def write_audit(engine, actor_id, patient_id, event_type, details) -> bool:
    """Core mutations already committed: report audit failure without false 500/retry.

    References may disappear on deletion or before profile provisioning. Keep the
    resource UUID in safe metadata and use nullable FKs in those cases.
    """
    try:
        if engine is None:
            raise RuntimeError("audit database unavailable")
        with engine.begin() as conn:
            actor = actor_id if actor_id and conn.execute(
                select(app_profiles.c.id).where(app_profiles.c.id == actor_id)
            ).first() else None
            patient = patient_id if patient_id and conn.execute(
                select(app_patients.c.id).where(app_patients.c.id == patient_id)
            ).first() else None
            metadata = safe_metadata(details)
            if patient_id:
                metadata["resource_id"] = str(patient_id)
            conn.execute(insert(app_audit).values(
                id=new_uuid(), actor_id=actor, patient_id=patient,
                event_type=event_type, details=metadata,
                created_at=datetime.now(timezone.utc),
            ))
        return True
    except (SQLAlchemyError, RuntimeError):
        # SQLAlchemy exception strings can include connection strings/SQL parameters.
        log.error("Audit write failed for event_type=%s; core operation is unchanged", event_type)
        return False
