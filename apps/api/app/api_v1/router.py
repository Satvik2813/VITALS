"""VITALIS authenticated v1 API.

All routes here require a Supabase session (bearer JWT). Access control is
enforced twice: application-level ownership checks below AND Postgres RLS on
the `app_*` tables (see supabase/migrations/*_auth_platform.sql).

The dependency graph is intentionally shallow:
    request -> current_user (JWT) -> engine (SQLAlchemy) -> handler
"""

from __future__ import annotations

import logging
import os
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID
from typing import Iterable

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy import and_, delete, insert, or_, select, update
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool

from .. import gateway
from ..auth import CurrentUser, current_user
from ..bridge import (
    BridgeDevice,
    current_bridge_device,
    generate_bridge_code,
    hash_bridge_code,
    issue_device_token,
    normalize_bridge_code,
    sanitize_device_id,
    sanitize_device_name,
)
from ..audit import write_audit as _write_audit
from ..db_platform import (
    app_alerts,
    app_bridge_codes,
    app_bridge_devices,
    app_doctor_patients,
    app_documents,
    app_patients,
    app_profiles,
    app_risk,
    app_vitals,
    new_uuid,
)
from ..ml import RiskPredictor, VitalsFeatures, canonical_state, get_predictor
from ..schemas import (
    AlertOut,
    BridgeCodeResponse,
    BridgeDeviceOut,
    BridgePairRequest,
    BridgePairResponse,
    BridgePatientSummary,
    BridgeSessionResponse,
    BridgeVitalsIn,
    DocumentOut,
    DoctorOnboardingRequest,
    DoctorSummary,
    HistoryOut,
    MeResponse,
    Patient,
    PatientCreate,
    PatientOnboardingRequest,
    PatientUpdate,
    PredictRequest,
    PredictResponse,
    RiskOut,
    VitalsIn,
    VitalsMeasurement,
    VitalsOut,
)

MAX_DOCUMENT_UPLOAD = 5 * 1024 * 1024

log = logging.getLogger("vitalis.api_v1")

# Ordering for alert hysteresis in _record_vitals. Mirrors the severities
# allowed by `app_alerts.severity`'s CHECK constraint.
ALERT_SEVERITY_RANK: dict[str, int] = {"info": 0, "watch": 1, "warning": 2, "critical": 3}

router = APIRouter(prefix="/api/v1", tags=["v1"])


def get_engine(request: Request) -> Engine:
    engine = getattr(request.app.state, "platform_engine", None)
    if engine is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Platform database is not configured.")
    return engine


def get_ml() -> RiskPredictor:
    return get_predictor()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_profile(engine: Engine, user: CurrentUser) -> None:
    """Create a bare profile row for a first-seen identity.

    Role is intentionally left unset (None) for real users: it is assigned by
    the /onboarding/* endpoints once the person picks Patient or Doctor on
    /get-started, never defaulted here. Google user metadata is display-only
    and is never used to grant a role.

    The VITALIS_DEMO_USER local-testing bypass (see app.auth._demo_user) is
    the one exception: it represents a synthetic doctor identity used only to
    exercise the pre-existing doctor-oriented endpoints in tests without a
    real Supabase session, so it is bootstrapped as an already-onboarded
    doctor to match its existing, documented test contract.
    """
    with engine.begin() as conn:
        exists = conn.execute(select(app_profiles.c.id).where(app_profiles.c.id == user.id)).first()
        if exists:
            return
        now = _now()
        full = (user.metadata or {}).get("full_name")
        avatar = (user.metadata or {}).get("avatar_url")
        full = full[:200] if isinstance(full, str) else None
        avatar = avatar[:2048] if isinstance(avatar, str) else None
        is_demo_bypass = user.role == "doctor"
        conn.execute(insert(app_profiles).values(
            id=user.id,
            email=user.email,
            full_name=full,
            avatar_url=avatar,
            role="doctor" if is_demo_bypass else None,
            onboarding_completed=is_demo_bypass,
            created_at=now,
            updated_at=now,
        ))


def _patient_access_filter(user_id: str):
    """Rows visible to `user_id`: patients they own, patients they were
    granted access to, or their own self-registered patient record."""
    return or_(
        app_patients.c.owner_id == user_id,
        app_patients.c.user_id == user_id,
        app_patients.c.id.in_(
            select(app_doctor_patients.c.patient_id).where(
                app_doctor_patients.c.doctor_id == user_id
            )
        ),
    )


def _load_patient(engine: Engine, user: CurrentUser, patient_id: str) -> dict:
    try:
        UUID(patient_id)
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found") from exc
    with engine.connect() as conn:
        row = conn.execute(
            select(app_patients).where(
                and_(app_patients.c.id == patient_id, _patient_access_filter(user.id))
            )
        ).mappings().first()
    if not row:
        # 404 whether the patient doesn't exist or the caller isn't authorized;
        # never leak existence.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")
    return dict(row)


# ---------- /me ----------
@router.get("/me", response_model=MeResponse)
def me(user: CurrentUser = Depends(current_user), engine: Engine = Depends(get_engine)):
    _ensure_profile(engine, user)
    with engine.connect() as conn:
        row = conn.execute(select(app_profiles).where(app_profiles.c.id == user.id)).mappings().first()
    return MeResponse(
        id=user.id,
        email=user.email,
        full_name=row["full_name"] if row else None,
        avatar_url=row["avatar_url"] if row else None,
        role=row["role"] if row else None,
        onboarding_completed=bool(row["onboarding_completed"]) if row else False,
        phone=row.get("phone") if row else None,
        specialization=row.get("specialization") if row else None,
        hospital=row.get("hospital") if row else None,
    )


