"""Platform (v1, authenticated) tables. Namespaced `app_*` to coexist with the
legacy synthetic demo schema in `database.py`.

The canonical schema is defined in `supabase/migrations/20260909062424_auth_platform.sql`.
This SQLAlchemy Core mirror lets tests run against SQLite without needing a real
Supabase project; production Postgres is provisioned by the migration file.
"""

from __future__ import annotations

import uuid
from pathlib import Path

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    Numeric,
    String,
    Table,
    Text,
    UniqueConstraint,
    create_engine,
    event,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID

# JSONB on Postgres, JSON everywhere else.
JsonType = JSON().with_variant(JSONB(), "postgresql")
# UUID text on SQLite, native uuid on Postgres.
UuidType = String(36).with_variant(PG_UUID(as_uuid=False), "postgresql")

metadata = MetaData()

app_profiles = Table(
    "app_profiles",
    metadata,
    Column("id", UuidType, primary_key=True),
    Column("email", String, nullable=False),
    Column("full_name", String),
    Column("avatar_url", String),
    # Nullable: role is assigned by the onboarding endpoints, not at signup.
    Column("role", String),
    Column("onboarding_completed", Boolean, nullable=False, default=False),
    Column("phone", String),
    Column("specialization", String),
    Column("hospital", String),
    Column("medical_registration", String),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)

