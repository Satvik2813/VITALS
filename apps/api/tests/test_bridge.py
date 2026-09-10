"""Permanent Bridge Code + Android device pairing.

Identities are hand-minted Supabase-shaped JWTs (the same approach as
test_onboarding.py) so every patient/doctor here goes through the real
verified-JWT path, not the VITALIS_DEMO_USER bypass. The bridge device side
uses its own `vtb_` credential, which is exactly what the Android client will
hold.
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone

import jwt
import pytest
from fastapi.testclient import TestClient

from app.bridge import (
    CODE_ALPHABET,
    CODE_PATTERN,
    generate_bridge_code,
    hash_bridge_code,
    hash_device_token,
    normalize_bridge_code,
)
from app.main import create_app

SECRET = "bridge-test-secret-for-unit-tests-only"


def _mint(sub: str, email: str) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "sub": sub, "email": email, "role": "authenticated", "aud": "authenticated",
            "iss": "https://bridge-test.supabase.co/auth/v1",
            "iat": now, "exp": now + 3600,
        },
        SECRET, algorithm="HS256",
    )


def _headers(email: str, sub: str | None = None) -> dict[str, str]:
    return {"Authorization": f"Bearer {_mint(sub or str(uuid.uuid4()), email)}"}


@pytest.fixture
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_URL", "https://bridge-test.supabase.co")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    monkeypatch.setenv("PLATFORM_DATABASE_URL", f"sqlite:///{tmp_path / 'plat.db'}")
    monkeypatch.delenv("VITALIS_DEMO_USER", raising=False)
    yield


@pytest.fixture
def client(env, tmp_path):
    app = create_app(f"sqlite:///{tmp_path / 'legacy.db'}", tmp_path, autostart=False)
    with TestClient(app) as c:
        yield c


def _onboard_doctor(client, email="doc@example.invalid"):
    headers = _headers(email)
    r = client.post("/api/v1/onboarding/doctor", headers=headers,
                    json={"full_name": "Dr. Synthetic", "specialization": "Cardiology"})
    assert r.status_code == 200, r.text
    return headers, r.json()


def _onboard_patient(client, doctor_id, email, full_name="Synthetic Patient"):
    headers = _headers(email)
    r = client.post("/api/v1/onboarding/patient", headers=headers, json={
        "full_name": full_name,
        "assigned_doctor_id": doctor_id,
        "consent_accepted": True,
    })
    assert r.status_code == 201, r.text
    return headers, r.json()


@pytest.fixture
def patient(client):
    """A signed-in patient with an assigned doctor, ready to read their code."""
    _, doctor = _onboard_doctor(client)
    headers, record = _onboard_patient(client, doctor["id"], "patient.a@example.invalid",
                                       "Ada Patient")
    return headers, record


def _bridge_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _pair(client, code, device_id="handset-1", device_name="Pixel 8"):
    return client.post("/api/v1/bridge/pair", json={
        "bridge_code": code, "device_id": device_id, "device_name": device_name,
    })


# ---------------------------------------------------------------------------
# Code generation and normalisation
# ---------------------------------------------------------------------------
def test_generated_codes_match_the_published_format():
    for _ in range(200):
        code = generate_bridge_code()
        assert CODE_PATTERN.match(code), code
        assert code.startswith("VTL-")
        body = code.replace("-", "")[3:]
        assert len(body) == 8
        # No I/L/O/U: the alphabet must stay unambiguous when read aloud.
        assert all(c in CODE_ALPHABET for c in body)
        assert not set(body) & set("ILOU")


def test_generated_codes_are_unique_and_high_entropy():
    codes = {generate_bridge_code() for _ in range(20_000)}
    # 2**40 codes: 20k draws should collide with probability ~1e-4.
    assert len(codes) >= 19_995


def test_code_carries_no_identity_material():
    """The code is drawn from `secrets`, not derived from anything."""
    code = generate_bridge_code()
    for forbidden in ("@", ".", "eyJ", "-0000"):
        assert forbidden not in code.replace("VTL-", "")


@pytest.mark.parametrize("raw", [
    "VTL-8F4K-29QX", "vtl-8f4k-29qx", "VTL8F4K29QX", "  VTL 8F4K 29QX  ",
    "vtl_8f4k_29qx",
])
def test_normalize_accepts_reasonable_transcriptions(raw):
    assert normalize_bridge_code(raw) == "VTL-8F4K-29QX"


def test_normalize_repairs_confusable_characters_without_touching_the_prefix():
    # O -> 0, I/L -> 1 in the body; the L of "VTL" must survive.
    assert normalize_bridge_code("VTL-OI4K-29QX") == "VTL-014K-29QX"
    assert normalize_bridge_code("VTL-LO4K-29QX") == "VTL-104K-29QX"


@pytest.mark.parametrize("raw", [
    "", "VTL-8F4K", "VTL-8F4K-29QXX", "ABC-8F4K-29QX", "8F4K29QX",
    "VTL-8F4K-29Q!", None, "V" * 200,
])
def test_normalize_rejects_malformed_codes(raw):
    with pytest.raises(ValueError):
        normalize_bridge_code(raw)


# ---------------------------------------------------------------------------
# Authenticated retrieval
# ---------------------------------------------------------------------------
def test_patient_retrieves_one_permanent_code(client, patient):
    headers, _ = patient
    first = client.get("/api/v1/bridge/code", headers=headers)
    assert first.status_code == 200, first.text
    body = first.json()
    assert CODE_PATTERN.match(body["bridge_code"])
    assert body["devices"] == []
    assert body["rotated_at"] is None

    # Permanent: re-reading never mints a new one.
    for _ in range(3):
        again = client.get("/api/v1/bridge/code", headers=headers).json()
        assert again["bridge_code"] == body["bridge_code"]
        assert again["created_at"] == body["created_at"]


def test_each_patient_gets_a_distinct_code(client):
    _, doctor = _onboard_doctor(client)
    a_headers, _ = _onboard_patient(client, doctor["id"], "p.a@example.invalid", "A")
    b_headers, _ = _onboard_patient(client, doctor["id"], "p.b@example.invalid", "B")
    a = client.get("/api/v1/bridge/code", headers=a_headers).json()["bridge_code"]
    b = client.get("/api/v1/bridge/code", headers=b_headers).json()["bridge_code"]
    assert a != b


def test_unauthenticated_code_retrieval_is_rejected(client):
    assert client.get("/api/v1/bridge/code").status_code == 401
    assert client.post("/api/v1/bridge/code/regenerate").status_code == 401


def test_a_doctor_has_no_bridge_code(client, patient):
    """The code is a patient device credential; the owning doctor cannot read it."""
    doctor_headers, _ = _onboard_doctor(client, "doc.two@example.invalid")
    r = client.get("/api/v1/bridge/code", headers=doctor_headers)
    assert r.status_code == 404


def test_a_signed_in_stranger_has_no_bridge_code(client, patient):
    r = client.get("/api/v1/bridge/code", headers=_headers("nobody@example.invalid"))
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Pairing
# ---------------------------------------------------------------------------
def test_valid_pairing_returns_a_device_credential(client, patient):
    headers, record = patient
    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]

    r = _pair(client, code)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["token_type"] == "Bearer"
    assert body["device_token"].startswith("vtb_")
    assert len(body["device_token"]) > 40
    assert body["device"]["device_name"] == "Pixel 8"
    assert body["device"]["revoked_at"] is None
    # Minimal, display-only patient info -- no email, no clinical data.
    assert body["patient"] == {"id": record["id"], "display_name": "Ada Patient"}
    assert "email" not in str(body)

    # The device now shows up in the patient's own dashboard payload.
    listed = client.get("/api/v1/bridge/code", headers=headers).json()["devices"]
    assert [d["device_id"] for d in listed] == ["handset-1"]


def test_pairing_accepts_the_code_as_the_patient_would_type_it(client, patient):
    headers, _ = patient
    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    r = _pair(client, code.lower().replace("-", " "), device_id="handset-loose")
    assert r.status_code == 201, r.text


@pytest.mark.parametrize("bad", [
    "VTL-0000-0000", "not-a-code", "VTL-8F4K", "", "VTL-8F4K-29QXX",
])
def test_invalid_code_is_rejected(client, patient, bad):
    headers, _ = patient
    real = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    assert bad != real
    r = _pair(client, bad, device_id="attacker-handset")
    assert r.status_code in (401, 422), r.text
    if r.status_code == 401:
        # Unknown and malformed codes are indistinguishable to the caller.
        assert r.json()["detail"] == "Invalid bridge code"


def test_pairing_requires_a_device_id(client, patient):
    headers, _ = patient
    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    r = client.post("/api/v1/bridge/pair", json={"bridge_code": code, "device_id": "   "})
    assert r.status_code == 422


def test_pairing_ignores_any_client_supplied_patient_id(client, patient):
    """There is no field through which the handset can name a patient."""
    headers, _ = patient
    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    r = client.post("/api/v1/bridge/pair", json={
        "bridge_code": code, "device_id": "handset-x",
        "patient_id": "00000000-0000-0000-0000-0000000000ff",
    })
    assert r.status_code == 422


def test_repairing_the_same_handset_rotates_its_credential_in_place(client, patient):
    headers, _ = patient
    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    first = _pair(client, code).json()
    second = _pair(client, code, device_name="Pixel 8 (reinstalled)").json()

    assert second["device"]["id"] == first["device"]["id"]
    assert second["device_token"] != first["device_token"]
    assert second["device"]["device_name"] == "Pixel 8 (reinstalled)"
    # The superseded credential is dead, so a reinstall leaves nothing behind.
    assert client.get("/api/v1/bridge/session",
                      headers=_bridge_headers(first["device_token"])).status_code == 401
    assert client.get("/api/v1/bridge/session",
                      headers=_bridge_headers(second["device_token"])).status_code == 200
    # ...and it is still one device, not two.
    assert len(client.get("/api/v1/bridge/code", headers=headers).json()["devices"]) == 1


def test_pairing_is_rate_limited(env, tmp_path, monkeypatch):
    monkeypatch.setenv("VITALIS_BRIDGE_PAIR_RATE_LIMIT", "3")
    app = create_app(f"sqlite:///{tmp_path / 'legacy_rl.db'}", tmp_path, autostart=False)
    with TestClient(app) as c:
        codes = [_pair(c, "VTL-0000-000%d" % i, device_id="a").status_code for i in range(5)]
    assert codes[:3] == [401, 401, 401]
    assert 429 in codes[3:], codes


# ---------------------------------------------------------------------------
# Device-authenticated session
# ---------------------------------------------------------------------------
def test_bridge_session_reports_the_derived_patient(client, patient):
    headers, record = patient
    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    token = _pair(client, code).json()["device_token"]

    r = client.get("/api/v1/bridge/session", headers=_bridge_headers(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["patient"]["id"] == record["id"]
    assert body["device"]["device_id"] == "handset-1"


@pytest.mark.parametrize("header", [
    None, {"Authorization": "Bearer "}, {"Authorization": "Bearer vtb_not-a-real-token"},
    {"Authorization": "Bearer not-even-prefixed"},
])
def test_unauthorized_bridge_requests_are_rejected(client, patient, header):
    r = client.get("/api/v1/bridge/session", headers=header)
    assert r.status_code == 401
    assert r.headers.get("WWW-Authenticate") == "Bearer"


def test_a_supabase_jwt_does_not_authenticate_a_bridge_route(client, patient):
    """The two credential families are not interchangeable in either direction."""
    headers, _ = patient
    assert client.get("/api/v1/bridge/session", headers=headers).status_code == 401

    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    token = _pair(client, code).json()["device_token"]
    assert client.get("/api/v1/bridge/code", headers=_bridge_headers(token)).status_code == 401


# ---------------------------------------------------------------------------
# Vitals upload through the existing pipeline
# ---------------------------------------------------------------------------
def _reading(**overrides):
    body = {
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "heart_rate": 78, "spo2": 97, "respiratory_rate": 16,
        "temperature_c": 36.8, "systolic_bp": 118, "consciousness": "A",
        "supplemental_oxygen": False,
    }
    body.update(overrides)
    return body


def test_bridge_vitals_flow_into_the_existing_patient_pipeline(client, patient):
    headers, record = patient
    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    token = _pair(client, code).json()["device_token"]

    r = client.post("/api/v1/bridge/vitals", headers=_bridge_headers(token), json=_reading())
    assert r.status_code == 201, r.text
    written = r.json()
    assert written["patient_id"] == record["id"]
    # Provenance is stamped by the backend, not accepted from the handset.
    assert written["source"] == "bridge"
    assert written["device_id"] == "handset-1"

    # Same table, same risk pipeline, same dashboard read path -- no side channel.
    history = client.get(f"/api/v1/patients/{record['id']}/history", headers=headers).json()
    assert [v["id"] for v in history["vitals"]] == [written["id"]]
    assert len(history["risk"]) == 1
    assert history["risk"][0]["vitals_id"] == written["id"]


def test_bridge_vitals_raise_alerts_for_the_doctor_dashboard(client):
    doctor_headers, doctor = _onboard_doctor(client)
    patient_headers, record = _onboard_patient(client, doctor["id"], "sick@example.invalid",
                                               "Deteriorating Patient")
    code = client.get("/api/v1/bridge/code", headers=patient_headers).json()["bridge_code"]
    token = _pair(client, code).json()["device_token"]

    r = client.post("/api/v1/bridge/vitals", headers=_bridge_headers(token), json=_reading(
        heart_rate=140, spo2=84, respiratory_rate=30, temperature_c=39.5,
        systolic_bp=85, consciousness="V", supplemental_oxygen=True,
    ))
    assert r.status_code == 201, r.text

    # The assigned doctor sees it through their existing endpoints.
    alerts = client.get(f"/api/v1/patients/{record['id']}/alerts",
                        headers=doctor_headers).json()
    assert alerts and alerts[0]["severity"] == "critical"


def test_bridge_vitals_reject_a_client_supplied_patient_or_provenance(client, patient):
    headers, _ = patient
    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    token = _pair(client, code).json()["device_token"]
    auth = _bridge_headers(token)

    for forged in ({"patient_id": str(uuid.uuid4())}, {"source": "manual"},
                   {"device_id": "someone-elses-handset"}):
        r = client.post("/api/v1/bridge/vitals", headers=auth, json=_reading(**forged))
        assert r.status_code == 422, (forged, r.text)


def test_bridge_vitals_still_validate_clinical_ranges(client, patient):
    headers, _ = patient
    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    token = _pair(client, code).json()["device_token"]
    r = client.post("/api/v1/bridge/vitals", headers=_bridge_headers(token),
                    json=_reading(heart_rate=999))
    assert r.status_code == 422


def test_bridge_vitals_require_a_timezone(client, patient):
    headers, _ = patient
    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    token = _pair(client, code).json()["device_token"]
    r = client.post("/api/v1/bridge/vitals", headers=_bridge_headers(token),
                    json=_reading(recorded_at="2026-09-10T10:00:00"))
    assert r.status_code == 422


def test_unauthenticated_vitals_upload_is_rejected(client, patient):
    assert client.post("/api/v1/bridge/vitals", json=_reading()).status_code == 401


# ---------------------------------------------------------------------------
# Patient isolation
# ---------------------------------------------------------------------------
def test_one_patients_device_can_never_write_to_another_patient(client):
    _, doctor = _onboard_doctor(client)
    a_headers, a = _onboard_patient(client, doctor["id"], "iso.a@example.invalid", "Patient A")
    b_headers, b = _onboard_patient(client, doctor["id"], "iso.b@example.invalid", "Patient B")

    a_code = client.get("/api/v1/bridge/code", headers=a_headers).json()["bridge_code"]
    a_token = _pair(client, a_code, device_id="a-handset").json()["device_token"]

    r = client.post("/api/v1/bridge/vitals", headers=_bridge_headers(a_token), json=_reading())
    assert r.status_code == 201
    assert r.json()["patient_id"] == a["id"]

    # B's record is untouched, and B's dashboard shows nothing from A's device.
    b_history = client.get(f"/api/v1/patients/{b['id']}/history", headers=b_headers).json()
    assert b_history["vitals"] == []

    # A's device is bound to A's patient no matter what it sends.
    session = client.get("/api/v1/bridge/session", headers=_bridge_headers(a_token)).json()
    assert session["patient"]["id"] == a["id"] != b["id"]


def test_a_patient_cannot_revoke_another_patients_device(client):
    _, doctor = _onboard_doctor(client)
    a_headers, _ = _onboard_patient(client, doctor["id"], "rev.a@example.invalid", "A")
    b_headers, _ = _onboard_patient(client, doctor["id"], "rev.b@example.invalid", "B")
    a_code = client.get("/api/v1/bridge/code", headers=a_headers).json()["bridge_code"]
    a_device = _pair(client, a_code).json()["device"]["id"]

    r = client.delete(f"/api/v1/bridge/devices/{a_device}", headers=b_headers)
    assert r.status_code == 404
    # Still paired.
    assert len(client.get("/api/v1/bridge/code", headers=a_headers).json()["devices"]) == 1


# ---------------------------------------------------------------------------
# Persistence, revocation and rotation
# ---------------------------------------------------------------------------
def test_pairing_survives_across_app_restarts(env, tmp_path):
    """Paired means paired until someone explicitly disconnects."""
    app = create_app(f"sqlite:///{tmp_path / 'legacy1.db'}", tmp_path, autostart=False)
    with TestClient(app) as c:
        _, doctor = _onboard_doctor(c)
        headers, _ = _onboard_patient(c, doctor["id"], "persist@example.invalid", "P")
        code = c.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
        token = _pair(c, code).json()["device_token"]

    restarted = create_app(f"sqlite:///{tmp_path / 'legacy2.db'}", tmp_path, autostart=False)
    with TestClient(restarted) as c2:
        assert c2.get("/api/v1/bridge/session",
                      headers=_bridge_headers(token)).status_code == 200
        assert c2.post("/api/v1/bridge/vitals", headers=_bridge_headers(token),
                       json=_reading()).status_code == 201


def test_patient_revokes_a_device_and_it_stops_working(client, patient):
    headers, _ = patient
    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    paired = _pair(client, code).json()
    token = paired["device_token"]

    assert client.delete(f"/api/v1/bridge/devices/{paired['device']['id']}",
                         headers=headers).status_code == 204
    assert client.get("/api/v1/bridge/code", headers=headers).json()["devices"] == []
    assert client.get("/api/v1/bridge/session",
                      headers=_bridge_headers(token)).status_code == 401
    assert client.post("/api/v1/bridge/vitals", headers=_bridge_headers(token),
                       json=_reading()).status_code == 401
    # Revoking twice is not a way to probe for other people's device ids.
    assert client.delete(f"/api/v1/bridge/devices/{paired['device']['id']}",
                         headers=headers).status_code == 404
    assert client.delete("/api/v1/bridge/devices/not-a-uuid",
                         headers=headers).status_code == 404


def test_device_can_disconnect_itself(client, patient):
    headers, _ = patient
    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    token = _pair(client, code).json()["device_token"]

    assert client.post("/api/v1/bridge/unpair",
                       headers=_bridge_headers(token)).status_code == 204
    assert client.get("/api/v1/bridge/session",
                      headers=_bridge_headers(token)).status_code == 401
    assert client.get("/api/v1/bridge/code", headers=headers).json()["devices"] == []


def test_regenerating_retires_the_old_code_but_keeps_paired_devices(client, patient):
    headers, _ = patient
    old = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    token = _pair(client, old).json()["device_token"]

    r = client.post("/api/v1/bridge/code/regenerate", headers=headers)
    assert r.status_code == 200, r.text
    new = r.json()
    assert new["bridge_code"] != old
    assert CODE_PATTERN.match(new["bridge_code"])
    assert new["rotated_at"] is not None

    # The retired code no longer enrols anything...
    assert _pair(client, old, device_id="late-arrival").status_code == 401
    # ...while an already-trusted handset keeps streaming.
    assert client.post("/api/v1/bridge/vitals", headers=_bridge_headers(token),
                       json=_reading()).status_code == 201
    assert _pair(client, new["bridge_code"], device_id="new-handset").status_code == 201


# ---------------------------------------------------------------------------
# Secret handling
# ---------------------------------------------------------------------------
def test_hashes_are_stable_and_do_not_reveal_their_input():
    code = generate_bridge_code()
    assert hash_bridge_code(code) == hash_bridge_code(code)
    assert len(hash_bridge_code(code)) == 64
    assert code not in hash_bridge_code(code)
    assert hash_bridge_code(code) != hash_bridge_code(generate_bridge_code())
    assert hash_device_token("vtb_abc") != "vtb_abc"


def test_no_code_or_token_is_persisted_into_the_audit_trail(client, patient):
    from sqlalchemy import select

    from app.db_platform import app_audit, app_bridge_devices, connect

    headers, _ = patient
    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    token = _pair(client, code).json()["device_token"]
    client.post("/api/v1/bridge/vitals", headers=_bridge_headers(token), json=_reading())
    _pair(client, "VTL-0000-0000", device_id="attacker")

    engine = connect(client.app.state.platform_engine.url.render_as_string(hide_password=False))
    with engine.connect() as conn:
        events = conn.execute(select(app_audit.c.event_type, app_audit.c.details)).mappings().all()
        stored = conn.execute(select(app_bridge_devices.c.token_hash)).scalars().all()

    kinds = {e["event_type"] for e in events}
    assert {"BRIDGE_CODE_ISSUED", "BRIDGE_DEVICE_PAIRED", "BRIDGE_PAIR_REJECTED"} <= kinds
    blob = str([dict(e) for e in events])
    assert code not in blob
    assert token not in blob
    # The credential itself is never stored -- only its digest.
    assert token not in stored
    assert hash_device_token(token) in stored


# ---------------------------------------------------------------------------
# Revocation must not be reversible by replaying the permanent code
# ---------------------------------------------------------------------------
def test_revoked_device_cannot_repair_with_the_same_code(client, patient):
    """The core regression: revocation is not undone by a code replay.

    Before this was fixed, `POST /bridge/pair` matched the existing
    (patient_id, device_id) row without checking `revoked_at` and cleared it,
    so a handset the patient had just disconnected could re-enrol in one call
    -- the Bridge Code is permanent and revocation does not change it.
    """
    headers, _ = patient
    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    paired = _pair(client, code).json()

    assert client.delete(f"/api/v1/bridge/devices/{paired['device']['id']}",
                         headers=headers).status_code == 204

    replay = _pair(client, code)
    assert replay.status_code == 403, replay.text
    assert "new Bridge Code" in replay.json()["detail"]
    assert "device_token" not in replay.json()
    assert client.get("/api/v1/bridge/code", headers=headers).json()["devices"] == []
    # The original token stays dead too.
    assert client.get("/api/v1/bridge/session",
                      headers=_bridge_headers(paired["device_token"])).status_code == 401


def test_revoked_device_may_repair_after_the_patient_regenerates_the_code(client, patient):
    """Rotation is the patient's explicit consent to re-enrol."""
    headers, _ = patient
    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    paired = _pair(client, code).json()
    client.delete(f"/api/v1/bridge/devices/{paired['device']['id']}", headers=headers)
    assert _pair(client, code).status_code == 403

    fresh = client.post("/api/v1/bridge/code/regenerate", headers=headers).json()["bridge_code"]
    assert fresh != code
    # The old code is dead as a code, independently of the revocation rule.
    assert _pair(client, code).status_code == 401

    repaired = _pair(client, fresh)
    assert repaired.status_code == 201, repaired.text
    token = repaired.json()["device_token"]
    assert client.get("/api/v1/bridge/session", headers=_bridge_headers(token)).status_code == 200
    assert len(client.get("/api/v1/bridge/code", headers=headers).json()["devices"]) == 1