# ---------- /doctors (for the patient-onboarding doctor picker) ----------
@router.get("/doctors", response_model=list[DoctorSummary])
def list_doctors(user: CurrentUser = Depends(current_user), engine: Engine = Depends(get_engine)):
    _ensure_profile(engine, user)
    with engine.connect() as conn:
        rows = conn.execute(
            select(app_profiles.c.id, app_profiles.c.full_name, app_profiles.c.specialization,
                   app_profiles.c.hospital)
            .where(and_(app_profiles.c.role == "doctor", app_profiles.c.onboarding_completed.is_(True)))
            .order_by(app_profiles.c.full_name)
        ).mappings().all()
    return [DoctorSummary(id=str(r["id"]), full_name=r["full_name"],
                           specialization=r["specialization"], hospital=r["hospital"]) for r in rows]


# ---------- /onboarding ----------
@router.post("/onboarding/doctor", response_model=MeResponse)
def onboard_doctor(body: DoctorOnboardingRequest, user: CurrentUser = Depends(current_user),
                    engine: Engine = Depends(get_engine)):
    _ensure_profile(engine, user)
    with engine.begin() as conn:
        row = conn.execute(select(app_profiles).where(app_profiles.c.id == user.id)).mappings().first()
        if row and row["onboarding_completed"]:
            raise HTTPException(status.HTTP_409_CONFLICT, "Onboarding already completed")
        now = _now()
        conn.execute(update(app_profiles).where(app_profiles.c.id == user.id).values(
            role="doctor",
            onboarding_completed=True,
            full_name=body.full_name,
            phone=body.phone,
            specialization=body.specialization,
            hospital=body.hospital,
            medical_registration=body.medical_registration,
            updated_at=now,
        ))
        row = conn.execute(select(app_profiles).where(app_profiles.c.id == user.id)).mappings().first()
    _write_audit(engine, user.id, None, "DOCTOR_ONBOARDED", {})
    return MeResponse(
        id=user.id, email=user.email, full_name=row["full_name"], avatar_url=row["avatar_url"],
        role=row["role"], onboarding_completed=True, phone=row["phone"],
        specialization=row["specialization"], hospital=row["hospital"],
    )


@router.post("/onboarding/patient", response_model=Patient, status_code=status.HTTP_201_CREATED)
def onboard_patient(body: PatientOnboardingRequest, user: CurrentUser = Depends(current_user),
                     engine: Engine = Depends(get_engine)):
    _ensure_profile(engine, user)
    try:
        UUID(body.assigned_doctor_id)
    except (ValueError, TypeError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "assigned_doctor_id must be a valid id")
    with engine.begin() as conn:
        profile = conn.execute(select(app_profiles).where(app_profiles.c.id == user.id)).mappings().first()
        if profile and profile["onboarding_completed"]:
            raise HTTPException(status.HTTP_409_CONFLICT, "Onboarding already completed")
        existing = conn.execute(
            select(app_patients.c.id).where(app_patients.c.user_id == user.id)
        ).first()
        if existing:
            raise HTTPException(status.HTTP_409_CONFLICT, "A patient record is already linked to this account")
        doctor = conn.execute(
            select(app_profiles.c.id).where(and_(
                app_profiles.c.id == body.assigned_doctor_id,
                app_profiles.c.role == "doctor",
                app_profiles.c.onboarding_completed.is_(True),
            ))
        ).first()
        if not doctor:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Selected doctor is not available")
        now = _now()
        pid = new_uuid()
        values = {
            "id": pid,
            "owner_id": body.assigned_doctor_id,
            "user_id": user.id,
            "full_name": body.full_name,
            "date_of_birth": body.date_of_birth,
            "sex": body.sex,
            "phone": body.phone,
            "emergency_contact_name": body.emergency_contact_name,
            "emergency_contact_phone": body.emergency_contact_phone,
            "consent_accepted_at": now,
            "created_at": now,
            "updated_at": now,
        }
        conn.execute(insert(app_patients).values(**values))
        conn.execute(update(app_profiles).where(app_profiles.c.id == user.id).values(
            role="patient", onboarding_completed=True, full_name=body.full_name,
            phone=body.phone, updated_at=now,
        ))
    _write_audit(engine, user.id, pid, "PATIENT_ONBOARDED", {"resource_id": body.assigned_doctor_id})
    return _serialize_patient(values)


