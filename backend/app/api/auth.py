"""Multi-tenant onboarding and sign-in.

1. A salon registers (business, owner, email, phone): a pending request.
2. The owner of Aaina approves it on the admin page: a tenant is created and a
   tenant key + username are issued to send to the salon.
3. The salon signs in with the tenant key and username and works inside its
   own tenant.

The tenant key is signed (HMAC-SHA256 over tenant + username), so it is checked
without a database lookup: approved salons can always sign in, even after a
free-tier restart wipes the database, and their tenant is recreated on demand.
The session token is signed the same way (7 days). Hard daily caps per salon
user, per network and for the whole app bound what the AI key can spend.

Required in production (AAINA_ENV=production, or any Render deploy) and when
AAINA_AUTH=on; off for local development.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, text

from ..context import request_id
from ..db.models import AuditLog, Registration, Tenant, UsageCounter

router = APIRouter(prefix="/api")

TOKEN_DAYS = 7
DAILY_PER_USER = int(os.getenv("AAINA_DAILY_PER_USER", "10"))
DAILY_TOTAL = int(os.getenv("AAINA_DAILY_TOTAL", "150"))
DAILY_PER_IP = int(os.getenv("AAINA_DAILY_PER_IP", "6"))
_FALLBACK = secrets.token_hex(32)


def _ai_key() -> str:
    return os.getenv("DEEPSEEK_API_KEY", "")


def _secret() -> bytes:
    """Stable without extra setup: derived from the server-only AI key, so keys and tokens survive restarts.
    Read at call time, after backend/.env has been loaded."""
    if os.getenv("AAINA_SECRET"):
        return os.getenv("AAINA_SECRET", "").encode()
    return (hashlib.sha256(b"aaina-token:" + _ai_key().encode()).hexdigest() if _ai_key() else _FALLBACK).encode()
_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[a-z]{2,}$", re.I)
_USERNAME = re.compile(r"^[a-z0-9][a-z0-9._-]{1,31}$")

_attempts: dict[str, deque[float]] = defaultdict(deque)


def auth_required() -> bool:
    # Render sets RENDER on every service, so a hosted deploy is locked even before its settings sync.
    return os.getenv("AAINA_AUTH", "").lower() == "on" or os.getenv("AAINA_ENV", "").lower() == "production" or bool(os.getenv("RENDER"))


def derived_admin_key() -> str:
    """An admin key derived from the server-only AI key, so the admin page works with no extra setup."""
    return hashlib.sha256(b"aaina-admin:" + _ai_key().encode()).hexdigest()[:24] if _ai_key() else ""


def require_admin(x_admin_key: str | None = Header(default=None)) -> None:
    given = (x_admin_key or "").strip()
    if not auth_required() and not os.getenv("ADMIN_KEY"):
        return                                   # local development: admin is open unless ADMIN_KEY is set
    valid = [k for k in (os.getenv("ADMIN_KEY", ""), derived_admin_key()) if k]
    if not valid:
        raise HTTPException(401, "Admin key required")
    if not any(hmac.compare_digest(given, k) for k in valid):
        raise HTTPException(401, "Admin key required")


# ------------------------------------------------------------------ signing
def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _mac(*parts: str) -> bytes:
    return hmac.new(_secret(), "|".join(parts).encode(), hashlib.sha256).digest()


def tenant_key(slug: str, username: str) -> str:
    code = base64.b32encode(_mac("tenant-key", slug, username)).decode().rstrip("=")[:16]
    return f"{slug}.{code}"


def check_tenant_key(key: str, username: str) -> str | None:
    """The tenant slug if the key was issued to this username, else None."""
    slug, _, code = key.strip().rpartition(".")
    if not slug or not code:
        return None
    return slug if hmac.compare_digest(tenant_key(slug, username).rpartition(".")[2], code.upper()) else None


def make_token(name: str, now: float | None = None, who: str = "", tenant: str = "", tenant_name: str = "") -> str:
    issued = time.time() if now is None else now
    body = {"n": name, "u": who or name, "t": tenant, "tn": tenant_name, "exp": int(issued + TOKEN_DAYS * 86400)}
    payload = _b64(json.dumps(body).encode())
    return f"{payload}.{_b64(_mac('token', payload))}"


def read_token(token: str) -> dict | None:
    try:
        payload, sig = token.split(".", 1)
        if not hmac.compare_digest(sig, _b64(_mac("token", payload))):
            return None
        data = json.loads(_unb64(payload))
        return data if data.get("exp", 0) > time.time() else None
    except Exception:
        return None


# ------------------------------------------------------------------ helpers
def _limit(key: str, max_hits: int, seconds: int, message: str) -> None:
    window = _attempts[key]
    now = time.time()
    while window and now - window[0] > seconds:
        window.popleft()
    if len(window) >= max_hits:
        raise HTTPException(429, message)
    window.append(now)


def _ip(request: Request) -> str:
    return request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "?")


def _slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (s or "salon")[:40].strip("-")


def ensure_tenant(db, slug: str, name: str) -> Tenant:
    """The tenant for a valid key, created if it is missing (e.g. after a free-tier restart)."""
    t = db.scalar(select(Tenant).where(Tenant.slug == slug))
    if t:
        return t
    demo = db.scalar(select(Tenant).where(Tenant.slug == "demo"))
    t = Tenant(slug=slug, name=name or slug.replace("-", " ").title(), plan="trial",
               provider=demo.provider if demo else "auto", workflows=list(demo.workflows) if demo else ["consultation"],
               branding=dict(demo.branding) if demo else {}, settings=dict(demo.settings) if demo else {})
    db.add(t)
    db.commit()
    return t


# ------------------------------------------------------------------ public endpoints
class RegisterIn(BaseModel):
    business: str = Field(min_length=2, max_length=120)
    owner: str = Field(min_length=1, max_length=60)
    email: str = Field(min_length=3, max_length=160)
    phone: str = Field(default="", max_length=20)
    city: str = Field(default="", max_length=60)


class LoginIn(BaseModel):
    tenant_key: str = Field(min_length=3, max_length=80)
    username: str = Field(min_length=2, max_length=32)


@router.get("/auth/status")
def status():
    return {"required": auth_required()}


@router.post("/auth/register", status_code=201)
def register(body: RegisterIn, request: Request):
    _limit("reg:" + _ip(request), 5, 3600, "Too many requests from this network. Please try again later.")
    email = body.email.strip().lower()
    if not _EMAIL.match(email):
        raise HTTPException(422, "Please enter a valid email address.")
    with request.app.state.sessions() as db:
        pending = db.scalar(select(Registration).where(Registration.email == email, Registration.status == "pending"))
        if pending:
            return {"id": pending.id, "status": "pending"}
        reg = Registration(business=body.business.strip(), owner=body.owner.strip(), email=email,
                           phone=body.phone.strip(), city=body.city.strip())
        db.add(reg)
        db.commit()
        return {"id": reg.id, "status": "pending"}


@router.post("/auth/login")
def login(body: LoginIn, request: Request):
    _limit("login:" + _ip(request), 10, 900, "Too many attempts. Try again in a few minutes.")
    username = body.username.strip().lower()
    slug = check_tenant_key(body.tenant_key, username)
    if not slug:
        raise HTTPException(401, "Tenant key or username is not right.")
    with request.app.state.sessions() as db:
        reg = db.scalar(select(Registration).where(Registration.tenant_slug == slug, Registration.username == username))
        if reg and reg.status == "revoked":
            raise HTTPException(403, "This access has been turned off. Please contact Aaina.")
        t = ensure_tenant(db, slug, reg.business if reg else "")
        name, tenant_name = (reg.owner if reg else username), t.name
    return {"token": make_token(name, who=username, tenant=slug, tenant_name=tenant_name),
            "name": name, "tenant": slug, "tenant_name": tenant_name, "days": TOKEN_DAYS}


# ------------------------------------------------------------------ admin (the owner of Aaina)
class ApproveIn(BaseModel):
    username: str = Field(default="", max_length=32)


class IssueIn(BaseModel):
    business: str = Field(min_length=2, max_length=120)
    owner: str = Field(min_length=1, max_length=60)
    email: str = Field(default="", max_length=160)
    username: str = Field(default="", max_length=32)


def _suggest_username(owner: str, email: str) -> str:
    base = re.sub(r"[^a-z0-9]", "", (email.split("@")[0] if email else owner).lower())[:20] or "owner"
    return base if len(base) >= 2 else base + "01"


def _issue(db, reg: Registration, username: str) -> dict:
    username = (username or _suggest_username(reg.owner, reg.email)).strip().lower()
    if not _USERNAME.match(username):
        raise HTTPException(422, "Usernames use 2-32 lowercase letters, digits, dots, dashes or underscores.")
    slug = reg.tenant_slug
    if not slug:
        slug, n = _slugify(reg.business), 2
        while db.scalar(select(Tenant).where(Tenant.slug == slug)) or slug == "demo":
            slug, n = f"{_slugify(reg.business)}-{n}", n + 1
    ensure_tenant(db, slug, reg.business)
    reg.status, reg.tenant_slug, reg.username, reg.decided_at = "approved", slug, username, dt.datetime.now(dt.timezone.utc)
    db.commit()
    return {"id": reg.id, "business": reg.business, "owner": reg.owner, "email": reg.email,
            "tenant": slug, "username": username, "tenant_key": tenant_key(slug, username)}


def _row(r: Registration) -> dict:
    return {"id": r.id, "business": r.business, "owner": r.owner, "email": r.email, "phone": r.phone, "city": r.city,
            "status": r.status, "tenant": r.tenant_slug, "username": r.username,
            "tenant_key": tenant_key(r.tenant_slug, r.username) if r.status == "approved" and r.tenant_slug and r.username else None,
            "created_at": r.created_at.isoformat() if r.created_at else None}


def audit(db, action: str, target: str, detail: dict | None = None) -> None:
    db.add(AuditLog(actor="owner", action=action, target=target or "", detail=detail or {}, request_id=request_id()))
    db.commit()


@router.get("/admin/audit")
def audit_log(request: Request, x_admin_key: str | None = Header(default=None)):
    """Who was given or lost access, newest first, with the request id of each change."""
    require_admin(x_admin_key)
    with request.app.state.sessions() as db:
        rows = db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(50)).all()
        return [{"at": r.at.isoformat(), "actor": r.actor, "action": r.action, "target": r.target,
                 "detail": r.detail, "request_id": r.request_id} for r in rows]


@router.get("/admin/registrations")
def list_registrations(request: Request, x_admin_key: str | None = Header(default=None)):
    require_admin(x_admin_key)
    with request.app.state.sessions() as db:
        return [_row(r) for r in db.scalars(select(Registration).order_by(Registration.created_at.desc())).all()]


@router.post("/admin/registrations/{rid}/approve")
def approve(rid: str, body: ApproveIn, request: Request, x_admin_key: str | None = Header(default=None)):
    require_admin(x_admin_key)
    with request.app.state.sessions() as db:
        reg = db.get(Registration, rid)
        if not reg:
            raise HTTPException(404, "Request not found")
        out = _issue(db, reg, body.username)
        audit(db, "approve", out["tenant"], {"business": reg.business, "username": out["username"]})
        return out


@router.post("/admin/registrations/{rid}/reject")
def reject(rid: str, request: Request, x_admin_key: str | None = Header(default=None)):
    require_admin(x_admin_key)
    with request.app.state.sessions() as db:
        reg = db.get(Registration, rid)
        if not reg:
            raise HTTPException(404, "Request not found")
        reg.status = "revoked" if reg.status == "approved" else "rejected"
        db.commit()
        audit(db, "revoke" if reg.status == "revoked" else "reject", reg.tenant_slug or reg.id, {"business": reg.business})
        return {"id": reg.id, "status": reg.status}


@router.post("/admin/issue")
def issue_directly(body: IssueIn, request: Request, x_admin_key: str | None = Header(default=None)):
    """Give a salon access without a registration request (or re-issue one lost in a restart)."""
    require_admin(x_admin_key)
    with request.app.state.sessions() as db:
        reg = Registration(business=body.business.strip(), owner=body.owner.strip(), email=body.email.strip().lower(), phone="", city="")
        db.add(reg)
        db.flush()
        out = _issue(db, reg, body.username)
        audit(db, "issue", out["tenant"], {"business": reg.business, "username": out["username"]})
        return out


# ------------------------------------------------------------------ guards for the AI endpoints
def require_user(request: Request, authorization: str | None = Header(default=None)) -> dict:
    """Signed-in salon user, for endpoints that spend AI credit."""
    if not auth_required():
        return {"key": "local", "tenant": None}
    token = (authorization or "").removeprefix("Bearer ").strip()
    data = read_token(token) if token else None
    if not data or not data.get("t"):
        raise HTTPException(401, "Please sign in to continue.")
    return {"key": f"{data['t']}:{data.get('u')}|{_ip(request)}", "tenant": data["t"], "tenant_name": data.get("tn", "")}


def check_tenant(user: dict, slug: str) -> None:
    if user.get("tenant") and user["tenant"] != slug:
        raise HTTPException(403, "You can only work inside your own salon.")


def charge(user: dict, sessions) -> None:
    """Count one AI run against the per-user, per-network and whole-app daily caps (kept in the database)."""
    if not auth_required():
        return
    today = time.strftime("%Y-%m-%d")
    who, _, ip = user["key"].partition("|")
    keys = ["__total__", "u:" + who] + (["ip:" + ip] if ip else [])
    with sessions() as db:
        rows = db.scalars(select(UsageCounter).where(UsageCounter.day == today, UsageCounter.key.in_(keys))).all()
        used = {k: 0 for k in keys} | {r.key: r.count for r in rows}
        if used["__total__"] >= DAILY_TOTAL:
            raise HTTPException(429, "Today's free limit for the whole app is used up. Please come back tomorrow.")
        if used["u:" + who] >= DAILY_PER_USER:
            raise HTTPException(429, f"You have used today's {DAILY_PER_USER} consultations. Please come back tomorrow.")
        if ip and used["ip:" + ip] >= DAILY_PER_IP:
            raise HTTPException(429, "Today's consultations from this network are used up. Please come back tomorrow.")
        # One atomic upsert per key; the same SQL on Postgres and SQLite (3.24+).
        for k in keys:
            db.execute(text("INSERT INTO usage_counters (day, key, count) VALUES (:d, :k, 1) "
                            "ON CONFLICT (day, key) DO UPDATE SET count = usage_counters.count + 1"), {"d": today, "k": k})
        db.commit()
