"""The salon redesign's guarantees: the customer's language reaches the agents,
a phone number is kept for reminders but never sent to a model, and a salon's
customers are visible only to that salon's signed-in users."""
import time

import pytest
from fastapi.testclient import TestClient

from app.api import auth
from app.main import create_app

ADMIN = {"x-admin-key": "owner-secret"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AAINA_AUTH", "on")
    monkeypatch.setenv("ADMIN_KEY", "owner-secret")
    auth._attempts.clear(); auth._usage.clear()
    with TestClient(create_app(database_url=f"sqlite:///{tmp_path}/t.db", llm="offline")) as c:
        yield c


def signed_in(c, business, email, username):
    rid = c.post("/api/auth/register", json={"business": business, "owner": "O", "email": email, "phone": "9000000001"}).json()["id"]
    issued = c.post(f"/api/admin/registrations/{rid}/approve", json={"username": username}, headers=ADMIN).json()
    token = c.post("/api/auth/login", json={"tenant_key": issued["tenant_key"], "username": username}).json()["token"]
    return issued["tenant"], {"Authorization": f"Bearer {token}"}


def finish(c, slug, cid, headers):
    for _ in range(100):
        body = c.get(f"/api/t/{slug}/consultations/{cid}", headers=headers).json()
        if body["status"] in ("done", "failed"):
            return body
        time.sleep(0.05)
    raise AssertionError("consultation did not finish")


def start(c, slug, headers, **answers):
    body = {"customer": {"name": "Ravi"}, "consent": {"photo_processing": False},
            "answers": {"gender": "men", "hair_length_now": "short", "maintenance": "low", **answers}}
    return c.post(f"/api/t/{slug}/consultations", json=body, headers=headers)


def test_language_code_reaches_the_agents_as_a_name(client):
    slug, h = signed_in(client, "Kaveri Salon", "k@example.com", "ravi")
    cid = start(client, slug, h, language="ta").json()["id"]
    from sqlalchemy import select
    from app.db.models import Consultation
    with client.app.state.sessions() as db:
        assert db.scalar(select(Consultation).where(Consultation.id == cid)).input["language"] == "Tamil"


def test_unknown_language_falls_back_to_english(client):
    slug, h = signed_in(client, "Kaveri Salon", "k@example.com", "ravi")
    cid = start(client, slug, h, language="zz").json()["id"]
    from sqlalchemy import select
    from app.db.models import Consultation
    with client.app.state.sessions() as db:
        assert db.scalar(select(Consultation).where(Consultation.id == cid)).input["language"] == "English"


def test_phone_is_kept_for_reminders_but_not_sent_to_the_agents(client):
    slug, h = signed_in(client, "Kaveri Salon", "k@example.com", "ravi")
    cid = start(client, slug, h, phone="9840012345").json()["id"]
    finish(client, slug, cid, h)
    from sqlalchemy import select
    from app.db.models import Consultation
    with client.app.state.sessions() as db:
        c = db.scalar(select(Consultation).where(Consultation.id == cid))
        assert "phone" not in c.input
        assert c.customer.phone == "9840012345"


def test_a_returning_customer_is_matched_by_phone(client):
    slug, h = signed_in(client, "Kaveri Salon", "k@example.com", "ravi")
    finish(client, slug, start(client, slug, h, phone="9840012345").json()["id"], h)
    finish(client, slug, start(client, slug, h, phone="9840012345").json()["id"], h)
    rows = client.get(f"/api/t/{slug}/customers", headers=h).json()
    assert len(rows) == 1 and rows[0]["visits"] == 2


def test_customers_and_follow_ups_need_sign_in(client):
    slug, h = signed_in(client, "Kaveri Salon", "k@example.com", "ravi")
    for path in (f"/api/t/{slug}/customers", f"/api/t/{slug}/agenda"):
        assert client.get(path).status_code == 401
        assert client.get(path, headers=h).status_code == 200


def test_one_salon_cannot_read_another_salons_customers(client):
    slug_a, h_a = signed_in(client, "Kaveri Salon", "k@example.com", "ravi")
    slug_b, h_b = signed_in(client, "Ganga Salon", "g@example.com", "meera")
    finish(client, slug_a, start(client, slug_a, h_a, phone="9840012345").json()["id"], h_a)
    assert client.get(f"/api/t/{slug_a}/customers", headers=h_b).status_code == 403
    assert client.get(f"/api/t/{slug_a}/agenda", headers=h_b).status_code == 403


def test_the_quick_form_has_three_picture_questions(client):
    form = client.get("/api/meta").json()["forms"]["intake"]
    quick = form["sections"][0]
    assert quick["id"] == "quick"
    pictures = [f for f in quick["fields"] if f["type"] == "choice"]
    assert [f["id"] for f in pictures] == ["gender", "hair_length_now", "maintenance"]
    assert all(o.get("icon") for f in pictures for o in f["options"])
    assert all(s.get("more") for s in form["sections"][1:])


def test_whole_number_floats_from_a_model_are_accepted():
    from app.harness.schema import coerce, validate
    schema = {"type": "object", "properties": {"options": {"type": "array", "items": {"type": "object", "properties": {"match_score": {"type": "integer"}}}}}}
    out = coerce({"options": [{"match_score": 92.0}, {"match_score": 88}]}, schema)
    assert out == {"options": [{"match_score": 92}, {"match_score": 88}]} and not validate(out, schema)
    assert validate(coerce({"options": [{"match_score": 92.5}]}, schema), schema)
