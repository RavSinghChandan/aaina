"""Simple, free sign-in that protects the paid AI calls.

Visitors sign in with their name and an access code the owner shares
(AAINA_ACCESS_CODE, one or more codes separated by commas). The server answers
with a signed token (HMAC-SHA256, 7 days) - nothing is stored, so it survives
free-tier restarts. Only the endpoints that spend AI credit require it.

Fail closed: in production (AAINA_ENV=production) with no access code set,
nobody can start a consultation. Locally, with no code set, sign-in is off.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/auth")

TOKEN_DAYS = 7
DAILY_PER_USER = int(os.getenv("AAINA_DAILY_PER_USER", "10"))
DAILY_TOTAL = int(os.getenv("AAINA_DAILY_TOTAL", "150"))
_SECRET = (os.getenv("AAINA_SECRET") or secrets.token_hex(32)).encode()

_attempts: dict[str, deque[float]] = defaultdict(deque)       # login attempts per IP, last 15 minutes
_usage: dict[str, int] = defaultdict(int)                       # AI runs per user per day
_usage_day = {"day": ""}


def _codes() -> list[str]:
    return [c.strip() for c in os.getenv("AAINA_ACCESS_CODE", "").split(",") if c.strip()]


def auth_required() -> bool:
    return bool(_codes()) or os.getenv("AAINA_ENV", "").lower() == "production"


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def make_token(name: str, now: float | None = None) -> str:
    issued = time.time() if now is None else now
    payload = _b64(json.dumps({"n": name, "exp": int(issued + TOKEN_DAYS * 86400)}).encode())
    sig = _b64(hmac.new(_SECRET, payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def read_token(token: str) -> dict | None:
    try:
        payload, sig = token.split(".", 1)
        good = _b64(hmac.new(_SECRET, payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, good):
            return None
        data = json.loads(_unb64(payload))
        return data if data.get("exp", 0) > time.time() else None
    except Exception:
        return None


class LoginIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    code: str = Field(min_length=1, max_length=120)


@router.get("/status")
def status():
    return {"required": auth_required()}


@router.post("/login")
def login(body: LoginIn, request: Request):
    ip = request.client.host if request.client else "?"
    window = _attempts[ip]
    now = time.time()
    while window and now - window[0] > 900:
        window.popleft()
    if len(window) >= 10:
        raise HTTPException(429, "Too many attempts. Try again in a few minutes.")
    window.append(now)
    codes = _codes()
    if not codes or not any(hmac.compare_digest(body.code.strip(), c) for c in codes):
        raise HTTPException(401, "That access code is not right.")
    name = body.name.strip()
    return {"token": make_token(name), "name": name, "days": TOKEN_DAYS}


def require_user(authorization: str | None = Header(default=None)) -> str:
    """Dependency for endpoints that spend AI credit. Returns the user's name."""
    if not auth_required():
        return "local"
    token = (authorization or "").removeprefix("Bearer ").strip()
    data = read_token(token) if token else None
    if not data:
        raise HTTPException(401, "Please sign in to continue.")
    return data["n"]


def charge(user_key: str) -> None:
    """Count one AI run against the per-user and whole-app daily caps."""
    if not auth_required():
        return
    today = time.strftime("%Y-%m-%d")
    if _usage_day["day"] != today:
        _usage.clear()
        _usage_day["day"] = today
    if _usage["__total__"] >= DAILY_TOTAL:
        raise HTTPException(429, "Today's free limit for the whole app is used up. Please come back tomorrow.")
    if _usage[user_key] >= DAILY_PER_USER:
        raise HTTPException(429, f"You have used today's {DAILY_PER_USER} free consultations. Please come back tomorrow.")
    _usage[user_key] += 1
    _usage["__total__"] += 1
