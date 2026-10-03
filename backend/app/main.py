"""Aaina API entrypoint."""
from __future__ import annotations

import logging
import os
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from .api.routes import router
from .db.models import Base, Tenant, make_engine, make_session_factory
from .harness import Engine, Registry
from .providers import OfflineProvider, make_llm

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
    app.state.providers = {"llm": make_llm(llm), "offline": OfflineProvider()}
    app.state.engine = Engine(app.state.registry, app.state.providers)
    app.state.db_engine = make_engine(database_url)
    app.state.sessions = make_session_factory(app.state.db_engine)

    origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:4200").split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"], allow_credentials=False)
    app.include_router(router)
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