def test_revoking_one_device_does_not_block_a_different_handset(client, patient):
    """The block is scoped to the revoked device_id, not to the account."""
    headers, _ = patient
    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    first = _pair(client, code, device_id="handset-1").json()
    client.delete(f"/api/v1/bridge/devices/{first['device']['id']}", headers=headers)

    assert _pair(client, code, device_id="handset-1").status_code == 403
    second = _pair(client, code, device_id="handset-2")
    assert second.status_code == 201, second.text
    assert client.get("/api/v1/bridge/session",
                      headers=_bridge_headers(second.json()["device_token"])).status_code == 200


def test_device_that_unpaired_itself_also_cannot_replay_the_code(client, patient):
    """`POST /bridge/unpair` is a revocation and gets the same protection."""
    headers, _ = patient
    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    token = _pair(client, code).json()["device_token"]
    assert client.post("/api/v1/bridge/unpair", headers=_bridge_headers(token)).status_code == 204
    assert _pair(client, code).status_code == 403


# ---------------------------------------------------------------------------
# Vitals idempotency and alert hysteresis on the bridge path
# ---------------------------------------------------------------------------
def test_retried_reading_is_idempotent(client, patient):
    """A network retry must not create a second reading, risk row or alert."""
    headers, record = patient
    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    token = _pair(client, code).json()["device_token"]
    reading = _reading()

    first = client.post("/api/v1/bridge/vitals", headers=_bridge_headers(token), json=reading)
    assert first.status_code == 201, first.text
    replay = client.post("/api/v1/bridge/vitals", headers=_bridge_headers(token), json=reading)
    assert replay.status_code == 201, replay.text
    # Same stored row, not a new one.
    assert replay.json()["id"] == first.json()["id"]

    history = client.get(f"/api/v1/patients/{record['id']}/history", headers=headers).json()
    assert len(history["vitals"]) == 1
    assert len(history["risk"]) == 1


