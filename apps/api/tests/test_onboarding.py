"""Patient/doctor onboarding and assignment: role assignment, doctor
selection, and cross-patient/cross-doctor isolation for the new architecture.

Uses hand-minted Supabase-shaped JWTs (see test_supabase_jwt.py) so each
identity is a real, independent "user" going through the real verified-JWT
path -- not the VITALIS_DEMO_USER bypass, which stays reserved for the
pre-existing doctor-oriented endpoint tests.
"""

from __future__ import annotations

import time
import uuid

import jwt
import pytest
from fastapi.testclient import TestClient

from app.main import create_app

SECRET = "onboarding-test-secret-for-unit-tests-only"


def _mint(sub: str, email: str) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "sub": sub, "email": email, "role": "authenticated", "aud": "authenticated",
            "iss": "https://onboarding-test.supabase.co/auth/v1",
            "iat": now, "exp": now + 3600,
        },
        SECRET, algorithm="HS256",
    )


def _headers(email: str, sub: str | None = None) -> dict[str, str]:
    return {"Authorization": f"Bearer {_mint(sub or str(uuid.uuid4()), email)}"}


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_URL", "https://onboarding-test.supabase.co")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    monkeypatch.setenv("PLATFORM_DATABASE_URL", f"sqlite:///{tmp_path / 'plat.db'}")
    monkeypatch.delenv("VITALIS_DEMO_USER", raising=False)
    app = create_app(f"sqlite:///{tmp_path / 'legacy.db'}", tmp_path, autostart=False)
    with TestClient(app) as c:
        yield c


def _onboard_doctor(client, email, **overrides):
    headers = _headers(email)
    body = {"full_name": "Dr. Synthetic", "specialization": "Cardiology", "hospital": "Synthetic General"}
    body.update(overrides)
    r = client.post("/api/v1/onboarding/doctor", headers=headers, json=body)
    assert r.status_code == 200, r.text
    return headers, r.json()


def test_new_identity_has_no_role_until_onboarded(client):
    headers = _headers("brand.new@example.invalid")
    me = client.get("/api/v1/me", headers=headers).json()
    assert me["role"] is None
    assert me["onboarding_completed"] is False


def test_doctor_onboarding_sets_role_and_appears_in_directory(client):
    headers, me = _onboard_doctor(client, "doc.a@example.invalid")
    assert me["role"] == "doctor"
    assert me["onboarding_completed"] is True
    assert me["specialization"] == "Cardiology"

    directory = client.get("/api/v1/doctors", headers=_headers("someone.else@example.invalid")).json()
    assert any(d["id"] == me["id"] and d["full_name"] == "Dr. Synthetic" for d in directory)


def test_doctor_onboarding_twice_is_rejected(client):
    headers, _ = _onboard_doctor(client, "doc.b@example.invalid")
    r = client.post("/api/v1/onboarding/doctor", headers=headers, json={"full_name": "Dr. Again"})
    assert r.status_code == 409


def test_patient_onboarding_requires_a_real_onboarded_doctor(client):
    patient_headers = _headers("patient.a@example.invalid")
    r = client.post("/api/v1/onboarding/patient", headers=patient_headers, json={
        "full_name": "Pat Ient", "assigned_doctor_id": str(uuid.uuid4()), "consent_accepted": True,
    })
    assert r.status_code == 422

    # A profile that exists but never completed doctor onboarding also doesn't count.
    half_doctor = _headers("half.doctor@example.invalid")
    half_doctor_id = client.get("/api/v1/me", headers=half_doctor).json()["id"]
    r = client.post("/api/v1/onboarding/patient", headers=patient_headers, json={
        "full_name": "Pat Ient", "assigned_doctor_id": half_doctor_id, "consent_accepted": True,
    })
    assert r.status_code == 422


def test_patient_onboarding_requires_consent(client):
    doc_headers, doc = _onboard_doctor(client, "doc.c@example.invalid")
    r = client.post("/api/v1/onboarding/patient", headers=_headers("patient.b@example.invalid"), json={
        "full_name": "Pat Ient", "assigned_doctor_id": doc["id"], "consent_accepted": False,
    })
    assert r.status_code == 422