# ---------- /patients ----------
def _serialize_patient(row: dict) -> Patient:
    return Patient(
        id=str(row["id"]),
        owner_id=str(row["owner_id"]),
        user_id=None if row.get("user_id") is None else str(row["user_id"]),
        full_name=row["full_name"],
        mrn=row.get("mrn"),
        date_of_birth=row.get("date_of_birth"),
        sex=row.get("sex"),
        notes=row.get("notes"),
        phone=row.get("phone"),
        emergency_contact_name=row.get("emergency_contact_name"),
        emergency_contact_phone=row.get("emergency_contact_phone"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("/patients", response_model=list[Patient])
def list_patients(user: CurrentUser = Depends(current_user), engine: Engine = Depends(get_engine)):
    _ensure_profile(engine, user)
    with engine.connect() as conn:
        rows = conn.execute(
            select(app_patients).where(_patient_access_filter(user.id))
                                .order_by(app_patients.c.created_at.desc())
        ).mappings().all()
    return [_serialize_patient(dict(r)) for r in rows]


@router.post("/patients", response_model=Patient, status_code=status.HTTP_201_CREATED)
def create_patient(
    body: PatientCreate,
    user: CurrentUser = Depends(current_user),
    engine: Engine = Depends(get_engine),
):
    _ensure_profile(engine, user)
    now = _now()
    pid = new_uuid()
    values = {
        "id": pid,
        "owner_id": user.id,
        "full_name": body.full_name,
        "mrn": body.mrn,
        "date_of_birth": body.date_of_birth,
        "sex": body.sex,
        "notes": body.notes,
        "created_at": now,
        "updated_at": now,
    }
    with engine.begin() as conn:
        conn.execute(insert(app_patients).values(**values))
    _write_audit(engine, user.id, pid, "PATIENT_CREATED", {})
    return _serialize_patient(values)


@router.get("/patients/{patient_id}", response_model=Patient)
def get_patient(patient_id: str, user: CurrentUser = Depends(current_user),
                engine: Engine = Depends(get_engine)):
    return _serialize_patient(_load_patient(engine, user, patient_id))


SELF_EDITABLE_PATIENT_FIELDS = {"phone", "emergency_contact_name", "emergency_contact_phone"}


@router.patch("/patients/{patient_id}", response_model=Patient)
def update_patient(patient_id: str, body: PatientUpdate,
                   user: CurrentUser = Depends(current_user),
                   engine: Engine = Depends(get_engine)):
    row = _load_patient(engine, user, patient_id)
    is_owner = row["owner_id"] == user.id
    is_self = row.get("user_id") == user.id
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not is_owner:
        if not is_self:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner may edit this patient")
        # The patient may only touch their own safe contact fields, never
        # identity/clinical fields (full_name, mrn, dob, sex, notes).
        disallowed = set(changes) - SELF_EDITABLE_PATIENT_FIELDS
        if disallowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner may edit this patient")
    if not changes:
        return _serialize_patient(row)
    changes["updated_at"] = _now()
    with engine.begin() as conn:
        conn.execute(update(app_patients).where(app_patients.c.id == patient_id).values(**changes))
        row = conn.execute(select(app_patients).where(app_patients.c.id == patient_id)).mappings().first()
    _write_audit(engine, user.id, patient_id, "PATIENT_UPDATED", {"fields": list(changes.keys())})
    return _serialize_patient(dict(row))


@router.delete("/patients/{patient_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_patient(patient_id: str, user: CurrentUser = Depends(current_user),
                   engine: Engine = Depends(get_engine)):
    row = _load_patient(engine, user, patient_id)
    if row["owner_id"] != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner may delete this patient")
    with engine.begin() as conn:
        conn.execute(delete(app_patients).where(app_patients.c.id == patient_id))
    _write_audit(engine, user.id, patient_id, "PATIENT_DELETED", {})
    return None


# ---------- /patients/{id}/vitals ----------
def _serialize_vitals(row: dict) -> VitalsOut:
    return VitalsOut(
        id=str(row["id"]),
        patient_id=str(row["patient_id"]),
        recorded_at=row["recorded_at"],
        heart_rate=row.get("heart_rate"),
        spo2=row.get("spo2"),
        respiratory_rate=row.get("respiratory_rate"),
        temperature_c=None if row.get("temperature_c") is None else float(row["temperature_c"]),
        systolic_bp=row.get("systolic_bp"),
        diastolic_bp=row.get("diastolic_bp"),
        consciousness=row.get("consciousness"),
        supplemental_oxygen=row.get("supplemental_oxygen"),
        source=row.get("source"),
        device_id=row.get("device_id"),
        created_at=row["created_at"],
    )


@router.get("/patients/{patient_id}/vitals", response_model=list[VitalsOut])
def list_vitals(patient_id: str, limit: int = 100,
                user: CurrentUser = Depends(current_user),
                engine: Engine = Depends(get_engine)):
    _load_patient(engine, user, patient_id)
    limit = max(1, min(1000, limit))
    with engine.connect() as conn:
        rows = conn.execute(
            select(app_vitals).where(app_vitals.c.patient_id == patient_id)
                              .order_by(app_vitals.c.recorded_at.desc()).limit(limit)
        ).mappings().all()
    return [_serialize_vitals(dict(r)) for r in rows]


def _record_vitals(
    engine: Engine,
    ml: RiskPredictor,
    patient_id: str,
    body: VitalsMeasurement,
    *,
    source: str | None,
    device_id: str | None,
    created_by: str | None,
    actor_id: str | None,
    audit_source: str | None = None,
) -> dict:
    """The one and only vitals pipeline: persist -> predict -> risk -> alert.

    Callers differ solely in *who* is writing (a signed-in clinician or a
    paired bridge device) and in the provenance stamped on the row. Everything
    downstream -- risk assessment, alerting, Realtime fan-out to the doctor
    dashboard -- is identical, because there is deliberately no second path:
    bridge readings land in `app_vitals` exactly like every other reading.
    """
    if body.recorded_at.tzinfo is None:
        raise HTTPException(422, "recorded_at must include a timezone")
    now = _now()
    vid = new_uuid()
    values = {
        "id": vid,
        "patient_id": patient_id,
        "recorded_at": body.recorded_at,
        "heart_rate": body.heart_rate,
        "spo2": body.spo2,
        "respiratory_rate": body.respiratory_rate,
        "temperature_c": body.temperature_c,
        "systolic_bp": body.systolic_bp,
        "diastolic_bp": body.diastolic_bp,
        "consciousness": body.consciousness,
        "supplemental_oxygen": body.supplemental_oxygen,
        "source": source,
        "device_id": device_id,
        "created_by": created_by,
        "created_at": now,
    }
    # Idempotency: a handset that retries after a network failure must not
    # create a second reading (and, with it, a second risk row and a second
    # alert). `app_vitals_device_reading_key` -- UNIQUE (patient_id, device_id,
    # recorded_at) -- makes the replay collide; we translate that collision
    # into "return the reading we already have". Rows without a device_id are
    # unaffected: SQL treats NULLs as distinct, so manual clinician entries
    # never collide with each other.
    try:
        with engine.begin() as conn:
            conn.execute(insert(app_vitals).values(**values))
    except IntegrityError:
        # The insert aborted this transaction, so re-read on a fresh one.
        existing = None
        if device_id is not None:
            with engine.connect() as conn:
                existing = conn.execute(
                    select(app_vitals).where(and_(
                        app_vitals.c.patient_id == patient_id,
                        app_vitals.c.device_id == device_id,
                        app_vitals.c.recorded_at == body.recorded_at,
                    ))
                ).mappings().first()
        if existing is None:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "Could not record this reading") from None
        # Deliberately does NOT re-run the predictor or re-alert: the original
        # reading already went through the full pipeline.
        _write_audit(engine, actor_id, patient_id, "VITALS_DUPLICATE_IGNORED",
                     {"vitals_id": str(existing["id"]),
                      **({"source": audit_source} if audit_source else {})})
        return dict(existing)
    audit_detail: dict = {"vitals_id": vid}
    if audit_source:
        audit_detail["source"] = audit_source
    _write_audit(engine, actor_id, patient_id, "VITALS_INGESTED", audit_detail)
    # Run the predictor and persist the assessment so the dashboard has
    # something to show. Real ML replaces get_predictor() only.
    result = ml.predict(VitalsFeatures(
        patient_id=patient_id,
        recorded_at=body.recorded_at,
        heart_rate=body.heart_rate,
        spo2=body.spo2,
        respiratory_rate=body.respiratory_rate,
        temperature_c=body.temperature_c,
        systolic_bp=body.systolic_bp,
        consciousness=body.consciousness,
        supplemental_oxygen=body.supplemental_oxygen,
    ))
    # Defense in depth for the state contract. A predictor is pluggable
    # (VITALIS_ML_PREDICTOR), and a non-canonical state would violate
    # `app_risk_assessments.state`'s CHECK constraint on Postgres and fail the
    # whole ingestion. Normalise here too, so no predictor can break the
    # pipeline; app.ml.canonical_state is the single source of truth.
    state, state_mapped = canonical_state(result.state)
    risk_features = {**result.features, "is_mock": result.is_mock}
    if not state_mapped:
        risk_features["unmapped_model_state"] = True
        risk_features.setdefault("raw_model_state", result.state)
        log.warning("Predictor returned a non-canonical state; recorded as %s", state)
    with engine.begin() as conn:
        conn.execute(insert(app_risk).values(
            id=new_uuid(),
            patient_id=patient_id,
            vitals_id=vid,
            model_version=result.model_version,
            score=result.score,
            state=state,
            features=risk_features,
            created_at=result.computed_at,
        ))
        if state in ("WARNING", "CRITICAL"):
            severity = "critical" if state == "CRITICAL" else "warning"
            # Hysteresis. A deteriorating patient streaming every couple of
            # seconds would otherwise generate one identical alert per reading
            # -- an unreadable queue for the doctor and a Realtime event storm
            # for every subscribed dashboard. Suppress a new alert while an
            # equally- or more-severe RISK_STATE alert for this patient is
            # still unacknowledged; genuine escalation (an open `warning`
            # followed by a CRITICAL reading) still raises a new alert, and
            # once the doctor acknowledges, the next qualifying reading alerts
            # again. Acknowledgement behaviour itself is unchanged.
            open_alert = conn.execute(
                select(app_alerts.c.severity)
                .where(and_(app_alerts.c.patient_id == patient_id,
                            app_alerts.c.kind == "RISK_STATE",
                            app_alerts.c.acknowledged_at.is_(None)))
                .order_by(app_alerts.c.created_at.desc()).limit(1)
            ).first()
            open_rank = ALERT_SEVERITY_RANK.get(open_alert[0], -1) if open_alert else -1
            if ALERT_SEVERITY_RANK[severity] > open_rank:
                conn.execute(insert(app_alerts).values(
                    id=new_uuid(),
                    patient_id=patient_id,
                    severity=severity,
                    kind="RISK_STATE",
                    message=f"Predicted state {state} (score {result.score:g})",
                    payload={"model_version": result.model_version, "is_mock": result.is_mock},
                    created_at=result.computed_at,
                    acknowledged_at=None,
                    acknowledged_by=None,
                ))
    _write_audit(engine, actor_id, patient_id, "RISK_ASSESSMENT_CREATED",
                 {"vitals_id": vid, "model_version": result.model_version})
    return values


@router.post("/patients/{patient_id}/vitals", response_model=VitalsOut,
             status_code=status.HTTP_201_CREATED)
def ingest_vitals(patient_id: str, body: VitalsIn,
                  user: CurrentUser = Depends(current_user),
                  engine: Engine = Depends(get_engine),
                  ml: RiskPredictor = Depends(get_ml)):
    _load_patient(engine, user, patient_id)
    values = _record_vitals(
        engine, ml, patient_id, body,
        source=body.source, device_id=body.device_id,
        created_by=user.id, actor_id=user.id,
    )
    return _serialize_vitals(values)


# ---------- /patients/{id}/alerts ----------
def _serialize_alert(row: dict) -> AlertOut:
    return AlertOut(
        id=str(row["id"]),
        patient_id=str(row["patient_id"]),
        severity=row["severity"],
        kind=row["kind"],
        message=row["message"],
        payload=row["payload"] or {},
        created_at=row["created_at"],
        acknowledged_at=row.get("acknowledged_at"),
        acknowledged_by=None if row.get("acknowledged_by") is None else str(row["acknowledged_by"]),
    )


@router.get("/patients/{patient_id}/alerts", response_model=list[AlertOut])
def list_alerts(patient_id: str, open_only: bool = False,
                user: CurrentUser = Depends(current_user),
                engine: Engine = Depends(get_engine)):
    _load_patient(engine, user, patient_id)
    stmt = select(app_alerts).where(app_alerts.c.patient_id == patient_id)
    if open_only:
        stmt = stmt.where(app_alerts.c.acknowledged_at.is_(None))
    stmt = stmt.order_by(app_alerts.c.created_at.desc()).limit(200)
    with engine.connect() as conn:
        rows = conn.execute(stmt).mappings().all()
    return [_serialize_alert(dict(r)) for r in rows]


@router.post("/patients/{patient_id}/alerts/{alert_id}/acknowledge", response_model=AlertOut)
def ack_alert(patient_id: str, alert_id: str,
              user: CurrentUser = Depends(current_user),
              engine: Engine = Depends(get_engine)):
    _load_patient(engine, user, patient_id)
    try:
        UUID(alert_id)
    except ValueError as exc:
        raise HTTPException(404, "Alert not found") from exc
    with engine.begin() as conn:
        row = conn.execute(select(app_alerts).where(
            and_(app_alerts.c.id == alert_id, app_alerts.c.patient_id == patient_id)
        )).mappings().first()
        if not row:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Alert not found")
        conn.execute(update(app_alerts).where(app_alerts.c.id == alert_id).values(
            acknowledged_at=_now(), acknowledged_by=user.id,
        ))
        row = conn.execute(select(app_alerts).where(app_alerts.c.id == alert_id)).mappings().first()
    _write_audit(engine, user.id, patient_id, "ALERT_ACKNOWLEDGED", {"alert_id": alert_id})
    return _serialize_alert(dict(row))


# ---------- /patients/{id}/history ----------
def _serialize_risk(row: dict) -> RiskOut:
    features = row["features"] or {}
    return RiskOut(
        id=str(row["id"]),
        patient_id=str(row["patient_id"]),
        vitals_id=None if row.get("vitals_id") is None else str(row["vitals_id"]),
        model_version=row["model_version"],
        score=float(row["score"]),
        state=row["state"],
        is_mock=bool(features.get("is_mock", False)),
        features=features,
        created_at=row["created_at"],
    )


@router.get("/patients/{patient_id}/history", response_model=HistoryOut)
def patient_history(patient_id: str, limit: int = 100,
                     user: CurrentUser = Depends(current_user),
                     engine: Engine = Depends(get_engine)):
    row = _load_patient(engine, user, patient_id)
    limit = max(1, min(1000, limit))
    with engine.connect() as conn:
        vitals = conn.execute(
            select(app_vitals).where(app_vitals.c.patient_id == patient_id)
                              .order_by(app_vitals.c.recorded_at.desc()).limit(limit)
        ).mappings().all()
        alerts = conn.execute(
            select(app_alerts).where(app_alerts.c.patient_id == patient_id)
                              .order_by(app_alerts.c.created_at.desc()).limit(limit)
        ).mappings().all()
        risk = conn.execute(
            select(app_risk).where(app_risk.c.patient_id == patient_id)
                            .order_by(app_risk.c.created_at.desc()).limit(limit)
        ).mappings().all()
    return HistoryOut(
        patient=_serialize_patient(row),
        vitals=[_serialize_vitals(dict(r)) for r in vitals],
        alerts=[_serialize_alert(dict(r)) for r in alerts],
        risk=[_serialize_risk(dict(r)) for r in risk],
    )


# ---------- /ml/predict (thin passthrough; no persistence) ----------
@router.post("/ml/predict", response_model=PredictResponse)
def predict(body: PredictRequest,
            user: CurrentUser = Depends(current_user),
            engine: Engine = Depends(get_engine),
            ml: RiskPredictor = Depends(get_ml)):
    _load_patient(engine, user, body.patient_id)
    if body.recorded_at.tzinfo is None:
        raise HTTPException(422, "recorded_at must include a timezone")
    result = ml.predict(VitalsFeatures(
        patient_id=body.patient_id,
        recorded_at=body.recorded_at,
        heart_rate=body.heart_rate,
        spo2=body.spo2,
        respiratory_rate=body.respiratory_rate,
        temperature_c=body.temperature_c,
        systolic_bp=body.systolic_bp,
        consciousness=body.consciousness,
        supplemental_oxygen=body.supplemental_oxygen,
    ))
    return PredictResponse(
        model_version=result.model_version,
        score=result.score,
        state=result.state,
        is_mock=result.is_mock,
        features=result.features,
        computed_at=result.computed_at,
    )


# ---------- /patients/{id}/documents ----------
def _validate_document_upload(filename: str | None, content_type: str | None, raw: bytes) -> tuple[str, str]:
    name = Path((filename or "document").replace("\\", "/")).name[:160]
    name = "".join(c for c in name if unicodedata.category(c)[0] != "C")
    suffix = Path(name).suffix.lower()
    if suffix not in (".pdf", ".txt"):
        raise HTTPException(415, "Only PDF and UTF-8 text documents are accepted")
    allowed_types = {"application/octet-stream", "application/pdf" if suffix == ".pdf" else "text/plain"}
    ctype = (content_type or "application/octet-stream").split(";", 1)[0].lower()
    if ctype not in allowed_types:
        raise HTTPException(415, "Content type does not match document extension")
    if not raw or len(raw) > MAX_DOCUMENT_UPLOAD:
        raise HTTPException(413, "Document must be between 1 byte and 5 MB")
    if suffix == ".pdf" and not raw.startswith(b"%PDF-"):
        raise HTTPException(415, "File does not have a PDF signature")
    if suffix == ".txt":
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise HTTPException(415, "Text must be UTF-8") from exc
        if raw.startswith(b"%PDF-") or any(ord(c) < 32 and c not in "\r\n\t\f" for c in text):
            raise HTTPException(415, "Text document contains binary content")
    return name, suffix


def _serialize_document(row: dict) -> DocumentOut:
    return DocumentOut(
        id=str(row["id"]),
        patient_id=str(row["patient_id"]),
        filename=row["filename"],
        sha256=row["sha256"],
        size_bytes=row["size_bytes"],
        uploaded_by=None if row.get("uploaded_by") is None else str(row["uploaded_by"]),
        uploaded_at=row["uploaded_at"],
        scan_verdict=row.get("scan_verdict"),
        scan_payload=row.get("scan_payload") or {},
    )


@router.get("/patients/{patient_id}/documents", response_model=list[DocumentOut])
def list_documents(patient_id: str, user: CurrentUser = Depends(current_user),
                    engine: Engine = Depends(get_engine)):
    _load_patient(engine, user, patient_id)
    with engine.connect() as conn:
        rows = conn.execute(
            select(app_documents).where(app_documents.c.patient_id == patient_id)
                                  .order_by(app_documents.c.uploaded_at.desc()).limit(200)
        ).mappings().all()
    return [_serialize_document(dict(r)) for r in rows]


@router.post("/patients/{patient_id}/documents", response_model=DocumentOut,
             status_code=status.HTTP_201_CREATED)
async def upload_document(patient_id: str, file: UploadFile = File(...),
                           user: CurrentUser = Depends(current_user),
                           engine: Engine = Depends(get_engine)):
    _load_patient(engine, user, patient_id)
    raw = await file.read(MAX_DOCUMENT_UPLOAD + 1)
    await file.close()
    filename, suffix = _validate_document_upload(file.filename, file.content_type, raw)
    doc_id = new_uuid()
    data_dir = Path(os.getenv("DATA_DIR", "./data")).resolve() / "v1_documents" / patient_id
    data_dir.mkdir(parents=True, exist_ok=True)
    storage_path = (data_dir / f"{doc_id}{suffix}").resolve()
    with storage_path.open("xb") as fh:
        fh.write(raw)
    parsed = await run_in_threadpool(gateway.parse_file, storage_path, suffix)
    analysis = gateway.analyze(parsed["text"], parsed["signals"])
    facts = gateway.extract_facts(parsed["text"], doc_id, analysis["verdict"])
    payload = {**analysis, "extracted_facts": facts}
    now = _now()
    values = {
        "id": doc_id,
        "patient_id": patient_id,
        "filename": filename,
        "storage_path": str(storage_path),
        "sha256": gateway.digest(raw),
        "size_bytes": len(raw),
        "uploaded_by": user.id,
        "uploaded_at": now,
        "scan_verdict": analysis["verdict"],
        "scan_payload": payload,
    }
    with engine.begin() as conn:
        conn.execute(insert(app_documents).values(**values))
    _write_audit(engine, user.id, patient_id, "DOCUMENT_UPLOADED",
                 {"resource_id": doc_id, "state": analysis["verdict"]})
    return _serialize_document(values)


# ---------- /bridge (permanent patient code + Android device pairing) ------
#
# Three distinct trust levels live under this prefix, and they must not blur:
#
#   * /bridge/code, /bridge/code/regenerate, /bridge/devices/{id}
#       Supabase-authenticated patient. Operates on the caller's OWN patient
#       record, resolved from the JWT -- never from a path or body parameter.
#   * /bridge/pair
#       Unauthenticated by necessity (the handset has no credential yet). Its
#       only secret is the bridge code; it is rate-limited separately and
#       tightly in app.security.SecurityControls.
#   * /bridge/session, /bridge/vitals, /bridge/unpair
#       Authenticated by the paired device's own `vtb_` credential. The
#       patient is derived from that credential; the client never supplies a
#       patient id, and there is no request field through which it could.
#
# See docs/BRIDGE.md for the wire contract handed to the Android team.

MAX_BRIDGE_CODE_ATTEMPTS = 8


def _own_patient_record(engine: Engine, user: CurrentUser) -> dict:
    """The caller's own patient record, or 404.

    A bridge code belongs to a *patient*, so only the person whose login is
    linked to a patient record (`app_patients.user_id`) can hold one. A doctor
    -- including the doctor who owns the record -- has no path to it, by
    design: the code is a device-pairing credential for that patient alone.
    """
    with engine.connect() as conn:
        row = conn.execute(
            select(app_patients).where(app_patients.c.user_id == user.id)
        ).mappings().first()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            "No patient record is linked to this account")
    return dict(row)


