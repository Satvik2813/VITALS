from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

STATES = ["NORMAL", "WATCH", "WARNING", "CRITICAL"]
VITALS = ["heart_rate", "spo2", "respiratory_rate", "temperature", "systolic_bp"]
LABELS = {
    "heart_rate": "Heart rate",
    "spo2": "SpO₂",
    "respiratory_rate": "Respiratory rate",
    "temperature": "Temperature",
    "systolic_bp": "Systolic BP",
    "oxygen": "Supplemental oxygen",
    "consciousness": "Consciousness",
}


class Reading(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    patient_id: str = Field(pattern=r"^p[1-8]$")
    timestamp: datetime
    heart_rate: int = Field(ge=20, le=250, strict=True)
    spo2: int = Field(ge=50, le=100, strict=True)
    respiratory_rate: int = Field(ge=4, le=60, strict=True)
    temperature: float = Field(ge=30, le=43)
    systolic_bp: int = Field(ge=50, le=260, strict=True)
    consciousness: Literal["A", "C", "V", "P", "U"]
    supplemental_oxygen: bool = Field(strict=True)

    @field_validator("timestamp")
    @classmethod
    def aware_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("Timestamp must include a timezone")
        return value

    @field_validator("temperature")
    @classmethod
    def one_decimal(cls, value: float) -> float:
        if abs(value * 10 - round(value * 10)) > 1e-6:
            raise ValueError("Temperature must use 0.1 °C resolution")
        return value


class DemoControl(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["play", "pause", "deteriorate", "reset", "advance"]
    steps: int = Field(default=1, ge=1, le=60)
