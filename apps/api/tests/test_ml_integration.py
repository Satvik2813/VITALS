import pytest
from datetime import datetime, timezone
from app.ml import (
    CANONICAL_STATES,
    MODEL_STATE_MAP,
    TrainedRiskPredictor,
    VitalsFeatures,
    canonical_state,
    get_predictor,
)

def test_model_loads_successfully():
    predictor = get_predictor()
    assert isinstance(predictor, TrainedRiskPredictor)
    assert predictor.model is not None
    assert predictor.model_version is not None

def test_stable_demo_input():
    predictor = get_predictor()
    features = VitalsFeatures(
        patient_id="p1",
        recorded_at=datetime.now(timezone.utc),
        heart_rate=70,
        spo2=98,
        respiratory_rate=16,
        temperature_c=36.5,
        systolic_bp=120,
        diastolic_bp=80,
        consciousness="A",
        supplemental_oxygen=False,
        sleep_duration_hours=8,
        quality_of_sleep=8.0,
        physical_activity_level=75.0,
        daily_steps=8000,
        resting_heart_rate=65,
        baseline_systolic_bp=118,
        baseline_diastolic_bp=78,
        age=45,
        bmi_category="Normal",
        stress_level=3.0,
        gender="Male"
    )
    result = predictor.predict(features)
    # The trained model reports its own vocabulary ("Stable"); the application
    # persists and renders only the four canonical states.
    assert result.state == "NORMAL"
    assert result.state in CANONICAL_STATES
    assert result.features["raw_model_state"] == "Stable"
    assert result.is_mock is False

def test_critical_input_overrides():
    predictor = get_predictor()
    features = VitalsFeatures(
        patient_id="p1",
        recorded_at=datetime.now(timezone.utc),
        heart_rate=140, # HIGH
        spo2=85, # CRITICAL
        respiratory_rate=30, # CRITICAL
        temperature_c=39.5,
        systolic_bp=80,
        consciousness="U",
        supplemental_oxygen=True
    )
    result = predictor.predict(features)
    assert result.state == "CRITICAL"
    assert result.state in CANONICAL_STATES

def test_invalid_categorical_value():
    predictor = get_predictor()
    features = VitalsFeatures(
        patient_id="p1",
        recorded_at=datetime.now(timezone.utc),
        heart_rate=70,
        spo2=98,
        respiratory_rate=16,
        temperature_c=36.5,
        systolic_bp=120,
        consciousness="A",
        supplemental_oxygen=False,
        bmi_category="NOT_A_CATEGORY"
    )
    # The VITALIS_ENGINE code emits a warning for invalid category but handles it.
    with pytest.warns(UserWarning, match="Unseen category"):
        result = predictor.predict(features)
    assert result.is_mock is False

def test_missing_features_fallback():
    predictor = get_predictor()
    # No extra features provided (like age, gender, stress_level)
    features = VitalsFeatures(
        patient_id="p1",
        recorded_at=datetime.now(timezone.utc),
        heart_rate=70,
        spo2=98,
        respiratory_rate=16,
        temperature_c=36.5,
        systolic_bp=120,
        consciousness="A",
        supplemental_oxygen=False
    )
    with pytest.warns(UserWarning):
        result = predictor.predict(features)
    assert result.is_mock is False


def test_every_predicted_state_is_canonical():
    """No predictor output may escape the four canonical states.

    `app_risk_assessments.state` has a CHECK constraint on exactly these four
    values, so a non-canonical state is a 500 on every ingestion in
    production (and SQLite would not catch it).
    """
    predictor = get_predictor()
    for hr, spo2, rr, temp, sbp, loc, o2 in [
        (70, 98, 16, 36.5, 120, "A", False),
        (105, 94, 22, 38.2, 105, "A", False),
        (130, 90, 26, 39.0, 95, "V", True),
        (140, 85, 30, 39.5, 80, "U", True),
    ]:
        result = predictor.predict(VitalsFeatures(
            patient_id="p1", recorded_at=datetime.now(timezone.utc),
            heart_rate=hr, spo2=spo2, respiratory_rate=rr, temperature_c=temp,
            systolic_bp=sbp, consciousness=loc, supplemental_oxygen=o2,
        ))
        assert result.state in CANONICAL_STATES, result.state


def test_model_vocabulary_is_fully_mapped():
    """Every class the shipped model can emit has a canonical translation."""
    predictor = get_predictor()
    for name in predictor.metadata["class_names"]:
        assert name in MODEL_STATE_MAP, name
        assert MODEL_STATE_MAP[name] in CANONICAL_STATES


@pytest.mark.parametrize("raw,expected", [
    ("Stable", "NORMAL"),
    ("Watch", "WATCH"),
    ("Moderate", "WARNING"),
    ("High", "WARNING"),
    ("Critical", "CRITICAL"),
    ("NORMAL", "NORMAL"),
    ("CRITICAL", "CRITICAL"),
    ("stable", "NORMAL"),
    ("critical", "CRITICAL"),
])
def test_canonical_state_mapping(raw, expected):
    state, mapped = canonical_state(raw)
    assert (state, mapped) == (expected, True)


@pytest.mark.parametrize("raw", [None, "", "Elevated", "banana", 7, "  "])
def test_unknown_state_falls_back_to_watch_and_is_flagged(raw):
    """Unknown labels must be storable and must not read as healthy."""
    state, mapped = canonical_state(raw)
    assert state == "WATCH"
    assert mapped is False
    assert state in CANONICAL_STATES
