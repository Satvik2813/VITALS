from pathlib import Path

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    event,
)
from sqlalchemy.dialects.postgresql import JSONB

JSON = JSON().with_variant(JSONB(), "postgresql")

metadata = MetaData()

patients = Table(
    "patients",
    metadata,
    Column("id", String, primary_key=True),
    Column("name", String, nullable=False),
    Column("profile", JSON, nullable=False),
)
runs = Table(
    "demo_runs",
    metadata,
    Column("id", String, primary_key=True),
    Column("created_at", String, nullable=False),
    Column("active", Boolean, nullable=False),
    Column("checkpoint", JSON, nullable=False),
)
readings = Table(
    "vitals_readings",
    metadata,
    Column("id", String, primary_key=True),
    Column("run_id", ForeignKey("demo_runs.id"), nullable=False),
    Column("patient_id", ForeignKey("patients.id"), nullable=False),
    Column("timestamp", String, nullable=False),
    Column("payload", JSON, nullable=False),
)
Index("vitals_patient_time", readings.c.run_id, readings.c.patient_id, readings.c.timestamp, unique=True)
assessments = Table(
    "risk_assessments",
    metadata,
    Column("id", String, primary_key=True),
    Column("reading_id", ForeignKey("vitals_readings.id"), nullable=False),
    Column("news2_score", Integer, nullable=False),
    Column("attention_state", String, nullable=False),
    Column("payload", JSON, nullable=False),
)
baselines = Table(
    "patient_baselines",
    metadata,
    Column("id", String, primary_key=True),
    Column("run_id", ForeignKey("demo_runs.id"), nullable=False),
    Column("patient_id", ForeignKey("patients.id"), nullable=False),
    Column("payload", JSON, nullable=False),
)
alerts = Table(
    "alerts",
    metadata,
    Column("id", String, primary_key=True),
    Column("run_id", ForeignKey("demo_runs.id"), nullable=False),
    Column("patient_id", ForeignKey("patients.id"), nullable=False),
    Column("severity", String, nullable=False),
    Column("created_at", String, nullable=False),
    Column("acknowledged_at", String),
    Column("payload", JSON, nullable=False),
)
documents = Table(
    "documents",
    metadata,
    Column("id", String, primary_key=True),
    Column("run_id", ForeignKey("demo_runs.id"), nullable=False),
    Column("patient_id", ForeignKey("patients.id"), nullable=False),
    Column("filename", String, nullable=False),
    Column("storage_path", String, nullable=False),
    Column("sha256", String, nullable=False),
    Column("uploaded_at", String, nullable=False),
    Column("size_bytes", Integer, nullable=False),
)
scans = Table(
    "document_scans",
    metadata,
    Column("document_id", ForeignKey("documents.id"), primary_key=True),
    Column("verdict", String, nullable=False),
    Column("payload", JSON, nullable=False),
    Column("scanned_at", String, nullable=False),
)
facts = Table(
    "extracted_clinical_facts",
    metadata,
    Column("id", String, primary_key=True),
    Column("document_id", ForeignKey("documents.id"), nullable=False),
    Column("fact_type", String, nullable=False),
    Column("value", Float, nullable=False),
    Column("trust_status", String, nullable=False),
    Column("provenance", JSON, nullable=False),
)
audit = Table(
    "audit_events",
    metadata,
    Column("id", String, primary_key=True),
    Column("run_id", ForeignKey("demo_runs.id"), nullable=False),
    Column("patient_id", ForeignKey("patients.id")),
    Column("event_type", String, nullable=False),
    Column("actor", String, nullable=False),
    Column("created_at", String, nullable=False),
    Column("details", JSON, nullable=False),
)
Index("audit_run_time", audit.c.run_id, audit.c.created_at)
Index("documents_patient", documents.c.run_id, documents.c.patient_id)
Index("facts_document", facts.c.document_id)
Index("alerts_run_patient", alerts.c.run_id, alerts.c.patient_id)
Index("risk_reading", assessments.c.reading_id)
Index("baselines_run_patient", baselines.c.run_id, baselines.c.patient_id)
# Raw extracted text is intentionally absent from trusted fact/context tables.
raw_text = Table(
    "document_raw_text",
    metadata,
    Column("document_id", ForeignKey("documents.id"), primary_key=True),
    Column("text", Text, nullable=False),
)


def connect(url: str):
    if url.startswith("sqlite"):
        if "///" in url and ":memory:" not in url:
            Path(url.split("///", 1)[1]).parent.mkdir(parents=True, exist_ok=True)
        engine = create_engine(url, connect_args={"check_same_thread": False})

        @event.listens_for(engine, "connect")
        def sqlite_settings(dbapi, _):
            dbapi.execute("PRAGMA foreign_keys=ON")
            dbapi.execute("PRAGMA journal_mode=WAL")

        metadata.create_all(engine)
    else:
        engine = create_engine(url, pool_pre_ping=True)
        # PostgreSQL must be provisioned by the checked-in migration, including RLS.
    return engine
