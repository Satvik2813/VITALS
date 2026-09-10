"""VITALIS prototype inference. Load only artifacts you trust; no clinical validation."""
import json
import warnings
from collections.abc import Mapping
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

_MODEL = None
_METADATA = None


def configure_vitalis(model, metadata):
    global _MODEL, _METADATA
    classes = np.asarray(model.classes_)
    expected = np.arange(len(metadata["class_names"]))
    if not np.array_equal(classes, expected):
        raise ValueError("Estimator class order does not match saved metadata.")
    if list(model.feature_names_in_) != metadata["feature_list"]:
        raise ValueError("Estimator inputs do not match saved feature schema.")
    _MODEL, _METADATA = model, metadata


def load_vitalis_model(artifact_dir=None):
    directory = Path(artifact_dir) if artifact_dir is not None else Path(__file__).resolve().parent
    metadata = json.loads((directory / "vitalis_model_metadata.json").read_text(encoding="utf-8"))
    model = joblib.load(directory / "vitalis_risk_model.joblib")
    configure_vitalis(model, metadata)
    return model, metadata


def prepare_patient(patient_data, metadata):
    if not isinstance(patient_data, Mapping):
        raise TypeError("patient_data must be a dictionary containing the 16 named inputs.")
    features = metadata["feature_list"]
    missing = sorted(set(features) - set(patient_data))
    extra = sorted(str(k) for k in set(patient_data) - set(features))
    if missing or extra:
        raise ValueError(f"Input schema mismatch. Missing: {missing}; unexpected: {extra}")
    cleaned = {}
    for feature in features:
        value = patient_data[feature]
        if value is None:
            cleaned[feature] = np.nan
            warnings.warn(f"{feature} is missing; training-fitted imputation will be used.", stacklevel=2)
            continue
        if feature in metadata["numeric_features"]:
            if isinstance(value, (bool, list, dict, tuple)):
                raise ValueError(f"{feature} must be a finite number or None.")
            try:
                value = float(value)
            except (ValueError, TypeError) as exc:
                raise ValueError(f"{feature} must be numeric or None.") from exc
            if not np.isfinite(value):
                raise ValueError(f"{feature} must be finite; use None for a missing observation.")
            limits = metadata["training_numeric_ranges"][feature]
            if limits["min"] is not None and not limits["min"] <= value <= limits["max"]:
                warnings.warn(f"{feature}={value:g} is outside training support [{limits['min']}, {limits['max']}]; retained unchanged.", stacklevel=2)
        else:
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{feature} must be a nonempty category string or None.")
            value = value.strip()
            if value not in metadata["categorical_values"][feature]:
                warnings.warn(f"Unseen category {feature}={value!r}; one-hot encoder will ignore the unknown category.", stacklevel=2)
        cleaned[feature] = value
    # Broad structural constraints only, never clinical cutoffs.
    positive_fields = ["heart_rate", "resting_heart_rate", "systolic_bp", "diastolic_bp",
                       "baseline_systolic_bp", "baseline_diastolic_bp"]
    for feature in positive_fields:
        if pd.notna(cleaned[feature]) and cleaned[feature] <= 0:
            raise ValueError(f"{feature} must be positive.")
    for feature, low, high in [("spo2", 0, 100), ("sleep_duration_hours", 0, 24)]:
        if pd.notna(cleaned[feature]) and not low <= cleaned[feature] <= high:
            raise ValueError(f"{feature} must be within [{low}, {high}]; check units.")
    for feature in ["age", "daily_steps"]:
        if pd.notna(cleaned[feature]) and cleaned[feature] < 0:
            raise ValueError(f"{feature} cannot be negative.")
    return pd.DataFrame([cleaned], columns=features)


def predict_vitalis_risk(patient_data, *, model=None, metadata=None):
    if (model is None) != (metadata is None):
        raise ValueError("Pass both model and metadata, or neither.")
    if model is None:
        model, metadata = _MODEL, _METADATA
    if model is None:
        raise RuntimeError("Call load_vitalis_model() or configure_vitalis() before inference.")
    frame = prepare_patient(patient_data, metadata)
    probabilities = np.asarray(model.predict_proba(frame), dtype=float)[0]
    names = metadata["class_names"]
    if probabilities.shape != (len(names),) or not np.isfinite(probabilities).all():
        raise RuntimeError("Estimator returned invalid probabilities.")
    if (probabilities < 0).any() or (probabilities > 1).any() or not np.isclose(probabilities.sum(), 1, atol=1e-6):
        raise RuntimeError("Estimator probabilities must sum to one.")
    winner = int(np.argmax(probabilities))
    return {"risk_level": names[winner], "confidence": float(probabilities[winner]),
            "probabilities": {name: float(p) for name, p in zip(names, probabilities)}}