def test_distinct_timestamps_are_still_recorded_separately(client, patient):
    """Idempotency must not swallow genuinely new readings."""
    headers, record = patient
    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    token = _pair(client, code).json()["device_token"]
    for offset in range(3):
        moment = datetime(2026, 9, 10, 12, offset, 0, tzinfo=timezone.utc).isoformat()
        r = client.post("/api/v1/bridge/vitals", headers=_bridge_headers(token),
                        json=_reading(recorded_at=moment))
        assert r.status_code == 201, r.text
    history = client.get(f"/api/v1/patients/{record['id']}/history", headers=headers).json()
    assert len(history["vitals"]) == 3
    assert len(history["risk"]) == 3


def test_sustained_critical_stream_does_not_spam_identical_alerts(client, patient):
    """Hysteresis: one open alert per unresolved condition, not one per reading."""
    headers, record = patient
    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    token = _pair(client, code).json()["device_token"]
    critical = {"heart_rate": 140, "spo2": 85, "respiratory_rate": 30,
                "temperature_c": 39.5, "systolic_bp": 80, "consciousness": "U",
                "supplemental_oxygen": True}
    for minute in range(6):
        moment = datetime(2026, 9, 10, 13, minute, 0, tzinfo=timezone.utc).isoformat()
        r = client.post("/api/v1/bridge/vitals", headers=_bridge_headers(token),
                        json=_reading(recorded_at=moment, **critical))
        assert r.status_code == 201, r.text

    alerts = client.get(f"/api/v1/patients/{record['id']}/alerts", headers=headers).json()
    risk_alerts = [a for a in alerts if a["kind"] == "RISK_STATE"]
    assert len(risk_alerts) == 1, [a["message"] for a in risk_alerts]
    assert risk_alerts[0]["severity"] == "critical"
    # Every reading still produced its own risk assessment; only alerting is
    # debounced, so the dashboard trend is unaffected.
    history = client.get(f"/api/v1/patients/{record['id']}/history", headers=headers).json()
    assert len(history["risk"]) == 6


