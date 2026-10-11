"""Aaina API entrypoint."""
from __future__ import annotations

import logging
import os
import time
import uuid
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text, update

from .api.auth import router as auth_router
from .api.routes import router
from . import logs, ops
from .context import reset_request_id, set_request_id
from .db.models import Base, Consultation, Tenant, make_engine, make_session_factory
from .harness import Engine, Registry
from .providers import OfflineProvider, make_llm
try:                                    # the local photo editor needs torch/diffusers/Pillow;
    from .providers.local_hair import make_image_provider   # without them (e.g. free hosting) we use drawings
except ImportError:                     # pragma: no cover
    def make_image_provider():
        return None

logs.setup()
log = logging.getLogger("aaina")


def load_env_file(path: Path = Path(__file__).resolve().parents[1] / ".env") -> None:
    """Read backend/.env for local runs. Real environment variables always win,
    so Render's settings stay authoritative in production."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.split(" #", 1)[0].strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


load_env_file()


def create_app(database_url: str | None = None, llm: str | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        Base.metadata.create_all(app.state.db_engine)
        seed_tenants(app)
        recover_interrupted(app)
        yield

    app = FastAPI(title="Aaina API", version="1.0.0", lifespan=lifespan)
    app.state.registry = Registry()
    app.state.providers = {"llm": make_llm(llm), "offline": OfflineProvider(), "image": make_image_provider() if llm != "offline" else None}
    app.state.engine = Engine(app.state.registry, app.state.providers)
    app.state.db_engine = make_engine(database_url)
    app.state.sessions = make_session_factory(app.state.db_engine)

    origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:4200").split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"], allow_credentials=False,
                       expose_headers=["X-Request-ID"])
    app.include_router(auth_router)
    app.include_router(router)

    @app.middleware("http")
    async def measure(request: Request, call_next):
        """Latency and status per route template, for the owner's ops panel."""
        if not request.url.path.startswith("/api/"):
            return await call_next(request)
        started = time.perf_counter()
        response = await call_next(request)
        route = request.url.path
        for name, value in (request.scope.get("path_params") or {}).items():
            route = route.replace(f"/{value}", f"/{{{name}}}", 1)
        ms = (time.perf_counter() - started) * 1000
        ops.record_request(f"{request.method} {route}", response.status_code, ms)
        log.info("request", extra={"fields": {"method": request.method, "route": route,
                                               "status": response.status_code, "ms": round(ms, 1)}})
        return response

    # Registered last, so it is outermost: every log line and audit row below it carries the id.
    @app.middleware("http")
    async def request_context(request: Request, call_next):
        """A request id on every call (kept from X-Request-ID if sent), echoed back, plus security
        headers; an unexpected error becomes a JSON 500 naming the id, never a stack trace."""
        rid = (request.headers.get("x-request-id") or "")[:32] or uuid.uuid4().hex[:16]
        token = set_request_id(rid)
        try:
            response = await call_next(request)
        except Exception:
            log.exception("unhandled error", extra={"fields": {"path": request.url.path}})
            response = JSONResponse({"detail": "Something went wrong on our side. Please try again.",
                                     "request_id": rid}, status_code=500)
        finally:
            reset_request_id(token)
        response.headers["X-Request-ID"] = rid
        for k, v in SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        return response

    @app.get("/api/ready", tags=["platform"])
    def ready():
        """Readiness: can this instance do real work? /api/health says the process is up;
        this also checks the database, so traffic can wait until it answers."""
        try:
            with app.state.db_engine.connect() as c:
                c.execute(text("SELECT 1"))
            db_ok = True
        except Exception:
            db_ok = False
        url = str(app.state.db_engine.url)
        body = {"status": "ready" if db_ok else "not_ready",
                "database": app.state.db_engine.dialect.name if db_ok else "unreachable",
                "durable": not url.startswith("sqlite")}
        return JSONResponse(body, status_code=200 if db_ok else 503)

    return app


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=31536000",
}


def recover_interrupted(app: FastAPI) -> None:
    """Consultations run inside this process. One still queued or running at start-up was cut off
    by a restart (the free server sleeps), so it is marked failed: the salon sees "try again"
    instead of waiting forever."""
    with app.state.sessions() as db:
        n = db.execute(update(Consultation).where(Consultation.status.in_(("queued", "running")))
                       .values(status="failed", error="Interrupted by a server restart. Please try again.")).rowcount
        db.commit()
    if n:
        log.warning("marked interrupted consultations failed", extra={"fields": {"count": n}})


def seed_tenants(app: FastAPI) -> None:
    """Salons defined in manifests/tenants are created on first start."""
    with app.state.sessions() as db:
        for spec in app.state.registry.tenants.values():
            if not db.scalar(select(Tenant).where(Tenant.slug == spec.slug)):
                db.add(Tenant(slug=spec.slug, name=spec.name, plan=spec.plan, provider=spec.provider,
                              workflows=spec.workflows, branding=spec.branding.model_dump(), settings=spec.settings.model_dump()))
        db.commit()


app = create_app()
