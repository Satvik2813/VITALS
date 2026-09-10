"""ML boundary tests: interface stability + swappability."""

from __future__ import annotations

from datetime import datetime, timezone

from app import ml


def _feat(**over):
    base = dict(
        patient_id="p", recorded_at=datetime.now(timezone.utc),
        heart_rate=72, spo2=98, respiratory_rate=14, temperature_c=36.7,
        systolic_bp=120, consciousness="A", supplemental_oxygen=False,
    )
    base.update(over)
    return ml.VitalsFeatures(**base)


def test_mock_predictor_normal(monkeypatch):
    monkeypatch.setenv("VITALIS_ML_PREDICTOR", "mock")
    ml.reset_predictor()
    r = ml.get_predictor().predict(_feat())
    assert r.state == "NORMAL"
    assert r.is_mock is True
    assert r.model_version.startswith("mock-")


def test_mock_predictor_critical():
    r = ml.MockRiskPredictor().predict(_feat(spo2=84, respiratory_rate=32, systolic_bp=80,
                                             consciousness="V"))
    assert r.state == "CRITICAL"


def test_predictor_is_swappable(monkeypatch):
    """A real model replaces the predictor via VITALIS_ML_PREDICTOR alone."""

    class _Fixed:
        model_version = "unit-test-v1"

        def predict(self, features):
            return ml.RiskResult(
                model_version=self.model_version, score=0.5, state="WATCH",
                features={}, is_mock=False, computed_at=datetime.now(timezone.utc),
            )

    # Register the class so the dotted-path loader can import it.
    import sys
    import types
    fake = types.ModuleType("_fake_ml_mod")
    fake._Fixed = _Fixed
    sys.modules["_fake_ml_mod"] = fake
    monkeypatch.setenv("VITALIS_ML_PREDICTOR", "_fake_ml_mod._Fixed")
    ml.reset_predictor()
    r = ml.get_predictor().predict(_feat())
    assert r.model_version == "unit-test-v1"
    assert r.is_mock is False
    ml.reset_predictor()