app_patients = Table(
    "app_patients",
    metadata,
    Column("id", UuidType, primary_key=True),
    Column("owner_id", UuidType, ForeignKey("app_profiles.id"), nullable=False),
    # The patient's own login identity, if they have one (nullable: existing
    # doctor-created patient records have no self-service login).
    Column("user_id", UuidType, ForeignKey("app_profiles.id"), unique=True),
    Column("mrn", String),
    Column("full_name", String, nullable=False),
    Column("date_of_birth", Date),
    Column("sex", String),
    Column("notes", Text),
    Column("phone", String),
    Column("emergency_contact_name", String),
    Column("emergency_contact_phone", String),
    Column("consent_accepted_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)
Index("app_patients_owner", app_patients.c.owner_id)

app_doctor_patients = Table(
    "app_doctor_patients",
    metadata,
    Column("doctor_id", UuidType, ForeignKey("app_profiles.id"), primary_key=True),
    Column("patient_id", UuidType, ForeignKey("app_patients.id", ondelete="CASCADE"), primary_key=True),
    Column("granted_by", UuidType, ForeignKey("app_profiles.id")),
    Column("granted_at", DateTime(timezone=True), nullable=False),
)

app_vitals = Table(
    "app_vitals",
    metadata,
    Column("id", UuidType, primary_key=True),
    Column("patient_id", UuidType, ForeignKey("app_patients.id", ondelete="CASCADE"), nullable=False),
    Column("recorded_at", DateTime(timezone=True), nullable=False),
    Column("heart_rate", Integer),
    Column("spo2", Integer),
    Column("respiratory_rate", Integer),
    Column("temperature_c", Numeric(4, 1)),
    Column("systolic_bp", Integer),
    Column("diastolic_bp", Integer),
    Column("consciousness", String),
    Column("supplemental_oxygen", Boolean),
    Column("source", String),
    Column("device_id", String),
    Column("created_by", UuidType, ForeignKey("app_profiles.id")),
    Column("created_at", DateTime(timezone=True), nullable=False),
)
Index("app_vitals_patient_time", app_vitals.c.patient_id, app_vitals.c.recorded_at)
# Idempotency for device readings: an Android retry must not create a second
# row. NULLs are distinct in SQL, so manual clinician entries (device_id IS
# NULL) are unconstrained. Mirrors `app_vitals_device_reading_key` in
# supabase/migrations/20260910150000_document_verdict_and_vitals_dedupe.sql.
Index(
    "app_vitals_device_reading_key",
    app_vitals.c.patient_id,
    app_vitals.c.device_id,
    app_vitals.c.recorded_at,
    unique=True,
)

app_alerts = Table(
    "app_alerts",
    metadata,
    Column("id", UuidType, primary_key=True),
    Column("patient_id", UuidType, ForeignKey("app_patients.id", ondelete="CASCADE"), nullable=False),
    Column("severity", String, nullable=False),
    Column("kind", String, nullable=False),
    Column("message", String, nullable=False),
    Column("payload", JsonType, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("acknowledged_at", DateTime(timezone=True)),
    Column("acknowledged_by", UuidType, ForeignKey("app_profiles.id")),
)
Index("app_alerts_patient_time", app_alerts.c.patient_id, app_alerts.c.created_at)

app_risk = Table(
    "app_risk_assessments",
    metadata,
    Column("id", UuidType, primary_key=True),
    Column("patient_id", UuidType, ForeignKey("app_patients.id", ondelete="CASCADE"), nullable=False),
    Column("vitals_id", UuidType, ForeignKey("app_vitals.id", ondelete="SET NULL")),
    Column("model_version", String, nullable=False),
    Column("score", Numeric, nullable=False),
    Column("state", String, nullable=False),
    Column("features", JsonType, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)
Index("app_risk_patient_time", app_risk.c.patient_id, app_risk.c.created_at)

app_documents = Table(
    "app_documents",
    metadata,
    Column("id", UuidType, primary_key=True),
    Column("patient_id", UuidType, ForeignKey("app_patients.id", ondelete="CASCADE"), nullable=False),
    Column("filename", String, nullable=False),
    Column("storage_path", String, nullable=False),
    Column("sha256", String, nullable=False),
    Column("size_bytes", Integer, nullable=False),
    Column("uploaded_by", UuidType, ForeignKey("app_profiles.id")),
    Column("uploaded_at", DateTime(timezone=True), nullable=False),
    Column("scan_verdict", String),
    Column("scan_payload", JsonType, nullable=False),
)
Index("app_documents_patient", app_documents.c.patient_id, app_documents.c.uploaded_at)

app_bridge_codes = Table(
    "app_patient_bridge_codes",
    metadata,
    Column("patient_id", UuidType, ForeignKey("app_patients.id", ondelete="CASCADE"), primary_key=True),
    # Readable form (the patient displays it); `code_hash` is the lookup key
    # so a submitted code never reaches a query predicate. See
    # supabase/migrations/20260910090000_bridge_pairing.sql.
    Column("code", String(16), nullable=False),
    Column("code_hash", String(64), nullable=False, unique=True),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("rotated_at", DateTime(timezone=True)),
)

app_bridge_devices = Table(
    "app_bridge_devices",
    metadata,
    Column("id", UuidType, primary_key=True),
    Column("patient_id", UuidType, ForeignKey("app_patients.id", ondelete="CASCADE"), nullable=False),
    Column("device_id", String(128), nullable=False),
    Column("device_name", String(120)),
    # SHA-256 of the bearer credential; the plaintext exists only in the
    # pairing response and on the handset.
    Column("token_hash", String(64), nullable=False, unique=True),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("last_seen_at", DateTime(timezone=True)),
    Column("revoked_at", DateTime(timezone=True)),
    UniqueConstraint("patient_id", "device_id", name="app_bridge_devices_patient_device_key"),
)
Index("app_bridge_devices_patient", app_bridge_devices.c.patient_id, app_bridge_devices.c.created_at)

app_audit = Table(
    "app_audit_events",
    metadata,
    Column("id", UuidType, primary_key=True),
    Column("actor_id", UuidType, ForeignKey("app_profiles.id")),
    Column("patient_id", UuidType, ForeignKey("app_patients.id", ondelete="SET NULL")),
    Column("event_type", String, nullable=False),
    Column("details", JsonType, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)
Index("app_audit_actor_time", app_audit.c.actor_id, app_audit.c.created_at)


def new_uuid() -> str:
    return str(uuid.uuid4())


def _normalize_postgres_url(url: str) -> str:
    """Force SQLAlchemy to use psycopg v3 (the driver we install) instead of
    psycopg2 (the default for the bare `postgresql://` scheme). Preserves
    credentials, host, port, database, and query parameters unchanged.
    """
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://"):]
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://"):]
    return url


def connect(url: str):
    """Return a SQLAlchemy engine, creating tables on SQLite for local/tests.
    Production Postgres is provisioned by the checked-in migration.
    """
    if url.startswith("sqlite"):
        if "///" in url and ":memory:" not in url:
            Path(url.split("///", 1)[1]).parent.mkdir(parents=True, exist_ok=True)
        engine = create_engine(url, connect_args={"check_same_thread": False}, future=True)

        @event.listens_for(engine, "connect")
        def _sqlite_settings(dbapi, _):
            dbapi.execute("PRAGMA foreign_keys=ON")

        metadata.create_all(engine)
    else:
        engine = create_engine(_normalize_postgres_url(url), pool_pre_ping=True, future=True)
    return engine
