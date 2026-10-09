"""Aaina API entrypoint."""
from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from .api.auth import router as auth_router
from .api.routes import router
from . import ops
from .db.models import Base, Tenant, make_engine, make_session_factory
from .harness import Engine, Registry
from .providers import OfflineProvider, make_llm
try:                                    # the local photo editor needs torch/diffusers/Pillow;
    from .providers.local_hair import make_image_provider   # without them (e.g. free hosting) we use drawings
except ImportError:                     # pragma: no cover
    def make_image_provider():
        return None

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))


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
        yield

    app = FastAPI(title="Aaina API", version="1.0.0", lifespan=lifespan)
    app.state.registry = Registry()
    app.state.providers = {"llm": make_llm(llm), "offline": OfflineProvider(), "image": make_image_provider() if llm != "offline" else None}
    app.state.engine = Engine(app.state.registry, app.state.providers)
    app.state.db_engine = make_engine(database_url)
    app.state.sessions = make_session_factory(app.state.db_engine)

    origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:4200").split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"], allow_credentials=False)
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
        ops.record_request(f"{request.method} {route}", response.status_code, (time.perf_counter() - started) * 1000)
        return response

    return app


def seed_tenants(app: FastAPI) -> None:
    """Salons defined in manifests/tenants are created on first start."""
    with app.state.sessions() as db:
        for spec in app.state.registry.tenants.values():
            if not db.scalar(select(Tenant).where(Tenant.slug == spec.slug)):
                db.add(Tenant(slug=spec.slug, name=spec.name, plan=spec.plan, provider=spec.provider,
                              workflows=spec.workflows, branding=spec.branding.model_dump(), settings=spec.settings.model_dump()))
        db.commit()


app = create_app()
