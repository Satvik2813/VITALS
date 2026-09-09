import asyncio
import logging
import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from . import database as db
from .models import DemoControl, Reading
from .limits import BodyLimit
from .service import Vitalis

ROOT = Path(__file__).resolve().parents[3]
load_dotenv(ROOT / ".env")
MAX_UPLOAD = 5 * 1024 * 1024
log = logging.getLogger("vitalis")


def create_app(
    database_url: str | None = None, data_dir: Path | None = None, autostart: bool | None = None
) -> FastAPI:
    demo_mode = os.getenv("DEMO_MODE", "true").lower() == "true"
    api_token = os.getenv("API_TOKEN", "")
    if not demo_mode and len(api_token) < 32:
        raise RuntimeError("API_TOKEN of at least 32 characters is required outside local demo mode")
    start = os.getenv("SIMULATOR_AUTOSTART", "true").lower() == "true" if autostart is None else autostart

    @asynccontextmanager
    async def lifespan(app):
        service = Vitalis(
            database_url or os.getenv("DATABASE_URL", f"sqlite:///{ROOT / 'data/vitalis.db'}"),
            data_dir or Path(os.getenv("DATA_DIR", str(ROOT / "data"))),
            start,
        )
        app.state.service = service
        app.state.upload_gate = asyncio.Semaphore(2)

        async def simulate():
            while True:
                await asyncio.sleep(max(0.25, float(os.getenv("SIMULATOR_INTERVAL_SECONDS", "2"))))
                try:
                    await run_in_threadpool(service.tick)
                except Exception:
                    log.exception("Simulator tick failed")
                    with service.lock:
                        service.state["playing"] = False
                        service.state["simulator_error"] = (
                            "Stream paused after a processing error. Review backend logs."
                        )

        task = asyncio.create_task(simulate()) if start else None
        yield
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        service.db.dispose()

    app = FastAPI(
        title="VITALIS",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if demo_mode else None,
        redoc_url=None,
    )
    app.add_middleware(BodyLimit)

    def authorize(request: Request):
        if api_token and secrets.compare_digest(
            request.headers.get("authorization", ""), f"Bearer {api_token}"
        ):
            return
        if (
            demo_mode
            and request.client
            and request.client.host in ("127.0.0.1", "::1", "testclient")
            and request.url.hostname in ("127.0.0.1", "localhost", "testserver")
        ):
            return
        raise HTTPException(401, "Authorization required")

    @app.get("/health")
    def health():
        return {"status": "ok", "product": "VITALIS", "synthetic_only": True}

    @app.get("/api/snapshot", dependencies=[Depends(authorize)])
    def snapshot(request: Request):
        return request.app.state.service.snapshot()

    @app.post("/api/vitals", dependencies=[Depends(authorize)])
    def ingest(reading: Reading, request: Request):
        try:
            return request.app.state.service.ingest(reading)
        except ValueError as error:
            raise HTTPException(409, str(error)) from error

    @app.post("/api/demo", dependencies=[Depends(authorize)])
    def demo(control: DemoControl, request: Request):
        request.app.state.service.control(control.action, control.steps)
        return {"ok": True}

    @app.post("/api/alerts/{alert_id}/acknowledge", dependencies=[Depends(authorize)])
    def acknowledge(alert_id: str, request: Request):
        try:
            request.app.state.service.acknowledge(alert_id)
        except KeyError as error:
            raise HTTPException(404, "Alert not found") from error
        return {"ok": True}

    @app.post("/api/patients/{patient_id}/documents", dependencies=[Depends(authorize)])
    async def upload(patient_id: str, request: Request, file: UploadFile = File(...)):
        if patient_id not in request.app.state.service.state["engines"]:
            raise HTTPException(404, "Patient not found")
        filename = Path((file.filename or "document").replace("\\", "/")).name[:160]
        suffix = Path(filename).suffix.lower()
        if suffix not in (".pdf", ".txt"):
            raise HTTPException(415, "Only PDF and UTF-8 text documents are accepted")
        raw = await file.read(MAX_UPLOAD + 1)
        await file.close()
        if not raw or len(raw) > MAX_UPLOAD:
            raise HTTPException(413, "Document must be between 1 byte and 5 MB")
        if suffix == ".pdf" and not raw.startswith(b"%PDF-"):
            raise HTTPException(415, "File does not have a PDF signature")
        if suffix == ".txt":
            try:
                raw.decode("utf-8")
            except UnicodeDecodeError as error:
                raise HTTPException(415, "Text must be UTF-8") from error
        async with request.app.state.upload_gate:
            return await run_in_threadpool(
                request.app.state.service.upload, patient_id, filename, suffix, raw
            )

    @app.get("/api/documents/{document_id}/original", dependencies=[Depends(authorize)])
    def original(document_id: str, request: Request):
        service = request.app.state.service
        with service.db.connect() as conn:
            row = (
                conn.execute(select(db.documents).where(db.documents.c.id == document_id)).mappings().first()
            )
        if not row:
            raise HTTPException(404, "Document not found")
        return FileResponse(
            row["storage_path"],
            filename=row["filename"],
            media_type="application/octet-stream",
            headers={
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "no-store",
                "Content-Security-Policy": "sandbox",
            },
        )

    @app.get("/api/fixtures/{kind}", dependencies=[Depends(authorize)])
    def fixture(kind: str):
        if kind not in ("attack", "clean"):
            raise HTTPException(404, "Fixture not found")
        path = ROOT / "output/pdf" / f"{kind}-report.pdf"
        if not path.exists():
            raise HTTPException(404, "Run npm run fixtures first")
        return FileResponse(path, media_type="application/pdf", filename=path.name)

    return app


app = create_app()