def _serialize_bridge_device(row: dict) -> BridgeDeviceOut:
    return BridgeDeviceOut(
        id=str(row["id"]),
        device_id=row["device_id"],
        device_name=row.get("device_name"),
        paired_at=row["created_at"],
        last_seen_at=row.get("last_seen_at"),
        revoked_at=row.get("revoked_at"),
    )


def _active_devices(engine: Engine, patient_id: str) -> list[BridgeDeviceOut]:
    with engine.connect() as conn:
        rows = conn.execute(
            select(app_bridge_devices)
            .where(and_(app_bridge_devices.c.patient_id == patient_id,
                        app_bridge_devices.c.revoked_at.is_(None)))
            .order_by(app_bridge_devices.c.created_at.desc()).limit(50)
        ).mappings().all()
    return [_serialize_bridge_device(dict(r)) for r in rows]


def _read_code(engine: Engine, patient_id: str) -> dict | None:
    with engine.connect() as conn:
        row = conn.execute(
            select(app_bridge_codes).where(app_bridge_codes.c.patient_id == patient_id)
        ).mappings().first()
    return dict(row) if row else None


def _ensure_bridge_code(engine: Engine, patient_id: str, actor_id: str | None) -> dict:
    """Mint the patient's permanent code on first read; return it thereafter.

    Lazy creation (rather than a backfill or an onboarding-time write) means
    every patient who already exists gets a code the moment they first look,
    and no existing row or flow has to change.
    """
    existing = _read_code(engine, patient_id)
    if existing:
        return existing
    for _ in range(MAX_BRIDGE_CODE_ATTEMPTS):
        code = generate_bridge_code()
        try:
            with engine.begin() as conn:
                conn.execute(insert(app_bridge_codes).values(
                    patient_id=patient_id,
                    code=code,
                    code_hash=hash_bridge_code(code),
                    created_at=_now(),
                    rotated_at=None,
                ))
        except IntegrityError:
            # Either a concurrent request for this same patient won the race
            # (patient_id is the primary key), or -- vanishingly unlikely -- we
            # drew a code that already exists. Re-read before retrying so the
            # first case returns the winner's code instead of looping.
            existing = _read_code(engine, patient_id)
            if existing:
                return existing
            continue
        _write_audit(engine, actor_id, patient_id, "BRIDGE_CODE_ISSUED", {})
        return _read_code(engine, patient_id) or {}
    raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                        "Could not allocate a bridge code; please retry")


