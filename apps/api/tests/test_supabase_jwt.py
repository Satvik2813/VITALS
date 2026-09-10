"""End-to-end proof that the FastAPI JWT verifier accepts Supabase-shaped
tokens signed with SUPABASE_JWT_SECRET and rejects invalid ones.

Uses a synthetic secret + hand-minted HS256 token so the test is fully offline
and does not require a live Supabase session. The production code path is the
same as for real Supabase-issued tokens.
"""

from __future__ import annotations

import time
import uuid
import os

import jwt
import pytest
from fastapi.testclient import TestClient

from app.main import create_app


SECRET = "test-supabase-jwt-secret-for-unit-tests-only"


def _mint(sub: str, email: str, *, exp_offset: int = 3600) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "sub": sub,
            "email": email,
            "role": "authenticated",
            "aud": "authenticated",
            "iss": os.environ["SUPABASE_URL"].rstrip("/") + "/auth/v1",
            "iat": now,
            "exp": now + exp_offset,
            "user_metadata": {"full_name": "Live Doctor"},
        },
        SECRET,
        algorithm="HS256",
    )


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_URL", "https://security-test.supabase.co")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    monkeypatch.setenv("PLATFORM_DATABASE_URL", f"sqlite:///{tmp_path / 'plat.db'}")
    monkeypatch.delenv("VITALIS_DEMO_USER", raising=False)
    app = create_app(f"sqlite:///{tmp_path / 'legacy.db'}", tmp_path, autostart=False)
    with TestClient(app) as c:
        yield c


def test_valid_supabase_jwt_is_accepted(client):
    token = _mint(str(uuid.uuid4()), "doctor@example.com")
    r = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email"] == "doctor@example.com"
    # Real (non-demo-bypass) identities get no role until onboarding assigns
    # one via /api/v1/onboarding/{doctor,patient}.
    assert body["role"] is None
    assert body["onboarding_completed"] is False


def test_expired_token_rejected(client):
    token = _mint(str(uuid.uuid4()), "doctor@example.com", exp_offset=-60)
    r = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


def test_wrong_signature_rejected(client):
    bad = jwt.encode(
        {"sub": str(uuid.uuid4()), "email": "x@example.com", "aud": "authenticated",
         "exp": int(time.time()) + 60},
        "totally-different-secret", algorithm="HS256",
    )
    r = client.get("/api/v1/me", headers={"Authorization": f"Bearer {bad}"})
    assert r.status_code == 401


def test_missing_bearer_rejected(client):
    r = client.get("/api/v1/me")
    assert r.status_code == 401


def test_allowlist_enforced(monkeypatch, client):
    monkeypatch.setenv("VITALIS_ALLOWED_EMAILS", "only@allowed.example")
    token = _mint(str(uuid.uuid4()), "someoneelse@example.com")
    r = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403


def test_e2e_patient_flow_with_jwt(client):
    """Full happy path under a real JWT: create patient, ingest vitals, read history."""
    user_id = str(uuid.uuid4())
    token = _mint(user_id, "flow@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    p = client.post("/api/v1/patients", headers=headers,
                    json={"full_name": "JWT E2E", "mrn": "JWT-1"}).json()
    from datetime import datetime, timezone
    v = client.post(f"/api/v1/patients/{p['id']}/vitals", headers=headers, json={
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "heart_rate": 130, "spo2": 88, "respiratory_rate": 26,
        "temperature_c": 39.1, "systolic_bp": 92, "consciousness": "V",
        "supplemental_oxygen": True,
    })
    assert v.status_code == 201, v.text

    hist = client.get(f"/api/v1/patients/{p['id']}/history", headers=headers).json()
    # The production TrainedRiskPredictor (VITALIS_ENGINE) is loaded by
    # default (see apps/api/app/ml.py get_predictor()); it is not the
    # deterministic NEWS2-lite mock in normal operation.
    assert hist["risk"] and hist["risk"][0]["is_mock"] is False
    assert hist["alerts"] and hist["alerts"][0]["severity"] == "critical"

    # Different user must NOT see this patient.
    other = _mint(str(uuid.uuid4()), "other@example.com")
    r = client.get(f"/api/v1/patients/{p['id']}", headers={"Authorization": f"Bearer {other}"})
    assert r.status_code == 404
