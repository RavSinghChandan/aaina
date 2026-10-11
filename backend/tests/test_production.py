"""Production behaviour: caps that survive a restart, an audit log, request ids, readiness, safe errors,
and consultations cut off by a restart. A "restart" is a new app on the same database."""
import json
import logging
import os

import pytest
from fastapi.testclient import TestClient

from app import logs
from app.api import auth
from app.db.models import Consultation, Customer, Tenant
from app.main import create_app

ADMIN = {"x-admin-key": "owner-secret"}
BODY = {"customer": {"name": "A"}, "consent": {"photo_processing": False}, "answers": {"gender": "men"}}


@pytest.fixture()
def db_url(tmp_path, monkeypatch):
    monkeypatch.setenv("AAINA_AUTH", "on")
    monkeypatch.setenv("ADMIN_KEY", "owner-secret")
    auth._attempts.clear()
    return f"sqlite:///{tmp_path}/prod.db"


def app_on(url):
    return TestClient(create_app(database_url=url, llm="offline"), raise_server_exceptions=False)


def signed_in(c, business="Glow Salon", username="priya"):
    rid = c.post("/api/auth/register", json={"business": business, "owner": "Priya", "email": f"{username}@example.com",
                                             "phone": "9000000001"}).json()["id"]
    row = c.post(f"/api/admin/registrations/{rid}/approve", json={"username": username}, headers=ADMIN).json()
    token = c.post("/api/auth/login", json={"tenant_key": row["tenant_key"], "username": username}).json()["token"]
    return row, {"authorization": f"Bearer {token}"}


def test_daily_cap_survives_a_restart(db_url, monkeypatch):
    monkeypatch.setattr(auth, "DAILY_PER_USER", 2)
    with app_on(db_url) as c:
        row, headers = signed_in(c)
        slug = row["tenant"]
        assert [c.post(f"/api/t/{slug}/consultations", json=BODY, headers=headers).status_code for _ in range(2)] == [202, 202]
    auth._attempts.clear()
    with app_on(db_url) as c:
        assert c.post(f"/api/t/{slug}/consultations", json=BODY, headers=headers).status_code == 429


def test_owner_actions_are_audited_with_their_request_id(db_url):
    with app_on(db_url) as c:
        rid = c.post("/api/auth/register", json={"business": "Glow Salon", "owner": "Priya", "email": "p@example.com",
                                                 "phone": "9000000001"}).json()["id"]
        approved = c.post(f"/api/admin/registrations/{rid}/approve", json={"username": "priya"},
                          headers={**ADMIN, "x-request-id": "approve-req-1"})
        c.post(f"/api/admin/registrations/{rid}/reject", headers=ADMIN)
        log = c.get("/api/admin/audit", headers=ADMIN).json()
        assert [(e["action"], e["target"]) for e in log] == [("revoke", "glow-salon"), ("approve", "glow-salon")]
        assert log[1]["request_id"] == approved.headers["x-request-id"] == "approve-req-1"
        assert c.get("/api/admin/audit").status_code == 401


def test_a_consultation_cut_off_by_a_restart_is_marked_failed(db_url):
    with app_on(db_url) as c:
        sessions = c.app.state.sessions
        with sessions() as db:
            t = db.query(Tenant).filter_by(slug="demo").one()
            cust = Customer(tenant_id=t.id, name="A")
            db.add(cust)
            db.flush()
            for status in ("queued", "running", "done"):
                db.add(Consultation(id=status, tenant_id=t.id, customer_id=cust.id, workflow="consultation", status=status))
            db.commit()
    with app_on(db_url) as c:
        with c.app.state.sessions() as db:
            states = {x.id: (x.status, x.error) for x in db.query(Consultation).all()}
    assert states["queued"][0] == states["running"][0] == "failed"
    assert "restart" in states["running"][1]
    assert states["done"] == ("done", None)


def test_every_response_has_a_request_id_and_security_headers(db_url):
    with app_on(db_url) as c:
        r = c.get("/api/health")
        assert len(r.headers["x-request-id"]) == 16
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["x-frame-options"] == "DENY"
        assert c.get("/api/health", headers={"x-request-id": "abc"}).headers["x-request-id"] == "abc"


def test_readiness_checks_the_database(db_url):
    with app_on(db_url) as c:
        r = c.get("/api/ready")
        assert r.status_code == 200 and r.json()["status"] == "ready"
        assert r.json()["durable"] is bool(os.environ.get("TEST_DATABASE_URL"))
        c.app.state.db_engine.dispose()
        c.app.state.db_engine = __import__("sqlalchemy").create_engine(
            "postgresql+psycopg://nobody:x@127.0.0.1:1/none?connect_timeout=1")
        assert c.get("/api/ready").json() == {"status": "not_ready", "database": "unreachable", "durable": True}


def test_an_unexpected_error_returns_json_with_the_request_id(db_url):
    with app_on(db_url) as c:
        @c.app.get("/api/test-boom")
        def boom():
            raise RuntimeError("secret internals")
        r = c.get("/api/test-boom")
    assert r.status_code == 500
    assert r.json()["request_id"] == r.headers["x-request-id"]
    assert "secret internals" not in r.text


def test_each_request_is_one_json_log_line(db_url, caplog):
    caplog.set_level(logging.INFO, logger="aaina")
    with app_on(db_url) as c:
        r = c.get("/api/health")
    line = json.loads(logs.JsonFormatter().format(next(x for x in caplog.records if x.getMessage() == "request")))
    assert line["request_id"] == r.headers["x-request-id"]
    assert (line["method"], line["route"], line["status"]) == ("GET", "/api/health", 200)