def test_patient_onboarding_creates_assignment_and_grants_self_access(client):
    doc_headers, doc = _onboard_doctor(client, "doc.d@example.invalid")
    patient_headers = _headers("patient.c@example.invalid")

    r = client.post("/api/v1/onboarding/patient", headers=patient_headers, json={
        "full_name": "Pat Ient", "date_of_birth": "1990-01-01", "sex": "female",
        "phone": "+10000000000", "emergency_contact_name": "Em Ergency",
        "emergency_contact_phone": "+10000000001",
        "assigned_doctor_id": doc["id"], "consent_accepted": True,
    })
    assert r.status_code == 201, r.text
    patient = r.json()
    assert patient["owner_id"] == doc["id"]
    assert patient["user_id"] == client.get("/api/v1/me", headers=patient_headers).json()["id"]

    me = client.get("/api/v1/me", headers=patient_headers).json()
    assert me["role"] == "patient" and me["onboarding_completed"] is True

    # The patient sees their own record.
    own_list = client.get("/api/v1/patients", headers=patient_headers).json()
    assert [p["id"] for p in own_list] == [patient["id"]]
    assert client.get(f"/api/v1/patients/{patient['id']}", headers=patient_headers).status_code == 200

    # The assigned doctor sees it too (existing owner-read path, unchanged).
    doctor_list = client.get("/api/v1/patients", headers=doc_headers).json()
    assert any(p["id"] == patient["id"] for p in doctor_list)

    # A different, unrelated doctor must not see it.
    other_doc_headers, _ = _onboard_doctor(client, "doc.e@example.invalid")
    assert client.get(f"/api/v1/patients/{patient['id']}", headers=other_doc_headers).status_code == 404
    assert client.get("/api/v1/patients", headers=other_doc_headers).json() == []

    # A different patient must not see it either.
    other_patient_headers = _headers("patient.d@example.invalid")
    assert client.get(f"/api/v1/patients/{patient['id']}", headers=other_patient_headers).status_code == 404


def test_patient_onboarding_twice_is_rejected(client):
    _, doc = _onboard_doctor(client, "doc.f@example.invalid")
    patient_headers = _headers("patient.e@example.invalid")
    body = {"full_name": "Pat Ient", "assigned_doctor_id": doc["id"], "consent_accepted": True}
    assert client.post("/api/v1/onboarding/patient", headers=patient_headers, json=body).status_code == 201
    assert client.post("/api/v1/onboarding/patient", headers=patient_headers, json=body).status_code == 409


def test_patient_self_update_limited_to_safe_contact_fields(client):
    _, doc = _onboard_doctor(client, "doc.g@example.invalid")
    patient_headers = _headers("patient.f@example.invalid")
    patient = client.post("/api/v1/onboarding/patient", headers=patient_headers, json={
        "full_name": "Pat Ient", "assigned_doctor_id": doc["id"], "consent_accepted": True,
    }).json()

    ok = client.patch(f"/api/v1/patients/{patient['id']}", headers=patient_headers,
                       json={"phone": "+19999999999"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["phone"] == "+19999999999"

    forbidden = client.patch(f"/api/v1/patients/{patient['id']}", headers=patient_headers,
                              json={"full_name": "Hijacked Name"})
    assert forbidden.status_code == 403


def test_doctor_can_edit_identity_fields_patient_cannot(client):
    doc_headers, doc = _onboard_doctor(client, "doc.h@example.invalid")
    patient_headers = _headers("patient.g@example.invalid")
    patient = client.post("/api/v1/onboarding/patient", headers=patient_headers, json={
        "full_name": "Pat Ient", "assigned_doctor_id": doc["id"], "consent_accepted": True,
    }).json()

    edited = client.patch(f"/api/v1/patients/{patient['id']}", headers=doc_headers,
                           json={"notes": "Doctor's clinical note"})
    assert edited.status_code == 200
    assert edited.json()["notes"] == "Doctor's clinical note"
