"""NEWS2 Scale 1 + explicitly experimental, deterministic prioritization.

Reference: Royal College of Physicians, NEWS2 chart 1 (2017).
Only complete adult Scale 1 observations accepted. Documents never enter this module.
"""

from datetime import datetime
from statistics import median

from .models import LABELS, STATES, VITALS, Reading

FLOORS = {"heart_rate": 3, "spo2": 1, "respiratory_rate": 1, "temperature": 0.2, "systolic_bp": 4}


def news2(v: dict) -> dict[str, int]:
    hr, sp, rr, temp, bp = (v[k] for k in VITALS)
    return {
        "respiratory_rate": 3 if rr <= 8 or rr >= 25 else 1 if rr <= 11 else 2 if rr >= 21 else 0,
        "spo2": 3 if sp <= 91 else 2 if sp <= 93 else 1 if sp <= 95 else 0,
        "systolic_bp": 3 if bp <= 90 or bp >= 220 else 2 if bp <= 100 else 1 if bp <= 110 else 0,
        "heart_rate": 3
        if hr <= 40 or hr >= 131
        else 1
        if hr <= 50 or hr <= 110 and hr >= 91
        else 2
        if hr >= 111
        else 0,
        "temperature": 3
        if temp <= 35
        else 1
        if temp <= 36
        else 2
        if temp >= 39.1
        else 1
        if temp >= 38.1
        else 0,
        "consciousness": 0 if v["consciousness"] == "A" else 3,
        "oxygen": 2 if v["supplemental_oxygen"] else 0,
    }


def naive_signals(v: dict) -> list[str]:
    """One notification per violating parameter per sample, no deduplication."""
    limits = {
        "heart_rate": (50, 100),
        "spo2": (95, 100),
        "respiratory_rate": (12, 20),
        "temperature": (36, 38),
        "systolic_bp": (100, 160),
    }
    return [k for k, (lo, hi) in limits.items() if not lo <= v[k] <= hi] + (
        ["consciousness"] if v["consciousness"] != "A" else []
    )


def fresh_engine() -> dict:
    return {
        "history": [],
        "baseline_samples": [],
        "state": "NORMAL",
        "pending": "NORMAL",
        "pending_count": 0,
        "recovery_count": 0,
    }


def slope(rows: list[dict], key: str) -> float:
    if len(rows) < 3:
        return 0
    origin = datetime.fromisoformat(rows[0]["timestamp"])
    xs = [(datetime.fromisoformat(r["timestamp"]) - origin).total_seconds() / 60 for r in rows]
    xm, ym = sum(xs) / len(xs), sum(r[key] for r in rows) / len(rows)
    denominator = sum((x - xm) ** 2 for x in xs)
    return sum((x - xm) * (r[key] - ym) for x, r in zip(xs, rows)) / denominator if denominator else 0


