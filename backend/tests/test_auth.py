"""Multi-tenant onboarding: register -> owner approves -> tenant key + username -> sign in."""
import pytest
from fastapi.testclient import TestClient

from app.api import auth
from app.main import create_app

BODY = {"customer": {"name": "A"}, "consent": {"photo_processing": False}, "answers": {"gender": "men"}}
ADMIN = {"x-admin-key": "owner-secret"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AAINA_AUTH", "on")
    monkeypatch.setenv("ADMIN_KEY", "owner-secret")
    monkeypatch.setattr(auth, "DAILY_PER_USER", 2)
    auth._attempts.clear(); auth._usage.clear()
    with TestClient(create_app(database_url=f"sqlite:///{tmp_path}/t.db", llm="offline")) as c:
        yield c


def register(c, business="Glow Salon", email="glow@example.com"):
    return c.post("/api/auth/register", json={"business": business, "owner": "Priya", "email": email, "phone": "9000000001"})


def approve(c, business="Glow Salon", email="glow@example.com", username=""):
    rid = register(c, business, email).json()["id"]
    return c.post(f"/api/admin/registrations/{rid}/approve", json={"username": username}, headers=ADMIN).json()


def login(c, key, username):
    return c.post("/api/auth/login", json={"tenant_key": key, "username": username})


def bearer(r):
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_full_flow_register_approve_sign_in(client):
    assert register(client).status_code == 201
    rows = client.get("/api/admin/registrations", headers=ADMIN).json()
    assert rows[0]["status"] == "pending" and rows[0]["tenant_key"] is None
    issued = client.post(f"/api/admin/registrations/{rows[0]['id']}/approve", json={"username": "priya"}, headers=ADMIN).json()
    assert issued["tenant"] == "glow-salon" and issued["username"] == "priya" and issued["tenant_key"].startswith("glow-salon.")
    r = login(client, issued["tenant_key"], "priya")
    assert r.status_code == 200 and r.json()["tenant"] == "glow-salon" and r.json()["tenant_name"] == "Glow Salon"
    c = client.post("/api/t/glow-salon/consultations", json=BODY, headers=bearer(r))
    assert c.status_code == 202
    assert client.get(f"/api/t/glow-salon/consultations/{c.json()['id']}").status_code == 200


def test_wrong_key_or_username_is_refused(client):
    issued = approve(client, username="priya")
    assert login(client, issued["tenant_key"], "someone").status_code == 401
    assert login(client, issued["tenant_key"][:-1] + "X", "priya").status_code == 401
    assert login(client, "glow-salon.AAAAAAAAAAAAAAAA", "priya").status_code == 401


def test_admin_endpoints_need_the_admin_key(client):
    register(client)
    assert client.get("/api/admin/registrations").status_code == 401
    assert client.get("/api/admin/registrations", headers={"x-admin-key": "guess"}).status_code == 401


def test_each_salon_only_in_its_own_tenant(client):
    a = login(client, approve(client, "Glow Salon", "a@example.com", "priya")["tenant_key"], "priya")
    approve(client, "Sharp Cuts", "b@example.com", "ravi")
    assert client.post("/api/t/sharp-cuts/consultations", json=BODY, headers=bearer(a)).status_code == 403
    assert client.post("/api/t/glow-salon/consultations", json=BODY, headers=bearer(a)).status_code == 202


def test_consultation_needs_sign_in(client):
    assert client.post("/api/t/demo/consultations", json=BODY).status_code == 401


def test_key_survives_a_wiped_database(tmp_path, monkeypatch):
    """Free tier restarts wipe SQLite; a signed key still signs in and the tenant is rebuilt."""
    monkeypatch.setenv("AAINA_AUTH", "on")
    auth._attempts.clear(); auth._usage.clear()
    key = auth.tenant_key("glow-salon", "priya")
    with TestClient(create_app(database_url=f"sqlite:///{tmp_path}/fresh.db", llm="offline")) as c:
        r = login(c, key, "priya")
        assert r.status_code == 200 and r.json()["tenant"] == "glow-salon"
        assert c.post("/api/t/glow-salon/consultations", json=BODY, headers=bearer(r)).status_code == 202


def test_revoked_access_cannot_sign_in(client):
    issued = approve(client, username="priya")
    client.post(f"/api/admin/registrations/{issued['id']}/reject", headers=ADMIN)
    assert login(client, issued["tenant_key"], "priya").status_code == 403


def test_issue_directly_without_a_request(client):
    issued = client.post("/api/admin/issue", json={"business": "Walk In Salon", "owner": "Asha", "username": "asha"}, headers=ADMIN).json()
    assert login(client, issued["tenant_key"], "asha").status_code == 200


def test_daily_caps(client, monkeypatch):
    h = bearer(login(client, approve(client, username="priya")["tenant_key"], "priya"))
    assert [client.post("/api/t/glow-salon/consultations", json=BODY, headers=h).status_code for _ in range(3)] == [202, 202, 429]


def test_tampered_or_expired_token_is_refused(client):
    token = login(client, approve(client, username="priya")["tenant_key"], "priya").json()["token"]
    bad = token[:-2] + ("A" if token[-1] != "A" else "B") + token[-1]
    assert client.post("/api/t/glow-salon/consultations", json=BODY, headers={"Authorization": f"Bearer {bad}"}).status_code == 401
    old = auth.make_token("Priya", now=0, who="priya", tenant="glow-salon")
    assert client.post("/api/t/glow-salon/consultations", json=BODY, headers={"Authorization": f"Bearer {old}"}).status_code == 401


def test_sign_in_attempts_are_limited(client):
    codes = [login(client, "glow-salon.GUESSGUESSGUESS0", "priya").status_code for _ in range(11)]
    assert codes[:10] == [401] * 10 and codes[10] == 429


def test_any_render_deploy_requires_sign_in(tmp_path, monkeypatch):
    monkeypatch.delenv("AAINA_AUTH", raising=False)
    monkeypatch.setenv("RENDER", "true")
    with TestClient(create_app(database_url=f"sqlite:///{tmp_path}/r.db", llm="offline")) as c:
        assert c.get("/api/auth/status").json() == {"required": True}
        assert c.post("/api/t/demo/consultations", json=BODY).status_code == 401
        assert c.get("/api/admin/registrations").status_code == 401
