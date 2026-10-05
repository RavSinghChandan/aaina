"""Sign-in protects the endpoints that spend AI credit."""
import pytest
from fastapi.testclient import TestClient

from app.api import auth
from app.main import create_app

BODY = {"customer": {"name": "A"}, "consent": {"photo_processing": False}, "answers": {"gender": "men"}}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AAINA_ACCESS_CODE", "mirror-2026, salon-team")
    monkeypatch.setattr(auth, "DAILY_PER_USER", 2)
    auth._attempts.clear(); auth._usage.clear()
    with TestClient(create_app(database_url=f"sqlite:///{tmp_path}/t.db", llm="offline")) as c:
        yield c


def login(c, code="mirror-2026", name="Priya"):
    return c.post("/api/auth/login", json={"name": name, "code": code})


def test_status_and_wrong_code(client):
    assert client.get("/api/auth/status").json() == {"required": True}
    assert login(client, code="nope").status_code == 401


def test_consultation_needs_sign_in(client):
    assert client.post("/api/t/demo/consultations", json=BODY).status_code == 401
    token = login(client, code="salon-team").json()["token"]           # any listed code works
    r = client.post("/api/t/demo/consultations", json=BODY, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 202
    cid = r.json()["id"]
    assert client.get(f"/api/t/demo/consultations/{cid}").status_code == 200    # reading results stays free


def test_tampered_or_expired_token_is_refused(client):
    token = login(client).json()["token"]
    bad = token[:-2] + ("A" if token[-1] != "A" else "B") + token[-1]
    assert client.post("/api/t/demo/consultations", json=BODY, headers={"Authorization": f"Bearer {bad}"}).status_code == 401
    old = auth.make_token("Priya", now=0)
    assert client.post("/api/t/demo/consultations", json=BODY, headers={"Authorization": f"Bearer {old}"}).status_code == 401


def test_daily_cap_per_user(client):
    h = {"Authorization": f"Bearer {login(client).json()['token']}"}
    assert [client.post("/api/t/demo/consultations", json=BODY, headers=h).status_code for _ in range(3)] == [202, 202, 429]


def test_login_attempts_are_limited(client):
    codes = [login(client, code="guess").status_code for _ in range(11)]
    assert codes[:10] == [401] * 10 and codes[10] == 429


def test_production_without_a_code_is_closed(tmp_path, monkeypatch):
    monkeypatch.delenv("AAINA_ACCESS_CODE", raising=False)
    monkeypatch.setenv("AAINA_ENV", "production")
    auth._attempts.clear()
    with TestClient(create_app(database_url=f"sqlite:///{tmp_path}/p.db", llm="offline")) as c:
        assert c.post("/api/t/demo/consultations", json=BODY).status_code == 401
        assert c.post("/api/auth/login", json={"name": "x", "code": "anything"}).status_code == 401
