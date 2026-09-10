import copy
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy import insert, select, update

from . import database as db
from .audit import redact_metadata
from .clinical import assess, fresh_engine, naive_signals
from .gateway import analyze, digest, extract_facts, parse_file
from .models import STATES, Reading
from .simulation import PROFILES, sample


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def uid() -> str:
    return str(uuid4())


class Vitalis:
    def __init__(self, url: str, data_dir: Path, autostart: bool = True):
        self.db = db.connect(url)
        self.data_dir = data_dir
        (data_dir / "originals").mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.state = {}
        self.storage = "SQLite local" if url.startswith("sqlite") else "PostgreSQL"
        with self.db.begin() as conn:
            for profile in PROFILES:
                if not conn.execute(
                    select(db.patients.c.id).where(db.patients.c.id == profile["id"])
                ).first():
                    conn.execute(
                        insert(db.patients).values(id=profile["id"], name=profile["name"], profile=profile)
                    )
            active = conn.execute(select(db.runs).where(db.runs.c.active.is_(True))).mappings().first()
            if active:
                self.state = active["checkpoint"]
        if not self.state:
            self.reset(autostart)
        elif not autostart:
            with self.transaction():
                self.state["playing"] = False

    @contextmanager
    def transaction(self):
        with self.lock:
            previous = copy.deepcopy(self.state)
            try:
                with self.db.begin() as conn:
                    yield conn
                    conn.execute(
                        update(db.runs)
                        .where(db.runs.c.id == self.state["run_id"])
                        .values(checkpoint=self.state)
                    )
            except Exception:
                self.state = previous
                raise

    def event(self, conn, event_type: str, patient_id: str | None, details: dict, actor: str = "VITALIS"):
        conn.execute(
            insert(db.audit).values(
                id=uid(),
                run_id=self.state["run_id"],
                patient_id=patient_id,
                event_type=event_type,
                actor=actor,
                details=redact_metadata({"outcome": "success", **details}),
                created_at=now(),
            )
        )

    def reset(self, playing: bool = True):
        with self.transaction() as conn:
            conn.execute(update(db.runs).where(db.runs.c.active.is_(True)).values(active=False))
            self.state = {
                "run_id": uid(),
                "start": now(),
                "step": 0,
                "attack_start": None,
                "playing": playing,
                "engines": {p["id"]: fresh_engine() for p in PROFILES},
                "latest": {},
                "naive": 0,
                "naive_samples": 0,
                "actionable": 0,
                "samples": 0,
                "false_positive_events": 0,
                "episode_detected_step": None,
                "latencies": [],
                "metric_history": [],
                "blocked": {},
                "last_ingested_at": now(),
                "simulator_error": None,
            }
            conn.execute(
                insert(db.runs).values(id=self.state["run_id"], active=True, created_at=now(), checkpoint={})
            )
            for step in range(-30, 0):
                for profile in PROFILES:
                    self.ingest_one(conn, sample(profile, step, self.state["start"], None), count=False)
            self.event(
                conn,
                "DEMO_RUN_STARTED",
                None,
                {
                    "message": "New synthetic run. Previous records and originals retained.",
                    "baseline_samples": 30,
                },
            )

    def ingest_one(self, conn, reading: Reading, count: bool = True):
        started = time.perf_counter()
        pid = reading.patient_id
        risk = assess(self.state["engines"][pid], reading)
        reading_id = uid()
        conn.execute(
            insert(db.readings).values(
                id=reading_id,
                run_id=self.state["run_id"],
                patient_id=pid,
                timestamp=reading.timestamp.isoformat(),
                payload=reading.model_dump(mode="json"),
            )
        )
        conn.execute(
            insert(db.assessments).values(
                id=uid(),
                reading_id=reading_id,
                news2_score=risk["news2_score"],
                attention_state=risk["state"],
                payload=risk,
            )
        )
        baseline_id = f"{self.state['run_id']}:{pid}"
        changed = conn.execute(
            update(db.baselines).where(db.baselines.c.id == baseline_id).values(payload=risk["baseline"])
        )
        if not changed.rowcount:
            conn.execute(
                insert(db.baselines).values(
                    id=baseline_id, run_id=self.state["run_id"], patient_id=pid, payload=risk["baseline"]
                )
            )
        self.state["latest"][pid] = {
            "vitals": reading.model_dump(mode="json"),
            "risk": risk,
            "received_at": now(),
        }
        self.state["last_ingested_at"] = now()
        if count:
            signals = naive_signals(reading.model_dump())
            self.state["naive"] += len(signals)
            self.state["naive_samples"] += bool(signals)
            self.state["samples"] += 1
            if risk["escalated"]:
                self.state["actionable"] += 1
                self.state["false_positive_events"] += pid != "p1" or self.state["attack_start"] is None
                conn.execute(
                    insert(db.alerts).values(
                        id=uid(),
                        run_id=self.state["run_id"],
                        patient_id=pid,
                        severity=risk["state"],
                        created_at=now(),
                        payload=risk,
                    )
                )
                self.event(
                    conn,
                    "CLINICAL_ESCALATION",
                    pid,
                    {
                        "message": f"{risk['previous_state']} → {risk['state']}",
                        "news2": risk["news2_score"],
                        "factors": risk["factors"],
                    },
                )
                if pid in self.state["blocked"]:
                    self.conflict(conn, pid, self.state["blocked"][pid], risk)
            if (
                pid == "p1"
                and self.state["attack_start"] is not None
                and risk["state"] in ("WARNING", "CRITICAL")
                and self.state["episode_detected_step"] is None
            ):
                self.state["episode_detected_step"] = self.state["step"]
            self.state["latencies"] = (self.state["latencies"] + [(time.perf_counter() - started) * 1000])[
                -200:
            ]
        return risk

    def ingest(self, reading: Reading):
        with self.transaction() as conn:
            result = self.ingest_one(conn, reading)
            self.event(conn, "VITALS_INGESTED", reading.patient_id,
                       {"recorded_at": reading.timestamp.isoformat(), "source": "api"})
            return result

    def tick(self, force: bool = False):
        with self.transaction() as conn:
            if not self.state["playing"] and not force:
                return
            for profile in PROFILES:
                self.ingest_one(
                    conn, sample(profile, self.state["step"], self.state["start"], self.state["attack_start"])
                )
            self.state["metric_history"] = (
                self.state["metric_history"]
                + [
                    {
                        "minute": self.state["step"],
                        "naive": self.state["naive"],
                        "vitalis": self.state["actionable"],
                    }
                ]
            )[-90:]
            self.state["step"] += 1
            self.state["simulator_error"] = None

    def control(self, action: str, steps: int = 1):
        if action == "reset":
            self.reset()
        elif action == "advance":
            for _ in range(steps):
                self.tick(force=True)
        else:
            with self.transaction() as conn:
                if action == "deteriorate" and self.state["attack_start"] is None:
                    self.state["attack_start"] = self.state["step"]
                    self.state["playing"] = True
                    self.event(
                        conn,
                        "SCENARIO_STARTED",
                        "p1",
                        {
                            "message": "Synthetic multivariate deterioration started",
                            "onset_minute": self.state["step"],
                        },
                        "demo operator",
                    )
                elif action in ("play", "pause"):
                    self.state["playing"] = action == "play"

    def conflict(self, conn, patient_id: str, doc_id: str, risk: dict):
        self.event(
            conn,
            "TRUST_CONFLICT",
            patient_id,
            {
                "message": "Untrusted document excluded from active clinical interpretation.",
                "document_id": doc_id,
                "physiological_state": risk["state"],
                "news2": risk["news2_score"],
            },
        )
        self.event(
            conn,
            "CLINICAL_ALERT_PRESERVED",
            patient_id,
            {
                "message": f"{risk['state']} attention state preserved. Document has no authority over physiological scoring.",
                "document_id": doc_id,
                "state_before": risk["state"],
                "state_after": risk["state"],
            },
        )

    def upload(self, patient_id: str, filename: str, suffix: str, raw: bytes):
        doc_id = uid()
        path = (self.data_dir / "originals" / f"{doc_id}{suffix}").resolve()
        # Exclusive creation; original bytes are never rewritten by scan or replay.
        with path.open("xb") as file:
            file.write(raw)
        parsed = parse_file(path, suffix)
        result = analyze(parsed["text"], parsed["signals"])
        extracted = extract_facts(parsed["text"], doc_id, result["verdict"])
        uploaded_at = now()
        with self.transaction() as conn:
            risk = copy.deepcopy(self.state["latest"][patient_id]["risk"])
            conn.execute(
                insert(db.documents).values(
                    id=doc_id,
                    patient_id=patient_id,
                    run_id=self.state["run_id"],
                    filename=filename,
                    storage_path=str(path),
                    sha256=digest(raw),
                    uploaded_at=uploaded_at,
                    size_bytes=len(raw),
                )
            )
            self.event(
                conn,
                "DOCUMENT_UPLOADED",
                patient_id,
                {"message": f"Original preserved: {filename}", "document_id": doc_id, "sha256": digest(raw)},
                "doctor",
            )
            conn.execute(insert(db.raw_text).values(document_id=doc_id, text=parsed["text"]))
            conn.execute(
                insert(db.scans).values(
                    document_id=doc_id, verdict=result["verdict"], payload=result, scanned_at=now()
                )
            )
            self.event(
                conn,
                "SCAN_COMPLETED",
                patient_id,
                {
                    "message": f"Gateway verdict: {result['verdict']}",
                    "document_id": doc_id,
                    "signals": len(result["signals"]),
                },
            )
            for signal in result["signals"]:
                self.event(
                    conn,
                    "SECURITY_SIGNAL",
                    patient_id,
                    {"message": signal["reason"], "document_id": doc_id, "code": signal["code"]},
                )
            for fact in extracted:
                conn.execute(insert(db.facts).values(id=uid(), document_id=doc_id, **fact))
            if result["quarantined"]:
                self.state["blocked"][patient_id] = doc_id
                self.event(
                    conn,
                    "DOCUMENT_QUARANTINED",
                    patient_id,
                    {
                        "message": "All document content excluded from clinical context. Original retained.",
                        "document_id": doc_id,
                    },
                )
                if risk["state"] != "NORMAL":
                    self.conflict(conn, patient_id, doc_id, risk)
            self.event(
                conn,
                "CONTEXT_PROTECTED",
                patient_id,
                {
                    "message": f"{len(extracted)} numeric facts retained with provenance; {'none admitted from quarantined document' if result['quarantined'] else 'screened facts admitted as unverified historical data'}. Physiological assessment unchanged.",
                    "document_id": doc_id,
                },
            )
        return {
            "id": doc_id,
            "filename": filename,
            "uploaded_at": uploaded_at,
            "sha256": digest(raw),
            "scan": result,
            "facts": extracted,
            "state_before": risk["state"],
            "state_after": risk["state"],
        }

    def document_list(self, conn, patient_id: str | None = None) -> list[dict]:
        query = (
            select(db.documents, db.scans.c.payload.label("scan"))
            .join(db.scans)
            .where(db.documents.c.run_id == self.state["run_id"])
        )
        if patient_id:
            query = query.where(db.documents.c.patient_id == patient_id)
        rows = [dict(r) for r in conn.execute(query.order_by(db.documents.c.uploaded_at.desc())).mappings()]
        for row in rows:
            row.pop("storage_path")
            row["facts"] = [
                dict(r)
                for r in conn.execute(select(db.facts).where(db.facts.c.document_id == row["id"])).mappings()
            ]
        return rows

    def snapshot(self) -> dict:
        with self.lock, self.db.connect() as conn:
            s = self.state
            docs = self.document_list(conn)
            events = [
                dict(r)
                for r in conn.execute(
                    select(db.audit)
                    .where(db.audit.c.run_id == s["run_id"])
                    .order_by(db.audit.c.created_at.desc())
                    .limit(200)
                ).mappings()
            ]
            alert_rows = [
                dict(r)
                for r in conn.execute(
                    select(db.alerts)
                    .where(db.alerts.c.run_id == s["run_id"])
                    .order_by(db.alerts.c.created_at.desc())
                ).mappings()
            ]
            queue = []
            for profile in PROFILES:
                pid = profile["id"]
                latest = s["latest"][pid]
                patient_docs = [d for d in docs if d["patient_id"] == pid]
                # Security invariant: no raw text or arbitrary string fact values in clinical context.
                admitted = [
                    f
                    for d in patient_docs
                    if d["scan"]["verdict"] == "TRUSTED"
                    for f in d["facts"]
                    if f["trust_status"] == "SCREENED"
                ]
                conflict = pid in s["blocked"] and latest["risk"]["state"] != "NORMAL"
                queue.append(
                    {
                        **{k: v for k, v in profile.items() if k != "base"},
                        **latest,
                        "history": s["engines"][pid]["history"],
                        "trust_conflict": conflict,
                        "documents": patient_docs,
                        "context": {
                            "physiological_assessment": latest["risk"],
                            "screened_historical_facts": admitted,
                            "excluded_documents": sum(d["scan"]["quarantined"] for d in patient_docs),
                            "policy": "Live physiology authoritative for scoring. Historical facts unverified; never modify score or alert.",
                        },
                    }
                )
            queue.sort(key=lambda p: (-STATES.index(p["risk"]["state"]), -p["risk"]["news2_score"], p["id"]))
            latency = sorted(s["latencies"])
            detection = s["episode_detected_step"]
            return copy.deepcopy(
                {
                    "patients": queue,
                    "alerts": alert_rows,
                    "documents": docs,
                    "audit": events,
                    "demo": {
                        "run_id": s["run_id"],
                        "minute": s["step"],
                        "playing": s["playing"],
                        "deteriorating": s["attack_start"] is not None,
                        "last_ingested_at": s["last_ingested_at"],
                        "storage": self.storage,
                        "error": s["simulator_error"],
                    },
                    "metrics": {
                        "raw_threshold_alerts": s["naive"],
                        "naive_alerting_samples": s["naive_samples"],
                        "actionable_alerts": s["actionable"],
                        "reduction_pct": round(100 * (1 - s["actionable"] / s["naive"]), 1)
                        if s["naive"]
                        else 0,
                        "samples": s["samples"],
                        "known_episodes": int(s["attack_start"] is not None),
                        "episodes_detected": int(detection is not None),
                        "detection_delay_minutes": detection - s["attack_start"]
                        if detection is not None
                        else None,
                        "false_positive_events": s["false_positive_events"],
                        "processing_p95_ms": round(
                            latency[min(len(latency) - 1, int(len(latency) * 0.95))], 2
                        )
                        if latency
                        else 0,
                        "history": s["metric_history"],
                    },
                }
            )

    def acknowledge(self, alert_id: str):
        with self.transaction() as conn:
            alert = (
                conn.execute(
                    select(db.alerts).where(
                        db.alerts.c.id == alert_id, db.alerts.c.run_id == self.state["run_id"]
                    )
                )
                .mappings()
                .first()
            )
            if not alert:
                raise KeyError(alert_id)
            if not alert["acknowledged_at"]:
                conn.execute(
                    update(db.alerts).where(db.alerts.c.id == alert_id).values(acknowledged_at=now())
                )
                self.event(
                    conn,
                    "ALERT_ACKNOWLEDGED",
                    alert["patient_id"],
                    {
                        "message": "Doctor acknowledged alert. Physiological state unchanged.",
                        "alert_id": alert_id,
                    },
                    "doctor",
                )
