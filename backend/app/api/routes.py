"""HTTP API. Thin: validates, scopes everything to the tenant, and hands work to the engine."""
from __future__ import annotations

import asyncio
import base64
import binascii
import csv
import io
import datetime as dt
import os
import re
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select

from .. import ops
from ..db.models import Consultation, Customer, Tenant
from .auth import charge, check_tenant, ensure_tenant, read_token, require_admin, require_user
from ..harness.manifests import TenantSpec

router = APIRouter(prefix="/api")

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_EXTRA_PHOTOS = 4
PLAN_LIMITS = {"trial": 50, "starter": 300, "pro": 2000}       # consultations per month
_DATA_URL = re.compile(r"^data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$")
_SLUG = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$")


# ------------------------------------------------------------------ helpers
def state(request: Request):
    return request.app.state


def parse_image(data_url: str | None) -> dict[str, str] | None:
    if not data_url:
        return None
    m = _DATA_URL.match(data_url.strip())
    if not m:
        raise HTTPException(422, "Images must be JPEG, PNG or WebP data URLs")
    raw_b64 = re.sub(r"\s+", "", m.group(2))
    try:
        raw = base64.b64decode(raw_b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(422, "Image data is not valid base64")
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Each image must be under 5 MB")
    return {"media_type": m.group(1), "data": raw_b64}


def tenant_spec(t: Tenant) -> TenantSpec:
    return TenantSpec(slug=t.slug, name=t.name, plan=t.plan, provider=t.provider, workflows=t.workflows or [],
                      branding=t.branding or {}, settings=t.settings or {})


def get_tenant(slug: str, st=Depends(state), authorization: str | None = Header(default=None)) -> Tenant:
    with st.sessions() as db:
        t = db.scalar(select(Tenant).where(Tenant.slug == slug, Tenant.active.is_(True)))
        if not t:
            # a signed-in salon whose tenant was lost in a free-tier restart gets it back
            data = read_token((authorization or "").removeprefix("Bearer ").strip()) if authorization else None
            if data and data.get("t") == slug:
                t = ensure_tenant(db, slug, data.get("tn", ""))
    if not t:
        raise HTTPException(404, "Salon not found")
    return t


def month_usage(db, tenant_id: str) -> int:
    start = dt.datetime.now(dt.timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return db.scalar(select(func.count()).select_from(Consultation)
                     .where(Consultation.tenant_id == tenant_id, Consultation.created_at >= start)) or 0


def _set(d: dict[str, Any], dotted: str, value: Any) -> None:
    parts = dotted.split(".")
    for p in parts[:-1]:
        d = d.setdefault(p, {})
    d[parts[-1]] = value


def normalise_answers(answers: dict[str, Any]) -> dict[str, Any]:
    """Accept flat 'self_report.hair_type' keys from the form and nest them."""
    out: dict[str, Any] = {}
    for k, v in answers.items():
        _set(out, k, v) if "." in k else out.__setitem__(k, v)
    out.setdefault("self_report", {})
    return out


# The language the customer reads, from the app's language picker. Agents write
# their customer-facing text in it; anything unknown is English.
LANGUAGE_NAMES = {
    "en": "English", "hi": "Hindi", "bn": "Bengali", "ta": "Tamil", "te": "Telugu", "mr": "Marathi",
    "gu": "Gujarati", "kn": "Kannada", "ml": "Malayalam", "pa": "Punjabi", "or": "Odia",
}


# ------------------------------------------------------------------ models
class TenantIn(BaseModel):
    slug: str
    name: str = Field(min_length=2, max_length=160)
    plan: str = "trial"
    branding: dict[str, Any] = Field(default_factory=dict)
    settings: dict[str, Any] = Field(default_factory=dict)

    @field_validator("slug")
    @classmethod
    def _slug(cls, v: str) -> str:
        if not _SLUG.match(v):
            raise ValueError("slug: 3-48 lowercase letters, digits or hyphens")
        return v


class Consent(BaseModel):
    photo_processing: bool = False
    store_photo: bool = False
    terms_version: str = "2026-10"


class ConsultationIn(BaseModel):
    customer: dict[str, Any] = Field(default_factory=dict)      # {name?, phone?}
    consent: Consent
    answers: dict[str, Any] = Field(default_factory=dict)
    photo: str | None = None
    extra_photos: list[str] = Field(default_factory=list)
    photo_geometry: dict[str, Any] | None = None     # hair mask + face outline from the phone, for the photo editor


class ChooseIn(BaseModel):
    style_id: str


# ------------------------------------------------------------------ meta
@router.get("/health")
def health(st=Depends(state)):
    llm = st.providers["llm"]
    return {"status": "ok", "ai": bool(llm and llm.available), "provider": getattr(llm, "name", "offline"),
            "vision": bool(llm and getattr(llm, "vision", False)), "agents": len(st.registry.agents)}


@router.get("/meta")
def meta(st=Depends(state)):
    img = st.providers.get("image")
    return {"features": {"photo_tryon": bool(img and img.available)}, "ui": st.registry.ui_manifest(), "forms": st.registry.forms, "workflows": {
        k: {"title": w.title, "steps": [{"id": s.id, "agent": s.agent, "title": st.registry.agents[s.agent].title} for s in w.steps]}
        for k, w in st.registry.workflows.items()}}


# ------------------------------------------------------------------ tenants
@router.post("/tenants", dependencies=[Depends(require_admin)], status_code=201)
def create_tenant(body: TenantIn, st=Depends(state)):
    with st.sessions() as db:
        if db.scalar(select(Tenant).where(Tenant.slug == body.slug)):
            raise HTTPException(409, "That salon address is taken")
        spec = TenantSpec(slug=body.slug, name=body.name, plan=body.plan, branding=body.branding, settings=body.settings)
        t = Tenant(slug=spec.slug, name=spec.name, plan=spec.plan, provider=spec.provider, workflows=spec.workflows,
                   branding=spec.branding.model_dump(), settings=spec.settings.model_dump())
        db.add(t)
        db.commit()
        return {"slug": t.slug, "name": t.name, "url": f"/t/{t.slug}"}


@router.get("/tenants", dependencies=[Depends(require_admin)])
def list_tenants(st=Depends(state)):
    with st.sessions() as db:
        rows = db.scalars(select(Tenant).order_by(Tenant.created_at)).all()
        return [{"slug": t.slug, "name": t.name, "plan": t.plan, "active": t.active, "this_month": month_usage(db, t.id)} for t in rows]


@router.get("/t/{slug}")
def tenant_public(t: Tenant = Depends(get_tenant), st=Depends(state)):
    with st.sessions() as db:
        used = month_usage(db, t.id)
    spec = tenant_spec(t)
    return {"slug": spec.slug, "name": spec.name, "plan": spec.plan, "branding": spec.branding.model_dump(),
            "settings": {"store_photos": spec.settings.store_photos, "audience": spec.settings.audience, "city": spec.settings.city},
            "usage": {"this_month": used, "limit": PLAN_LIMITS.get(spec.plan, 50)},
            "ai": bool(st.providers["llm"] and st.providers["llm"].available) and spec.provider != "offline",
            "vision": bool(st.providers["llm"] and getattr(st.providers["llm"], "vision", False)) and spec.provider != "offline"}


# ------------------------------------------------------------------ consultations
@router.post("/t/{slug}/consultations", status_code=202)
async def start_consultation(body: ConsultationIn, background: BackgroundTasks, t: Tenant = Depends(get_tenant), st=Depends(state),
                             user: dict = Depends(require_user)):
    check_tenant(user, t.slug)
    spec = tenant_spec(t)
    if "consultation" not in spec.workflows:
        raise HTTPException(403, "Consultations are not enabled for this salon")
    if (body.photo or body.extra_photos) and not body.consent.photo_processing:
        raise HTTPException(422, "Photo consent is required before we can analyse a photo")
    if len(body.extra_photos) > MAX_EXTRA_PHOTOS:
        raise HTTPException(422, f"Up to {MAX_EXTRA_PHOTOS} extra photos")
    charge(user)                                        # per-user and whole-app daily caps protect the AI key
    photo = parse_image(body.photo)
    extras = [img for img in (parse_image(p) for p in body.extra_photos) if img]
    raw = dict(body.answers)
    phone_answer = str(raw.pop("phone", "") or "").strip()   # for reminders only; never sent to an AI model
    answers = normalise_answers(raw)
    answers["language"] = LANGUAGE_NAMES.get(str(answers.get("language") or "en"), "English")
    keep_photo = bool(photo) and spec.settings.store_photos and body.consent.store_photo

    with st.sessions() as db:
        if month_usage(db, t.id) >= PLAN_LIMITS.get(spec.plan, 50):
            raise HTTPException(402, "This salon has used its consultations for the month")
        phone = (body.customer.get("phone") or phone_answer or "").strip() or None
        customer = db.scalar(select(Customer).where(Customer.tenant_id == t.id, Customer.phone == phone)) if phone else None
        if not customer:
            customer = Customer(tenant_id=t.id, phone=phone)
            db.add(customer)
        customer.name = (body.customer.get("name") or answers.get("name") or customer.name or None)
        customer.profile = answers
        customer.consent = body.consent.model_dump() | {"at": dt.datetime.now(dt.timezone.utc).isoformat()}
        c = Consultation(tenant_id=t.id, customer=customer, workflow="consultation", status="queued", input=answers,
                         photo=body.photo if keep_photo else None,
                         steps={s.id: {"status": "pending"} for s in st.registry.workflows["consultation"].steps})
        db.add(c)
        db.commit()
        cid = c.id

    geometry = body.photo_geometry if photo else None
    if geometry and not (isinstance(geometry.get("hair_mask"), str) and geometry["hair_mask"].startswith("data:image/png;base64,")):
        raise HTTPException(422, "photo_geometry.hair_mask must be a PNG data URL")
    images = {"photo": photo, "extra": extras, "geometry": geometry}   # in memory only; never written unless opted in
    background.add_task(run_consultation, st, cid, spec, answers, images)
    return {"id": cid, "status": "queued"}


async def run_consultation(st, cid: str, spec: TenantSpec, answers: dict[str, Any], images: dict[str, Any]) -> None:
    lock = asyncio.Lock()

    async def on_event(step_id: str, info: dict[str, Any]) -> None:
        async with lock:
            await asyncio.to_thread(_save_step, st, cid, step_id, info)

    await asyncio.to_thread(_set_status, st, cid, "running")
    ctx = {"input": answers, "images": images, "today": dt.date.today().isoformat()}
    try:
        result = await st.engine.run("consultation", ctx, spec, on_event=on_event)
        ops.record_run(spec.slug, result.to_dict())
        await asyncio.to_thread(_finish, st, cid, result.to_dict())
    except Exception as exc:  # engine-level failure
        await asyncio.to_thread(_set_status, st, cid, "failed", str(exc)[:500])


def _save_step(st, cid: str, step_id: str, info: dict[str, Any]) -> None:
    with st.sessions() as db:
        c = db.get(Consultation, cid)
        steps = dict(c.steps or {})
        steps[step_id] = {k: info.get(k) for k in ("status", "source", "ms", "error")}
        c.steps = steps
        db.commit()


def _set_status(st, cid: str, status: str, error: str | None = None) -> None:
    with st.sessions() as db:
        c = db.get(Consultation, cid)
        c.status, c.error = status, error
        db.commit()


def _finish(st, cid: str, result: dict[str, Any]) -> None:
    with st.sessions() as db:
        c = db.get(Consultation, cid)
        c.outputs = result["outputs"]
        c.steps = result["steps"]
        c.status = "done" if result["ok"] or "recommendation" in result["outputs"] else "failed"
        c.error = None if c.status == "done" else "Some steps failed"
        db.commit()


def _consultation_view(c: Consultation) -> dict[str, Any]:
    return {"id": c.id, "status": c.status, "workflow": c.workflow, "steps": c.steps, "outputs": c.outputs,
            "chosen_style_id": c.chosen_style_id, "error": c.error, "created_at": c.created_at.isoformat(),
            "customer": {"id": c.customer_id, "name": c.customer.name if c.customer else None},
            "photo": c.photo}


@router.get("/t/{slug}/consultations/{cid}")
def get_consultation(cid: str, t: Tenant = Depends(get_tenant), st=Depends(state)):
    with st.sessions() as db:
        c = db.scalar(select(Consultation).where(Consultation.id == cid, Consultation.tenant_id == t.id))
        if not c:
            raise HTTPException(404, "Consultation not found")
        return _consultation_view(c)


@router.post("/t/{slug}/consultations/{cid}/choose")
async def choose_style(cid: str, body: ChooseIn, t: Tenant = Depends(get_tenant), st=Depends(state),
                       user: dict = Depends(require_user)):
    check_tenant(user, t.slug)
    with st.sessions() as db:
        c = db.scalar(select(Consultation).where(Consultation.id == cid, Consultation.tenant_id == t.id))
        if not c:
            raise HTTPException(404, "Consultation not found")
        options = (c.outputs or {}).get("recommendation", {}).get("options", [])
        if body.style_id not in {o["style_id"] for o in options}:
            raise HTTPException(422, "Choose one of the recommended styles")
        ctx = dict(c.outputs) | {"input": dict(c.input) | {"chosen_style_id": body.style_id}, "today": dt.date.today().isoformat()}
    result = await st.engine.run("choose_style", ctx, tenant_spec(t))
    with st.sessions() as db:
        c = db.get(Consultation, cid)
        c.outputs = dict(c.outputs) | result.outputs
        c.chosen_style_id = body.style_id
        db.commit()
        return _consultation_view(c)


# ------------------------------------------------------------------ customers & agenda
@router.get("/t/{slug}/customers")
def list_customers(q: str | None = None, t: Tenant = Depends(get_tenant), st=Depends(state), user: dict = Depends(require_user)):
    check_tenant(user, t.slug)
    with st.sessions() as db:
        stmt = select(Customer).where(Customer.tenant_id == t.id).order_by(Customer.created_at.desc()).limit(200)
        if q:
            like = f"%{q.strip()}%"
            stmt = stmt.where((Customer.name.ilike(like)) | (Customer.phone.ilike(like)))
        out = []
        for cu in db.scalars(stmt).all():
            last = max(cu.consultations, key=lambda c: c.created_at, default=None)
            out.append({"id": cu.id, "name": cu.name, "phone": cu.phone, "visits": len(cu.consultations),
                        "last_visit": last.created_at.isoformat() if last else None,
                        "chosen_style_id": last.chosen_style_id if last else None})
        return out


@router.get("/t/{slug}/customers.csv")
def export_customers(t: Tenant = Depends(get_tenant), st=Depends(state), user: dict = Depends(require_user)) -> Response:
    """The salon's customers as CSV, for its own billing app, CRM or WhatsApp tool. Only that salon's rows."""
    check_tenant(user, t.slug)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["name", "phone", "visits", "first_visit", "last_visit", "chosen_style", "next_trim_due"])
    today = dt.date.today().isoformat()
    with st.sessions() as db:
        for cu in db.scalars(select(Customer).where(Customer.tenant_id == t.id).order_by(Customer.created_at)).all():
            visits = sorted(cu.consultations, key=lambda c: c.created_at)
            last = visits[-1] if visits else None
            done = next((c for c in reversed(visits) if c.status == "done"), None)
            events = ((done.outputs or {}).get("calendar") or {}).get("events", []) if done else []
            trim = min((e["date"] for e in events if e.get("kind") == "trim" and e.get("date", "") >= today), default="")
            w.writerow([cu.name or "", cu.phone or "", len(visits), visits[0].created_at.date().isoformat() if visits else "",
                        last.created_at.date().isoformat() if last else "", (last.chosen_style_id or "") if last else "", trim])
    return Response(out.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{t.slug}-customers.csv"'})


@router.get("/admin/ops", dependencies=[Depends(require_admin)])
def ops_view(st=Depends(state)) -> dict:
    """Live service health: traffic, errors, latency, and per agent how often the model was kept, repaired or replaced."""
    return ops.snapshot(st.engine.repairs, st.engine.repaired)


@router.get("/t/{slug}/customers/{cust_id}")
def get_customer(cust_id: str, t: Tenant = Depends(get_tenant), st=Depends(state), user: dict = Depends(require_user)):
    check_tenant(user, t.slug)
    with st.sessions() as db:
        cu = db.scalar(select(Customer).where(Customer.id == cust_id, Customer.tenant_id == t.id))
        if not cu:
            raise HTTPException(404, "Customer not found")
        history = sorted(cu.consultations, key=lambda c: c.created_at, reverse=True)
        latest = next((c for c in history if c.status == "done"), None)
        return {"id": cu.id, "name": cu.name, "phone": cu.phone, "profile": cu.profile, "consent": cu.consent,
                "consultations": [{"id": c.id, "status": c.status, "created_at": c.created_at.isoformat(), "chosen_style_id": c.chosen_style_id} for c in history],
                "calendar": (latest.outputs or {}).get("calendar") if latest else None}


@router.delete("/t/{slug}/customers/{cust_id}", status_code=204)
def erase_customer(cust_id: str, t: Tenant = Depends(get_tenant), st=Depends(state), user: dict = Depends(require_user)):
    check_tenant(user, t.slug)
    """Right to erasure: the customer and everything linked to them."""
    with st.sessions() as db:
        cu = db.scalar(select(Customer).where(Customer.id == cust_id, Customer.tenant_id == t.id))
        if not cu:
            raise HTTPException(404, "Customer not found")
        db.delete(cu)
        db.commit()


@router.get("/t/{slug}/agenda")
def agenda(days: int = 14, t: Tenant = Depends(get_tenant), st=Depends(state), user: dict = Depends(require_user)):
    check_tenant(user, t.slug)
    """Who is due for what in the next N days - the salon's follow-up list."""
    days = max(1, min(days, 90))
    today = dt.date.today()
    horizon = today + dt.timedelta(days=days)
    items = []
    with st.sessions() as db:
        rows = db.scalars(select(Consultation).where(Consultation.tenant_id == t.id, Consultation.status == "done")).all()
        latest: dict[str, Consultation] = {}
        for c in rows:
            if c.customer_id not in latest or c.created_at > latest[c.customer_id].created_at:
                latest[c.customer_id] = c
        for c in latest.values():
            for e in ((c.outputs or {}).get("calendar") or {}).get("events", []):
                d = dt.date.fromisoformat(e["date"])
                if today <= d <= horizon:
                    items.append({"date": e["date"], "title": e["title"], "kind": e["kind"], "detail": e["detail"],
                                  "customer": {"id": c.customer_id, "name": c.customer.name, "phone": c.customer.phone}})
    return sorted(items, key=lambda i: i["date"])