def _code_response(engine: Engine, row: dict, patient_id: str) -> BridgeCodeResponse:
    return BridgeCodeResponse(
        bridge_code=row["code"],
        created_at=row["created_at"],
        rotated_at=row.get("rotated_at"),
        devices=_active_devices(engine, patient_id),
    )


@router.get("/bridge/code", response_model=BridgeCodeResponse)
def get_bridge_code(user: CurrentUser = Depends(current_user),
                    engine: Engine = Depends(get_engine)):
    patient = _own_patient_record(engine, user)
    row = _ensure_bridge_code(engine, str(patient["id"]), user.id)
    return _code_response(engine, row, str(patient["id"]))


@router.post("/bridge/code/regenerate", response_model=BridgeCodeResponse)
def regenerate_bridge_code(user: CurrentUser = Depends(current_user),
                           engine: Engine = Depends(get_engine)):
    """Rotate a code the patient believes has been seen by someone else.

    Already-paired devices keep working: they hold their own credential, and
    the code is only ever an enrolment secret. Removing a device that should
    no longer be trusted is the separate, explicit DELETE below.
    """
    patient = _own_patient_record(engine, user)
    patient_id = str(patient["id"])
    _ensure_bridge_code(engine, patient_id, user.id)
    for _ in range(MAX_BRIDGE_CODE_ATTEMPTS):
        code = generate_bridge_code()
        try:
            with engine.begin() as conn:
                conn.execute(
                    update(app_bridge_codes)
                    .where(app_bridge_codes.c.patient_id == patient_id)
                    .values(code=code, code_hash=hash_bridge_code(code), rotated_at=_now())
                )
        except IntegrityError:
            continue
        _write_audit(engine, user.id, patient_id, "BRIDGE_CODE_ROTATED", {})
        return _code_response(engine, _read_code(engine, patient_id) or {}, patient_id)
    raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                        "Could not allocate a bridge code; please retry")