def assess(engine: dict, reading: Reading) -> dict:
    v = reading.model_dump(mode="json")
    history = engine["history"]
    if history and reading.timestamp <= datetime.fromisoformat(history[-1]["timestamp"]):
        raise ValueError("Duplicate or out-of-order observation")
    # Never bridge a missing-data gap with a persistence/trend window.
    if (
        history
        and (reading.timestamp - datetime.fromisoformat(history[-1]["timestamp"])).total_seconds() > 180
    ):
        history.clear()
        engine.update(pending_count=0, recovery_count=0)
    components = news2(v)
    total = sum(components.values())
    reference = engine["baseline_samples"]
    baseline = {}
    for key in VITALS:
        values = [r[key] for r in reference]
        center = median(values) if values else v[key]
        spread = (
            max(1.4826 * median([abs(x - center) for x in values]), FLOORS[key]) if values else FLOORS[key]
        )
        baseline[key] = {
            "value": round(center, 2),
            "spread": round(spread, 2),
            "z": round((v[key] - center) / spread, 2),
            "samples": len(values),
        }
    unusual = [k for k in VITALS if abs(baseline[k]["z"]) >= 3 and len(reference) >= 10]
    history.append(v)
    engine["history"] = history[-60:]
    recent = history[-10:]
    trends = {k: round(slope(recent, k), 3) for k in VITALS}
    minutes = round(
        (reading.timestamp - datetime.fromisoformat(recent[0]["timestamp"])).total_seconds() / 60, 1
    )
    # Published aggregate/single-parameter triggers always bypass experimental persistence.
    immediate = "CRITICAL" if total >= 7 else "WARNING" if total >= 5 or 3 in components.values() else None
    candidate = immediate or (
        "WARNING" if len(unusual) >= 3 else "WATCH" if total > 0 or len(unusual) >= 2 else "NORMAL"
    )
    previous = engine["state"]
    if candidate == engine["pending"]:
        engine["pending_count"] += 1
    else:
        engine.update(pending=candidate, pending_count=1)
    if STATES.index(candidate) > STATES.index(previous):
        engine["recovery_count"] = 0
        if immediate or engine["pending_count"] >= 3:
            engine["state"] = candidate
    elif STATES.index(candidate) < STATES.index(previous):
        engine["recovery_count"] += 1
        if engine["recovery_count"] >= 5:
            engine["state"] = candidate
            engine["recovery_count"] = 0
    else:
        engine["recovery_count"] = 0
    # Freeze adaptation at the first abnormal candidate, before the alert is confirmed.
    if total == 0 and not unusual and candidate == "NORMAL" and previous == "NORMAL":
        engine["baseline_samples"] = (reference + [v])[-30:]
    factors = []
    for key, points in components.items():
        if points:
            factors.append(
                {
                    "kind": "news2",
                    "vital": key,
                    "points": points,
                    "text": f"{LABELS[key]} contributes {points} NEWS2 point{'s' if points != 1 else ''}.",
                }
            )
    for key in unusual:
        factors.append(
            {
                "kind": "baseline",
                "vital": key,
                "baseline": baseline[key]["value"],
                "current": v[key],
                "robust_z": baseline[key]["z"],
                "text": f"{LABELS[key]}: baseline {baseline[key]['value']:g} → current {v[key]:g} ({abs(baseline[key]['z']):g} robust deviations).",
            }
        )
    for key, threshold, direction in [
        ("spo2", -0.12, "falling"),
        ("heart_rate", 0.3, "rising"),
        ("respiratory_rate", 0.12, "rising"),
    ]:
        matches = trends[key] <= threshold if threshold < 0 else trends[key] >= threshold
        if minutes >= 3 and matches:
            factors.append(
                {
                    "kind": "trend",
                    "vital": key,
                    "slope": trends[key],
                    "window_minutes": minutes,
                    "text": f"{LABELS[key]} {direction} across a {minutes:g}-minute window ({trends[key]:+.2f}/min).",
                }
            )
    if engine["pending_count"] >= 3 and len(unusual) >= 2:
        factors.append(
            {
                "kind": "persistence",
                "samples": engine["pending_count"],
                "text": f"Multivariate deviation persists across {engine['pending_count']} consecutive observations.",
            }
        )
    if STATES.index(candidate) < STATES.index(engine["state"]):
        factors.append(
            {
                "kind": "hysteresis",
                "text": f"Recovery confirmation: {engine['recovery_count']}/5 observations. Previous attention state retained.",
            }
        )
    return {
        "news2_score": total,
        "components": components,
        "state": engine["state"],
        "previous_state": previous,
        "candidate": candidate,
        "baseline": baseline,
        "trends": trends,
        "factors": factors,
        "timestamp": v["timestamp"],
        "baseline_ready": len(reference) >= 10,
        "escalated": STATES.index(engine["state"]) > STATES.index(previous),
        "rule": "Immediate NEWS2 trigger" if immediate else "Experimental persistence / personalization",
    }
