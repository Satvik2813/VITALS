import asyncio
import logging
import os
import secrets
import unicodedata
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from . import database as db
from . import db_platform
from .api_v1.router import router as api_v1_router
from .models import DemoControl, Reading
from .limits import BodyLimit
from .security import SecurityControls, cors_origins
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
    platform_database_url = os.getenv("PLATFORM_DATABASE_URL", "")
    if not demo_mode and not platform_database_url:
        # Outside local demo mode, the v1 authenticated platform API must never
        # silently fall back to the legacy synthetic DATABASE_URL (SQLite demo
        # store) -- that would serve real onboarding/patient data against the
        # wrong, non-production database. See docs/DATABASE.md.
        raise RuntimeError(
            "PLATFORM_DATABASE_URL is required outside local demo mode; it must "
            "not silently fall back to DATABASE_URL"
        )
    start = os.getenv("SIMULATOR_AUTOSTART", "true").lower() == "true" if autostart is None else autostart

    @asynccontextmanager
    async def lifespan(app):
        resolved_db_url = database_url or os.getenv(
            "DATABASE_URL", f"sqlite:///{ROOT / 'data/vitalis.db'}"
        )
        service = Vitalis(
            resolved_db_url,
            data_dir or Path(os.getenv("DATA_DIR", str(ROOT / "data"))),
            start,
        )
        app.state.service = service
        app.state.upload_gate = asyncio.Semaphore(2)
        # Platform engine (v1 authenticated APIs). On SQLite this creates the
        # app_* tables via SQLAlchemy Core; on Postgres they must already exist
        # (applied by supabase/migrations/*_auth_platform.sql). The demo-mode
        # fallback to resolved_db_url is intentional for local dev only; outside
        # demo mode, PLATFORM_DATABASE_URL is required above and never falls back.
        platform_url = platform_database_url or resolved_db_url
        app.state.platform_engine = db_platform.connect(platform_url)

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
        try:
            app.state.platform_engine.dispose()
        except Exception:
            log.exception("Platform engine dispose failed")

    app = FastAPI(
        title="VITALIS",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if demo_mode else None,
        redoc_url=None,
    )
    app.add_middleware(BodyLimit)
    app.add_middleware(SecurityControls)
    app.add_middleware(
        CORSMiddleware, allow_origins=cors_origins(demo_mode), allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"], expose_headers=["Retry-After"],
    )
    app.include_router(api_v1_router)

    @app.exception_handler(RequestValidationError)
    async def _invalid_request(request: Request, exc: RequestValidationError):
        from fastapi.responses import JSONResponse
        # Pydantic includes rejected input by default; it may contain credentials/PHI.
        errors = [{"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
        return JSONResponse({"detail": errors}, status_code=422)

    @app.exception_handler(Exception)
    async def _uncaught(request: Request, exc: Exception):
        # Never leak internals to clients; log server-side and return a
        # generic 500. HTTPException instances are handled by FastAPI's own
        # handler and are not routed here.
        log.error("Unhandled API error type=%s method=%s", type(exc).__name__, request.method)
        from fastapi.responses import JSONResponse
        return JSONResponse({"detail": "Internal server error"}, status_code=500,
                            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

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
        """Liveness. Reports ML readiness; never fails because of it.

        Outside demo mode `get_predictor()` raises when the trained model is
        missing or unloadable (e.g. VITALIS_ENGINE not present in the
        deployment artifact). This endpoint is what a host's liveness probe
        polls, so it must answer 200 with an honest `ml_status` rather than
        500 and get the container killed in a restart loop -- while still
        making the degradation impossible to miss.
        """
        from .ml import get_predictor
        try:
            predictor = get_predictor()
        except Exception:
            log.exception("ML predictor unavailable")
            return {
                "status": "degraded",
                "product": "VITALIS",
                "synthetic_only": True,
                "ml_model_loaded": False,
                "ml_model_version": "unavailable",
                "ml_status": "unavailable",
                "detail": "Risk scoring is unavailable. Check the ML engine packaging.",
            }
        is_mock = type(predictor).__name__ == "MockRiskPredictor"
        return {
            "status": "ok",
            "product": "VITALIS",
            "synthetic_only": True,
            "ml_model_loaded": not is_mock,
            "ml_model_version": getattr(predictor, "model_version", "unknown"),
            "ml_status": "mock" if is_mock else "loaded",
        }

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
        filename = "".join(c for c in filename if unicodedata.category(c)[0] != "C")
        suffix = Path(filename).suffix.lower()
        if suffix not in (".pdf", ".txt"):
            raise HTTPException(415, "Only PDF and UTF-8 text documents are accepted")
        allowed_types = {"application/octet-stream", "application/pdf" if suffix == ".pdf" else "text/plain"}
        content_type = (file.content_type or "application/octet-stream").split(";", 1)[0].lower()
        if content_type not in allowed_types:
            raise HTTPException(415, "Content type does not match document extension")
        raw = await file.read(MAX_UPLOAD + 1)
        await file.close()
        if not raw or len(raw) > MAX_UPLOAD:
            raise HTTPException(413, "Document must be between 1 byte and 5 MB")
        if suffix == ".pdf" and not raw.startswith(b"%PDF-"):
            raise HTTPException(415, "File does not have a PDF signature")
        if suffix == ".txt":
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError as error:
                raise HTTPException(415, "Text must be UTF-8") from error
            if raw.startswith(b"%PDF-") or any(ord(c) < 32 and c not in "\r\n\t\f" for c in text):
                raise HTTPException(415, "Text document contains binary content")
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
        original_path = Path(row["storage_path"]).resolve()
        if not original_path.is_relative_to((service.data_dir / "originals").resolve()) or not original_path.is_file():
            raise HTTPException(404, "Document not found")
        return FileResponse(
            original_path,
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