@router.delete("/bridge/devices/{device_uuid}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_bridge_device(device_uuid: str,
                         user: CurrentUser = Depends(current_user),
                         engine: Engine = Depends(get_engine)):
    patient = _own_patient_record(engine, user)
    try:
        UUID(device_uuid)
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found") from exc
    with engine.begin() as conn:
        result = conn.execute(
            update(app_bridge_devices)
            .where(and_(app_bridge_devices.c.id == device_uuid,
                        app_bridge_devices.c.patient_id == patient["id"],
                        app_bridge_devices.c.revoked_at.is_(None)))
            .values(revoked_at=_now())
        )
    if not result.rowcount:
        # Someone else's device, an unknown id, and an already-revoked device
        # are indistinguishable to the caller.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    _write_audit(engine, user.id, str(patient["id"]), "BRIDGE_DEVICE_REVOKED",
                 {"bridge_device_id": device_uuid})
    return None


def _as_utc(value: datetime | None) -> datetime | None:
    """SQLite hands back naive datetimes; Postgres hands back aware ones."""
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _code_supersedes_revocation(code_row, revoked_at: datetime | None) -> bool:
    """Was the current bridge code issued *after* this device was revoked?

    A revoked handset regains the ability to pair only when the patient has
    deliberately re-issued the enrolment secret since the revocation. Rotating
    the code is the patient's explicit "this secret is burned, here is a new
    one" action, so a code newer than the revocation is consent to re-enrol;
    the same code that was already known at revocation time is not.
    """
    if revoked_at is None:
        return True
    revoked = _as_utc(revoked_at)
    issued = _as_utc(code_row["rotated_at"]) or _as_utc(code_row["created_at"])
    if issued is None or revoked is None:
        # Missing timestamps: fail closed. Refusing costs the patient one code
        # rotation; allowing would silently reinstate a revoked device.
        return False
    return issued > revoked


