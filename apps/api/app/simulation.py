import math
from datetime import datetime, timedelta

from .models import Reading

PROFILES = [
    {
        "id": "p1",
        "name": "Arjun Mehta",
        "age": 67,
        "sex": "M",
        "condition": "Post-discharge observation",
        "room": "HOME · 01",
        "initials": "AM",
        "base": [76, 97, 16, 36.8, 124],
    },
    {
        "id": "p2",
        "name": "Eleanor Brooks",
        "age": 72,
        "sex": "F",
        "condition": "Recovery monitoring",
        "room": "HOME · 02",
        "initials": "EB",
        "base": [82, 98, 17, 36.7, 132],
    },
    {
        "id": "p3",
        "name": "Sofia Chen",
        "age": 45,
        "sex": "F",
        "condition": "Post-operative observation",
        "room": "HOME · 03",
        "initials": "SC",
        "base": [72, 98, 15, 36.6, 118],
    },
    {
        "id": "p4",
        "name": "James Wilson",
        "age": 58,
        "sex": "M",
        "condition": "Cardiac follow-up",
        "room": "HOME · 04",
        "initials": "JW",
        "base": [68, 97, 16, 36.5, 128],
    },
    {
        "id": "p5",
        "name": "Priya Sharma",
        "age": 39,
        "sex": "F",
        "condition": "Recovery monitoring",
        "room": "HOME · 05",
        "initials": "PS",
        "base": [78, 99, 14, 36.9, 116],
    },
    {
        "id": "p6",
        "name": "Oliver Grant",
        "age": 64,
        "sex": "M",
        "condition": "Post-discharge observation",
        "room": "HOME · 06",
        "initials": "OG",
        "base": [74, 97, 17, 36.7, 126],
    },
    {
        "id": "p7",
        "name": "Amara Okafor",
        "age": 51,
        "sex": "F",
        "condition": "Respiratory follow-up",
        "room": "HOME · 07",
        "initials": "AO",
        "base": [80, 98, 16, 36.8, 122],
    },
    {
        "id": "p8",
        "name": "Daniel Reyes",
        "age": 61,
        "sex": "M",
        "condition": "Recovery monitoring",
        "room": "HOME · 08",
        "initials": "DR",
        "base": [70, 97, 15, 36.6, 130],
    },
]


def sample(profile: dict, step: int, start: str, attack_start: int | None) -> Reading:
    idx = int(profile["id"][1:])
    hr, sp, rr, temp, bp = profile["base"]
    hr += round(2 * math.sin((step + idx) * 0.8))
    bp += round(2 * math.cos((step + idx) * 0.7))
    temp = round(temp + 0.1 * math.sin(step + idx), 1)
    if step >= 0 and idx != 1:
        # Isolated mild sensor spikes on known non-deteriorating patients.
        if (step + idx * 3) % 7 == 0:
            hr = 103
        if (step + idx * 2) % 11 == 0:
            sp = 94
    if idx == 1 and attack_start is not None and step >= attack_start:
        progress = min(1, (step - attack_start + 1) / 22)
        hr = round(76 + 36 * progress)
        sp = round(97 - 8 * progress)
        rr = round(16 + 12 * progress)
        bp = round(124 - 20 * progress)
        temp = round(36.8 + 0.9 * progress, 1)
    return Reading(
        patient_id=profile["id"],
        timestamp=datetime.fromisoformat(start) + timedelta(minutes=step),
        heart_rate=hr,
        spo2=sp,
        respiratory_rate=rr,
        temperature=temp,
        systolic_bp=bp,
        consciousness="A",
        supplemental_oxygen=False,
    )
