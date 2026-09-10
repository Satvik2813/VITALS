"""Pydantic v2 request/response schemas for the v1 authenticated API."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class MeResponse(BaseModel):
    id: str
    email: str
    full_name: str | None = None
    avatar_url: str | None = None
    role: Literal["doctor", "patient", "admin"] | None = None
    onboarding_completed: bool = False
    phone: str | None = None
    specialization: str | None = None
    hospital: str | None = None


class PatientBase(BaseModel):
    model_config = ConfigDict(extra="forbid")
    full_name: str = Field(min_length=1, max_length=200)
    mrn: str | None = Field(default=None, max_length=64)
    date_of_birth: date | None = None
    sex: Literal["female", "male", "other", "unknown"] | None = None
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator("full_name")
    @classmethod
    def nonempty_name(cls, value):
        if not value.strip():
            raise ValueError("full_name must not be blank")
        return value


class PatientCreate(PatientBase):
    pass


class PatientUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    mrn: str | None = Field(default=None, max_length=64)
    date_of_birth: date | None = None
    sex: Literal["female", "male", "other", "unknown"] | None = None
    notes: str | None = Field(default=None, max_length=4000)
    # Self-editable by the patient the record belongs to; see update_patient().
    phone: str | None = Field(default=None, max_length=32)
    emergency_contact_name: str | None = Field(default=None, max_length=200)
    emergency_contact_phone: str | None = Field(default=None, max_length=32)

    @field_validator("full_name")
    @classmethod
    def nonempty_name(cls, value):
        if value is None or not value.strip():
            raise ValueError("full_name must not be null or blank")
        return value


class Patient(PatientBase):
    id: str
    owner_id: str
    user_id: str | None = None
    phone: str | None = None
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    created_at: datetime
    updated_at: datetime


class DoctorSummary(BaseModel):
    id: str
    full_name: str | None = None
    specialization: str | None = None
    hospital: str | None = None


class PatientOnboardingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    full_name: str = Field(min_length=1, max_length=200)
    date_of_birth: date | None = None
    sex: Literal["female", "male", "other", "unknown"] | None = None
    phone: str | None = Field(default=None, max_length=32)
    emergency_contact_name: str | None = Field(default=None, max_length=200)
    emergency_contact_phone: str | None = Field(default=None, max_length=32)
    assigned_doctor_id: str
    consent_accepted: bool

    @field_validator("full_name")
    @classmethod
    def nonempty_name(cls, value):
        if not value.strip():
            raise ValueError("full_name must not be blank")
        return value

    @field_validator("consent_accepted")
    @classmethod
    def must_consent(cls, value):
        if not value:
            raise ValueError("consent_accepted must be true to complete onboarding")
        return value


class DoctorOnboardingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    full_name: str = Field(min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=32)
    specialization: str | None = Field(default=None, max_length=200)
    hospital: str | None = Field(default=None, max_length=200)
    medical_registration: str | None = Field(default=None, max_length=100)

    @field_validator("full_name")
    @classmethod
    def nonempty_name(cls, value):
        if not value.strip():
            raise ValueError("full_name must not be blank")
        return value


class VitalsMeasurement(BaseModel):
    """The clinical payload of one reading, with no provenance fields.

    Split out of VitalsIn (whose shape is unchanged) so the bridge endpoint
    can accept exactly the measurements and nothing else: a paired Android
    device must not be able to claim a `source` or `device_id` -- the backend
    stamps those from the authenticated bridge session.
    """

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    recorded_at: datetime
    heart_rate: int | None = Field(default=None, ge=20, le=250)
    spo2: int | None = Field(default=None, ge=50, le=100)
    respiratory_rate: int | None = Field(default=None, ge=4, le=60)
    temperature_c: float | None = Field(default=None, ge=30, le=43)
    systolic_bp: int | None = Field(default=None, ge=50, le=260)
    diastolic_bp: int | None = Field(default=None, ge=20, le=200)
    consciousness: Literal["A", "C", "V", "P", "U"] | None = None
    supplemental_oxygen: bool | None = None


class VitalsIn(VitalsMeasurement):
    source: str | None = Field(default=None, max_length=64)
    device_id: str | None = Field(default=None, max_length=128)


class VitalsOut(VitalsIn):
    id: str
    patient_id: str
    created_at: datetime


class RiskOut(BaseModel):
    id: str
    patient_id: str
    vitals_id: str | None
    model_version: str
    score: float
    state: str
    is_mock: bool
    features: dict[str, Any]
    created_at: datetime


class AlertOut(BaseModel):
    id: str
    patient_id: str
    severity: str
    kind: str
    message: str
    payload: dict[str, Any]
    created_at: datetime
    acknowledged_at: datetime | None
    acknowledged_by: str | None


class HistoryOut(BaseModel):
    patient: Patient
    vitals: list[VitalsOut]
    alerts: list[AlertOut]
    risk: list[RiskOut]


class PredictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    patient_id: str
    recorded_at: datetime
    heart_rate: int | None = None
    spo2: int | None = None
    respiratory_rate: int | None = None
    temperature_c: float | None = None
    systolic_bp: int | None = None
    consciousness: Literal["A", "C", "V", "P", "U"] | None = None
    supplemental_oxygen: bool | None = None


class PredictResponse(BaseModel):
    model_version: str
    score: float
    state: str
    is_mock: bool
    features: dict[str, Any]
    computed_at: datetime


class DocumentOut(BaseModel):
    id: str
    patient_id: str
    filename: str
    sha256: str
    size_bytes: int
    uploaded_by: str | None
    uploaded_at: datetime
    scan_verdict: str | None
    scan_payload: dict[str, Any]


# ---------------------------------------------------------------------------
# VITALIS Bridge (permanent patient code + Android device pairing).
# See app/bridge.py and docs/BRIDGE.md.
# ---------------------------------------------------------------------------
class BridgeDeviceOut(BaseModel):
    id: str
    device_id: str
    device_name: str | None
    paired_at: datetime
    last_seen_at: datetime | None
    revoked_at: datetime | None


class BridgeCodeResponse(BaseModel):
    """What the patient sees in their own dashboard."""

    bridge_code: str
    created_at: datetime
    rotated_at: datetime | None
    devices: list[BridgeDeviceOut]


class BridgePatientSummary(BaseModel):
    """The minimum the handset needs to show *whose* account it just linked.

    Deliberately display-only: an id the client must never send back as an
    authorization claim, plus a name to render on the pairing-success screen.
    """

    id: str
    display_name: str


class BridgePairRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    bridge_code: str = Field(min_length=1, max_length=64)
    device_id: str = Field(min_length=1, max_length=128)
    device_name: str | None = Field(default=None, max_length=120)


class BridgePairResponse(BaseModel):
    device_token: str
    token_type: Literal["Bearer"] = "Bearer"
    device: BridgeDeviceOut
    patient: BridgePatientSummary


class BridgeSessionResponse(BaseModel):
    device: BridgeDeviceOut
    patient: BridgePatientSummary


class BridgeVitalsIn(VitalsMeasurement):
    """Bridge upload body: measurements only, no patient id, no provenance."""