def test_escalation_from_warning_to_critical_still_alerts(client, patient):
    """Genuine escalation must break through the debounce."""
    headers, record = patient
    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    token = _pair(client, code).json()["device_token"]

    # NEWS2-lite 5 -> WARNING (not 7+, which would already be CRITICAL and
    # leave nothing to escalate from).
    warning = {"heart_rate": 112, "spo2": 94, "respiratory_rate": 21,
               "temperature_c": 37.0, "systolic_bp": 112, "consciousness": "A",
               "supplemental_oxygen": False}
    critical = {"heart_rate": 140, "spo2": 85, "respiratory_rate": 30,
                "temperature_c": 39.5, "systolic_bp": 80, "consciousness": "U",
                "supplemental_oxygen": True}

    def push(minute, **vitals):
        moment = datetime(2026, 9, 10, 14, minute, 0, tzinfo=timezone.utc).isoformat()
        r = client.post("/api/v1/bridge/vitals", headers=_bridge_headers(token),
                        json=_reading(recorded_at=moment, **vitals))
        assert r.status_code == 201, r.text

    push(0, **warning)
    push(1, **warning)
    opened = [a for a in client.get(f"/api/v1/patients/{record['id']}/alerts",
                                    headers=headers).json() if a["kind"] == "RISK_STATE"]
    assert [a["severity"] for a in opened] == ["warning"]

    push(2, **critical)
    escalated = [a for a in client.get(f"/api/v1/patients/{record['id']}/alerts",
                                       headers=headers).json() if a["kind"] == "RISK_STATE"]
    assert sorted(a["severity"] for a in escalated) == ["critical", "warning"]


