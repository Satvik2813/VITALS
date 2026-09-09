from datetime import datetime, timedelta, timezone

import pytest

from app.clinical import assess, fresh_engine, news2
from app.models import Reading


def reading(step=0, **changes):
    return Reading(
        patient_id="p1",
        timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=step),
        **{
            **dict(
                heart_rate=76,
                spo2=97,
                respiratory_rate=16,
                temperature=36.8,
                systolic_bp=124,
                consciousness="A",
                supplemental_oxygen=False,
            ),
            **changes,
        },
    )


@pytest.mark.parametrize(
    "key,values",
    [
        ("respiratory_rate", [(8, 3), (9, 1), (11, 1), (12, 0), (20, 0), (21, 2), (24, 2), (25, 3)]),
        ("spo2", [(91, 3), (92, 2), (93, 2), (94, 1), (95, 1), (96, 0)]),
        (
            "heart_rate",
            [(40, 3), (41, 1), (50, 1), (51, 0), (90, 0), (91, 1), (110, 1), (111, 2), (130, 2), (131, 3)],
        ),
        ("systolic_bp", [(90, 3), (91, 2), (100, 2), (101, 1), (110, 1), (111, 0), (219, 0), (220, 3)]),
        ("temperature", [(35, 3), (35.1, 1), (36, 1), (36.1, 0), (38, 0), (38.1, 1), (39, 1), (39.1, 2)]),
    ],
)
def test_all_news2_boundaries(key, values):
    for value, score in values:
        assert news2(reading(**{key: value}).model_dump())[key] == score


def test_oxygen_and_consciousness():
    for state in "CVPU":
        components = news2(reading(consciousness=state, supplemental_oxygen=True).model_dump())
        assert components["consciousness"] == 3 and components["oxygen"] == 2


def test_emergency_bypasses_persistence():
    engine = fresh_engine()
    result = assess(engine, reading(spo2=89, respiratory_rate=28, heart_rate=112))
    assert result["state"] == "CRITICAL" and result["news2_score"] == 8
    assert assess(fresh_engine(), reading(spo2=91))["state"] == "WARNING"
    assert assess(fresh_engine(), reading(spo2=93, respiratory_rate=22, heart_rate=100))["state"] == "WARNING"


def test_noise_hysteresis_and_frozen_baseline():
    engine = fresh_engine()
    for i in range(30):
        assess(engine, reading(i))
    baseline = list(engine["baseline_samples"])
    assert assess(engine, reading(30, heart_rate=103))["state"] == "NORMAL"
    assert engine["baseline_samples"] == baseline
    assert assess(engine, reading(31))["state"] == "NORMAL"
    for i in range(32, 35):
        result = assess(engine, reading(i, spo2=94))
    assert result["state"] == "WATCH"
    for i in range(35, 39):
        assert assess(engine, reading(i))["state"] == "WATCH"
    assert assess(engine, reading(39))["state"] == "NORMAL"


def test_duplicate_rejected_and_gaps_reset_persistence():
    engine = fresh_engine()
    assess(engine, reading(0, heart_rate=103))
    with pytest.raises(ValueError):
        assess(engine, reading(0))
    assess(engine, reading(1, heart_rate=103))
    assert assess(engine, reading(10, heart_rate=103))["state"] == "NORMAL"


def test_invalid_or_incomplete_vitals():
    with pytest.raises(ValueError):
        reading(temperature=float("nan"))
    with pytest.raises(ValueError):
        reading(temperature=36.05)
    with pytest.raises(ValueError):
        reading(spo2=101)
    data = reading().model_dump()
    data.pop("consciousness")
    with pytest.raises(ValueError):
        Reading(**data)