@router.post("/bridge/pair", response_model=BridgePairResponse,
             status_code=status.HTTP_201_CREATED)
def bridge_pair(body: BridgePairRequest, engine: Engine = Depends(get_engine)):
    """Exchange a bridge code for a device credential.

    The response deliberately carries no clinical data and no usable patient
    handle -- just enough for the handset to confirm to the person holding it
    that it linked to the right account.
    """
    def _reject(reason: str) -> HTTPException:
        _write_audit(engine, None, None, "BRIDGE_PAIR_REJECTED",
                     {"outcome": "failure", "reason": reason})
        return HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid bridge code")

    try:
        code = normalize_bridge_code(body.bridge_code)
    except ValueError:
        raise _reject("malformed_code") from None
    try:
        device_id = sanitize_device_id(body.device_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "device_id is required") from exc
    device_name = sanitize_device_name(body.device_name)

    with engine.connect() as conn:
        owner = conn.execute(
            select(app_bridge_codes.c.patient_id, app_patients.c.full_name,
                   app_patients.c.user_id, app_bridge_codes.c.created_at,
                   app_bridge_codes.c.rotated_at)
            .select_from(app_bridge_codes.join(
                app_patients, app_patients.c.id == app_bridge_codes.c.patient_id
            ))
            .where(app_bridge_codes.c.code_hash == hash_bridge_code(code))
        ).mappings().first()
    if not owner:
        raise _reject("unknown_code")
    patient_id = str(owner["patient_id"])

    token, token_hash = issue_device_token()
    now = _now()
    with engine.begin() as conn:
        existing = conn.execute(
            select(app_bridge_devices.c.id, app_bridge_devices.c.revoked_at).where(and_(
                app_bridge_devices.c.patient_id == patient_id,
                app_bridge_devices.c.device_id == device_id,
            ))
        ).mappings().first()
        if existing is not None and existing["revoked_at"] is not None:
            # A patient who disconnected this handset must not have that
            # decision quietly undone by the handset replaying the same
            # permanent code. Revocation only becomes reversible once the
            # patient re-issues the enrolment secret -- which is exactly the
            # "Generate a new code" action already next to "Disconnect" in the
            # patient's Device page, so this needs no new UX.
            if not _code_supersedes_revocation(owner, existing["revoked_at"]):
                _write_audit(engine, None, patient_id, "BRIDGE_PAIR_REJECTED", {
                    "outcome": "failure", "reason": "device_revoked",
                    "bridge_device_id": str(existing["id"]),
                })
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN,
                    "This device was disconnected from the account. Generate a new "
                    "Bridge Code in VITALIS to reconnect it.",
                )
        if existing is not None:
            # Re-pairing the same handset rotates its credential in place, so a
            # reinstall does not leave an orphaned, still-valid token behind.
            conn.execute(
                update(app_bridge_devices)
                .where(app_bridge_devices.c.id == existing["id"])
                .values(token_hash=token_hash, device_name=device_name,
                        last_seen_at=now, revoked_at=None)
            )
            device_uuid = str(existing["id"])
        else:
            device_uuid = new_uuid()
            conn.execute(insert(app_bridge_devices).values(
                id=device_uuid,
                patient_id=patient_id,
                device_id=device_id,
                device_name=device_name,
                token_hash=token_hash,
                created_at=now,
                last_seen_at=now,
                revoked_at=None,
            ))
        row = conn.execute(
            select(app_bridge_devices).where(app_bridge_devices.c.id == device_uuid)
        ).mappings().first()

    _write_audit(engine, None if owner["user_id"] is None else str(owner["user_id"]),
                 patient_id, "BRIDGE_DEVICE_PAIRED",
                 {"bridge_device_id": device_uuid, "source": "bridge"})
    return BridgePairResponse(
        device_token=token,
        device=_serialize_bridge_device(dict(row)),
        patient=BridgePatientSummary(id=patient_id, display_name=owner["full_name"]),
    )