def test_acknowledging_reopens_alerting_for_the_next_reading(client, patient):
    """After the doctor acknowledges, a still-critical patient alerts again."""
    headers, record = patient
    code = client.get("/api/v1/bridge/code", headers=headers).json()["bridge_code"]
    token = _pair(client, code).json()["device_token"]
    critical = {"heart_rate": 140, "spo2": 85, "respiratory_rate": 30,
                "temperature_c": 39.5, "systolic_bp": 80, "consciousness": "U",
                "supplemental_oxygen": True}

    def push(minute):
        moment = datetime(2026, 9, 10, 15, minute, 0, tzinfo=timezone.utc).isoformat()
        assert client.post("/api/v1/bridge/vitals", headers=_bridge_headers(token),
                           json=_reading(recorded_at=moment, **critical)).status_code == 201

    push(0)
    push(1)
    first = [a for a in client.get(f"/api/v1/patients/{record['id']}/alerts",
                                   headers=headers).json() if a["kind"] == "RISK_STATE"]
    assert len(first) == 1
    assert client.post(
        f"/api/v1/patients/{record['id']}/alerts/{first[0]['id']}/acknowledge",
        headers=headers,
    ).status_code == 200

    push(2)
    after = [a for a in client.get(f"/api/v1/patients/{record['id']}/alerts",
                                   headers=headers).json() if a["kind"] == "RISK_STATE"]
    assert len(after) == 2
    assert len([a for a in after if a["acknowledged_at"] is None]) == 1
