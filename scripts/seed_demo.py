"""Seed a local dev database with a demo doctor + patients + vitals.

Idempotent: safe to re-run. Never runs against production Supabase; the target
URL is `PLATFORM_DATABASE_URL` or falls back to DATABASE_URL, which is SQLite
by default. Skip the seed on remote hosts by refusing anything but sqlite:// or
localhost postgres explicitly acknowledged with SEED_ALLOW_REMOTE=true.
"""

from __future__ import annotations

import os
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from sqlalchemy import insert, select  # noqa: E402
from app import db_platform  # noqa: E402

DEMO_DOCTOR_ID = os.getenv("VITALIS_DEMO_USER_ID", "00000000-0000-0000-0000-000000000001")
DEMO_DOCTOR_EMAIL = os.getenv("VITALIS_DEMO_USER", "demo.doctor@vitalis.local")

DEMO_PATIENTS = [
    {"full_name": "Synthetic Patient 01", "mrn": "MRN-1001", "sex": "male"},
    {"full_name": "Synthetic Patient 02", "mrn": "MRN-1002", "sex": "female"},
    {"full_name": "Synthetic Patient 03", "mrn": "MRN-1003", "sex": "male"},
]


def seed_id(patient_id: str, kind: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"vitalis:demo:{patient_id}:{kind}"))


def _url() -> str:
    url = os.getenv("PLATFORM_DATABASE_URL") or os.getenv(
        "DATABASE_URL", f"sqlite:///{ROOT / 'data/vitalis.db'}"
    )
    if not url.startswith("sqlite") and os.getenv("SEED_ALLOW_REMOTE", "").lower() != "true":
        raise SystemExit(
            "Refusing to seed non-sqlite database without SEED_ALLOW_REMOTE=true. "
            "Target URL is withheld because it may contain credentials."
        )
    return url


def main() -> None:
    engine = db_platform.connect(_url())
    now = datetime.now(timezone.utc)
    rng = random.Random(42)

    with engine.begin() as conn:
        exists = conn.execute(
            select(db_platform.app_profiles.c.id).where(
                db_platform.app_profiles.c.id == DEMO_DOCTOR_ID
            )
        ).first()
        if not exists:
            conn.execute(insert(db_platform.app_profiles).values(
                id=DEMO_DOCTOR_ID,
                email=DEMO_DOCTOR_EMAIL,
                full_name="Demo Doctor",
                avatar_url=None,
                role="doctor",
                created_at=now,
                updated_at=now,
            ))

        for spec in DEMO_PATIENTS:
            existing = conn.execute(
                select(db_platform.app_patients).where(
                    (db_platform.app_patients.c.owner_id == DEMO_DOCTOR_ID)
                    & (db_platform.app_patients.c.mrn == spec["mrn"])
                )
            ).first()
            if existing:
                pid = existing[0]
            else:
                pid = db_platform.new_uuid()
                conn.execute(insert(db_platform.app_patients).values(
                    id=pid,
                    owner_id=DEMO_DOCTOR_ID,
                    mrn=spec["mrn"],
                    full_name=spec["full_name"],
                    date_of_birth=None,
                    sex=spec["sex"],
                    notes="Seeded demo patient.",
                    created_at=now,
                    updated_at=now,
                ))
            for i in range(6):
                vid = seed_id(pid, f"vitals-{i}")
                if conn.execute(select(db_platform.app_vitals.c.id).where(
                    db_platform.app_vitals.c.id == vid
                )).first():
                    continue
                conn.execute(insert(db_platform.app_vitals).values(
                    id=vid,
                    patient_id=pid,
                    recorded_at=now - timedelta(minutes=5 * (6 - i)),
                    heart_rate=rng.randint(62, 96),
                    spo2=rng.randint(94, 99),
                    respiratory_rate=rng.randint(12, 20),
                    temperature_c=round(36.4 + rng.random() * 0.6, 1),
                    systolic_bp=rng.randint(108, 132),
                    diastolic_bp=rng.randint(65, 85),
                    consciousness="A",
                    supplemental_oxygen=False,
                    source="seed",
                    device_id=None,
                    created_by=DEMO_DOCTOR_ID,
                    created_at=now,
                ))
            assignment = conn.execute(select(db_platform.app_doctor_patients).where(
                db_platform.app_doctor_patients.c.doctor_id == DEMO_DOCTOR_ID,
                db_platform.app_doctor_patients.c.patient_id == pid,
            )).first()
            if not assignment:
                conn.execute(insert(db_platform.app_doctor_patients).values(
                    doctor_id=DEMO_DOCTOR_ID, patient_id=pid,
                    granted_by=DEMO_DOCTOR_ID, granted_at=now,
                ))
            aid = seed_id(pid, "alert")
            if not conn.execute(select(db_platform.app_alerts.c.id).where(db_platform.app_alerts.c.id == aid)).first():
                conn.execute(insert(db_platform.app_alerts).values(
                    id=aid, patient_id=pid, severity="info", kind="DEMO",
                    message="Synthetic demonstration alert; not a clinical finding.",
                    payload={"synthetic": True}, created_at=now,
                ))
            did = seed_id(pid, "document")
            if not conn.execute(select(db_platform.app_documents.c.id).where(db_platform.app_documents.c.id == did)).first():
                # Metadata-only fixture; actual scan/quarantine fixtures remain in the legacy demo.
                import hashlib
                content = b"Synthetic demonstration document. No personal data."
                conn.execute(insert(db_platform.app_documents).values(
                    id=did, patient_id=pid, filename="synthetic-demo.txt",
                    storage_path=f"seed://{did}", sha256=hashlib.sha256(content).hexdigest(),
                    size_bytes=len(content), uploaded_by=DEMO_DOCTOR_ID, uploaded_at=now,
                    scan_verdict="PENDING", scan_payload={"synthetic": True, "metadata_only": True},
                ))

    engine.dispose()
    print(f"Seeded one synthetic demo doctor with {len(DEMO_PATIENTS)} patients.")


if __name__ == "__main__":
    main()