def _bridge_patient_summary(engine: Engine, device: BridgeDevice) -> BridgePatientSummary:
    with engine.connect() as conn:
        row = conn.execute(
            select(app_patients.c.full_name).where(app_patients.c.id == device.patient_id)
        ).first()
    return BridgePatientSummary(id=device.patient_id, display_name=row[0] if row else "")


@router.get("/bridge/session", response_model=BridgeSessionResponse)
def bridge_session(device: BridgeDevice = Depends(current_bridge_device),
                   engine: Engine = Depends(get_engine)):
    """Lets the handset confirm its credential is still live and who it is for."""
    return BridgeSessionResponse(
        device=BridgeDeviceOut(
            id=device.id, device_id=device.device_id, device_name=device.device_name,
            paired_at=device.created_at, last_seen_at=device.last_seen_at, revoked_at=None,
        ),
        patient=_bridge_patient_summary(engine, device),
    )


@router.post("/bridge/vitals", response_model=VitalsOut, status_code=status.HTTP_201_CREATED)
def bridge_ingest_vitals(body: BridgeVitalsIn,
                         device: BridgeDevice = Depends(current_bridge_device),
                         engine: Engine = Depends(get_engine),
                         ml: RiskPredictor = Depends(get_ml)):
    """Wearable readings, entering the same pipeline as every other reading.

    `device.patient_id` comes from the credential, never from the request, so
    there is no field an Android client could set to write to someone else's
    record. Provenance (`source`, `device_id`) is stamped here rather than
    accepted, which is why BridgeVitalsIn has no place to put it.
    """
    values = _record_vitals(
        engine, ml, device.patient_id, body,
        source="bridge", device_id=device.device_id,
        created_by=device.patient_user_id, actor_id=device.patient_user_id,
        audit_source="bridge",
    )
    return _serialize_vitals(values)


@router.post("/bridge/unpair", status_code=status.HTTP_204_NO_CONTENT)
def bridge_unpair(device: BridgeDevice = Depends(current_bridge_device),
                  engine: Engine = Depends(get_engine)):
    """Device-initiated disconnect (the in-app "forget this account" action)."""
    with engine.begin() as conn:
        conn.execute(
            update(app_bridge_devices)
            .where(and_(app_bridge_devices.c.id == device.id,
                        app_bridge_devices.c.revoked_at.is_(None)))
            .values(revoked_at=_now())
        )
    _write_audit(engine, device.patient_user_id, device.patient_id, "BRIDGE_DEVICE_REVOKED",
                 {"bridge_device_id": device.id, "source": "bridge"})
    return None


def all_routers() -> Iterable[APIRouter]:
    return (router,)
