"""Per-request context, readable anywhere in the call (logs, audit rows) without passing it down."""
from __future__ import annotations

from contextvars import ContextVar

_request_id: ContextVar[str] = ContextVar("request_id", default="")


def request_id() -> str:
    return _request_id.get()


def set_request_id(value: str):
    return _request_id.set(value)


def reset_request_id(token) -> None:
    _request_id.reset(token)


_admin: ContextVar[str] = ContextVar("admin", default="owner")


def admin_name() -> str:
    """Which admin made this request: "owner" for ADMIN_KEY, or the name given in ADMIN_KEYS."""
    return _admin.get()


def set_admin_name(value: str) -> None:
    _admin.set(value)
