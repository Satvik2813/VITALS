"""ML inference boundary.

The real deterioration model is being trained separately. Everything downstream
of the API talks to a `RiskPredictor` interface, so swapping the mock for the
trained model is a single-file change.

Contract:
    predictor.predict(features: VitalsFeatures) -> RiskResult

Both `features` and `RiskResult` are plain, serializable dataclasses so this
boundary can move to an HTTP microservice without touching any router.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol


@dataclass(frozen=True)
class VitalsFeatures:
    patient_id: str
    recorded_at: datetime
    heart_rate: int | None
    spo2: int | None
    respiratory_rate: int | None
    temperature_c: float | None
    systolic_bp: int | None
    consciousness: str | None
    supplemental_oxygen: bool | None

    # ML Model additional features (with explicit fallback to None if unavailable)
    diastolic_bp: int | None = None
    sleep_duration_hours: float | None = None
    quality_of_sleep: float | None = None
    physical_activity_level: float | None = None
    daily_steps: int | None = None
    resting_heart_rate: int | None = None
    baseline_systolic_bp: int | None = None
    baseline_diastolic_bp: int | None = None
    age: int | None = None
    bmi_category: str | None = None
    stress_level: float | None = None
    gender: str | None = None


@dataclass(frozen=True)
class RiskResult:
    model_version: str
    score: float
    state: str  # NORMAL | WATCH | WARNING | CRITICAL (or model outputs)
    features: dict[str, Any]
    is_mock: bool
    computed_at: datetime


class RiskPredictor(Protocol):
    def predict(self, features: VitalsFeatures) -> RiskResult: ...


# ---------------------------------------------------------------------------
# Canonical application risk states.
#
# These four values are the contract shared by the database
# (`app_risk_assessments.state CHECK (...)`), the alerting rule in
# app.api_v1.router._record_vitals, and the frontend `StateBadge`. Any
# predictor -- mock, trained, or a future HTTP microservice -- must emit one
# of them.
#
# The trained VITALIS_ENGINE model reports its own five-class vocabulary
# (VITALIS_ENGINE/class_names.json), which is deliberately NOT changed here:
# the model is authoritative about its own labels, and this module is
# responsible for translating them. `Moderate` and `High` both fold into
# WARNING because the canonical vocabulary has one pre-critical escalation
# level, and losing that distinction in the state is acceptable while the raw
# label and full class probabilities are preserved in RiskResult.features.
# ---------------------------------------------------------------------------
CANONICAL_STATES: tuple[str, ...] = ("NORMAL", "WATCH", "WARNING", "CRITICAL")

MODEL_STATE_MAP: dict[str, str] = {
    "Stable": "NORMAL",
    "Watch": "WATCH",
    "Moderate": "WARNING",
    "High": "WARNING",
    "Critical": "CRITICAL",
}

# An unrecognised label must never reach the database (it would violate the
# CHECK constraint and fail the whole ingestion) and must never be silently
# treated as healthy. WATCH is the conservative landing spot: it surfaces the
# reading for review without manufacturing a WARNING/CRITICAL alert from what
# is really a configuration problem. `unmapped_model_state` marks it.
UNKNOWN_STATE_FALLBACK = "WATCH"


def canonical_state(raw: str | None) -> tuple[str, bool]:
    """Translate any predictor's state label into a canonical state.

    Returns ``(state, mapped)`` where `mapped` is False when the input was not
    recognised and the fallback was applied.
    """
    if isinstance(raw, str):
        if raw in CANONICAL_STATES:
            return raw, True
        mapped = MODEL_STATE_MAP.get(raw) or MODEL_STATE_MAP.get(raw.strip().title())
        if mapped:
            return mapped, True
        upper = raw.strip().upper()
        if upper in CANONICAL_STATES:
            return upper, True
    return UNKNOWN_STATE_FALLBACK, False


def _band(value: float, thresholds: list[tuple[float, int]]) -> int:
    for upper, points in thresholds:
        if value <= upper:
            return points
    return thresholds[-1][1]


def compute_news2_lite(features: VitalsFeatures) -> int:
    score = 0
    f = features
    if f.respiratory_rate is not None:
        score += _band(f.respiratory_rate, [(8, 3), (11, 1), (20, 0), (24, 2), (999, 3)])
    if f.spo2 is not None:
        score += _band(f.spo2, [(91, 3), (93, 2), (95, 1), (100, 0)])
    if f.supplemental_oxygen:
        score += 2
    if f.temperature_c is not None:
        t = float(f.temperature_c)
        score += _band(t, [(35.0, 3), (36.0, 1), (38.0, 0), (39.0, 1), (999, 2)])
    if f.systolic_bp is not None:
        score += _band(f.systolic_bp, [(90, 3), (100, 2), (110, 1), (219, 0), (999, 3)])
    if f.heart_rate is not None:
        score += _band(f.heart_rate, [(40, 3), (50, 1), (90, 0), (110, 1), (130, 2), (999, 3)])
    if f.consciousness and f.consciousness != "A":
        score += 3
    return score


class MockRiskPredictor:
    """DETERMINISTIC MOCK. NOT A TRAINED MODEL. Do NOT ship as real inference.

    Applies a simple NEWS2-style scoring so the frontend has something to render
    while the real ML model is being trained. Every response is stamped
    `is_mock=True` and `model_version="mock-news2-lite-v0"` so callers can tell.
    """

    model_version = "mock-news2-lite-v0"

    def predict(self, features: VitalsFeatures) -> RiskResult:
        score = compute_news2_lite(features)
        if score >= 7:
            state = "CRITICAL"
        elif score >= 5:
            state = "WARNING"
        elif score >= 3:
            state = "WATCH"
        else:
            state = "NORMAL"

        return RiskResult(
            model_version=self.model_version,
            score=float(score),
            state=state,
            features={
                "heart_rate": features.heart_rate,
                "spo2": features.spo2,
                "respiratory_rate": features.respiratory_rate,
                "temperature_c": None if features.temperature_c is None else float(features.temperature_c),
                "systolic_bp": features.systolic_bp,
                "consciousness": features.consciousness,
                "supplemental_oxygen": features.supplemental_oxygen,
            },
            is_mock=True,
            computed_at=datetime.now(timezone.utc),
        )


class TrainedRiskPredictor:
    """Production ML Predictor integrating VITALIS_ENGINE."""

    def __init__(self):
        engine_dir = Path(__file__).resolve().parents[3] / "VITALIS_ENGINE"
        if str(engine_dir) not in sys.path:
            sys.path.insert(0, str(engine_dir))
        
        import vitalis_inference
        self.model, self.metadata = vitalis_inference.load_vitalis_model(engine_dir)
        self.model_version = self.metadata.get("model_version", "vitalis-trained-v1")

    def predict(self, features: VitalsFeatures) -> RiskResult:
        import vitalis_inference

        # Prepare 16-feature schema
        patient_data = {
            "heart_rate": features.heart_rate,
            "spo2": features.spo2,
            "systolic_bp": features.systolic_bp,
            "diastolic_bp": features.diastolic_bp,
            "body_temperature_c": features.temperature_c,
            "sleep_duration_hours": features.sleep_duration_hours,
            "quality_of_sleep": features.quality_of_sleep,
            "physical_activity_level": features.physical_activity_level,
            "daily_steps": features.daily_steps,
            "resting_heart_rate": features.resting_heart_rate,
            "baseline_systolic_bp": features.baseline_systolic_bp,
            "baseline_diastolic_bp": features.baseline_diastolic_bp,
            "age": features.age,
            "bmi_category": features.bmi_category,
            "stress_level": features.stress_level,
            "gender": features.gender,
        }

        # Run ML inference
        ml_result = vitalis_inference.predict_vitalis_risk(
            patient_data,
            model=self.model,
            metadata=self.metadata
        )
        
        # Preserve deterministic safety: NEWS2-lite overrides
        news2_score = compute_news2_lite(features)
        raw_model_state = ml_result["risk_level"]
        # Translate the model's own vocabulary into the canonical states the
        # database, the alerting rule and the dashboards all share BEFORE any
        # hybrid logic runs, so the comparisons below (and the value that
        # finally lands in app_risk_assessments.state) are canonical.
        ml_state, mapped = canonical_state(raw_model_state)

        # Hybrid logic: Do not let ML suppress a critical physiological alert
        if news2_score >= 7:
            final_state = "CRITICAL"
        elif news2_score >= 5 and ml_state in ("NORMAL", "WATCH"):
            final_state = "WARNING"  # Escalate basic warning
        else:
            final_state = ml_state

        missing_features = [k for k, v in patient_data.items() if v is None]

        return RiskResult(
            model_version=self.model_version,
            score=ml_result["confidence"],
            state=final_state,
            features={
                **patient_data,
                "probabilities": ml_result["probabilities"],
                "missing_features": missing_features,
                # Keep the model's own label and score context alongside the
                # canonical state so nothing is lost in translation.
                "raw_model_state": raw_model_state,
                "news2_score": news2_score,
                **({} if mapped else {"unmapped_model_state": True}),
            },
            is_mock=False,
            computed_at=datetime.now(timezone.utc),
        )


_predictor: RiskPredictor | None = None


def get_predictor() -> RiskPredictor:
    """Return the current predictor. Uses TrainedRiskPredictor by default."""
    global _predictor
    if _predictor is not None:
        return _predictor
    dotted = os.getenv("VITALIS_ML_PREDICTOR", "").strip()
    if dotted:
        if dotted.lower() == "mock":
            _predictor = MockRiskPredictor()
            return _predictor
        module_name, _, class_name = dotted.rpartition(".")
        if not module_name:
            raise RuntimeError(f"VITALIS_ML_PREDICTOR must be dotted path, got {dotted!r}")
        import importlib
        cls = getattr(importlib.import_module(module_name), class_name)
        _predictor = cls()
    else:
        # Default to TrainedRiskPredictor
        try:
            _predictor = TrainedRiskPredictor()
        except Exception as e:
            if os.getenv("DEMO_MODE", "true").lower() == "true":
                import logging
                logging.getLogger("vitalis").error(f"Failed to load ML model: {e}. Falling back to MockRiskPredictor.")
                _predictor = MockRiskPredictor()
            else:
                raise RuntimeError(f"Failed to load ML model in production mode: {e}") from e
            
    return _predictor


def reset_predictor() -> None:
    """Test hook: clear the cached predictor so env changes take effect."""
    global _predictor
    _predictor = None

