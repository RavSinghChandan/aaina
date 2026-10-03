import asyncio
import base64
import shutil
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from app.harness import Engine, Registry
from app.harness.manifests import MANIFEST_DIR, CATALOG_DIR, WorkflowSpec
from app.main import create_app
from app.providers import OfflineProvider

# 1x1 transparent PNG
PNG = "data:image/png;base64," + base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c63f8ffff3f0005fe02fea7d6a4b00000000049454e44ae426082")).decode()

ANSWERS = {
    "name": "Priya", "gender": "women", "profession": "software engineer", "maintenance": "low",
    "vibes": ["modern"], "dislikes": ["bangs"], "hair_goals": ["keep length"], "hair_length_now": "long",
    "self_report.face_shape": "round", "self_report.hair_type": "wavy", "self_report.hair_concerns": ["frizz"],
}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("ADMIN_KEY", raising=False)
    app = create_app(database_url=f"sqlite:///{tmp_path}/t.db", llm="offline")
    with TestClient(app) as c:
        yield c


def consult(client, slug="demo", **over):
    body = {"customer": {"phone": "9000000001"}, "consent": {"photo_processing": True}, "answers": ANSWERS, "photo": PNG} | over
    r = client.post(f"/api/t/{slug}/consultations", json=body)
    return r


# ---------------------------------------------------------------- API journey
def test_health_and_meta(client):
    assert client.get("/api/health").json()["status"] == "ok"
    meta = client.get("/api/meta").json()
    assert meta["forms"]["intake"]["sections"]
    assert {u["view"] for u in meta["ui"]} >= {"options", "routine", "profile", "timeline", "facts"}


def test_full_consultation_offline(client):
    r = consult(client)
    assert r.status_code == 202
    cid = r.json()["id"]
    c = client.get(f"/api/t/demo/consultations/{cid}").json()   # background task already ran in TestClient
    assert c["status"] == "done"
    assert all(s["status"] == "done" for s in c["steps"].values())
    opts = c["outputs"]["recommendation"]["options"]
    assert len(opts) == 3 and len({o["style_id"] for o in opts}) == 3
    assert not any("bangs" in o["style_id"] for o in opts)          # respects dislikes
    assert len(c["outputs"]["previews"]["previews"]) == 3
    assert c["outputs"]["previews"]["previews"][0]["image"].startswith("data:image/svg+xml;base64,")
    assert c["photo"] is None                                       # never stored by default


def test_choose_style_replans_calendar(client):
    cid = consult(client).json()["id"]
    c = client.get(f"/api/t/demo/consultations/{cid}").json()
    second = c["outputs"]["recommendation"]["options"][1]
    r = client.post(f"/api/t/demo/consultations/{cid}/choose", json={"style_id": second["style_id"]})
    assert r.status_code == 200
    assert r.json()["chosen_style_id"] == second["style_id"]
    assert r.json()["outputs"]["calendar"]["style_id"] == second["style_id"]
    assert client.post(f"/api/t/demo/consultations/{cid}/choose", json={"style_id": "not-offered"}).status_code == 422


def test_consent_and_image_validation(client):
    assert consult(client, consent={"photo_processing": False}).status_code == 422
    assert consult(client, photo="data:text/html;base64,PGh0bWw+").status_code == 422
    assert consult(client, extra_photos=[PNG] * 5).status_code == 422
    # no photo at all is fine - the answers alone drive the offline analysis
    assert consult(client, photo=None, consent={"photo_processing": False}).status_code == 202


def test_tenant_isolation(client):
    assert client.post("/api/tenants", json={"slug": "glow-salon", "name": "Glow Salon"}).status_code == 201
    cid = consult(client, "demo").json()["id"]
    assert client.get(f"/api/t/glow-salon/consultations/{cid}").status_code == 404
    assert client.get("/api/t/glow-salon/customers").json() == []
    assert len(client.get("/api/t/demo/customers").json()) == 1


def test_agenda_and_erasure(client):
    cid = consult(client).json()["id"]
    agenda = client.get("/api/t/demo/agenda?days=30").json()
    assert any(e["kind"] == "check-in" for e in agenda)
    cust = client.get("/api/t/demo/customers").json()[0]
    assert client.delete(f"/api/t/demo/customers/{cust['id']}").status_code == 204
    assert client.get(f"/api/t/demo/consultations/{cid}").status_code == 404
    assert client.get("/api/t/demo/agenda?days=30").json() == []


def test_same_phone_is_same_customer(client):
    consult(client); consult(client)
    customers = client.get("/api/t/demo/customers").json()
    assert len(customers) == 1 and customers[0]["visits"] == 2


def test_admin_key_and_bad_slug(client, monkeypatch):
    monkeypatch.setenv("ADMIN_KEY", "s3cret")
    assert client.post("/api/tenants", json={"slug": "x-salon", "name": "X"}).status_code == 401
    assert client.post("/api/tenants", json={"slug": "x-salon", "name": "X Salon"}, headers={"x-admin-key": "s3cret"}).status_code == 201
    assert client.post("/api/tenants", json={"slug": "Bad Slug!", "name": "Bad"}, headers={"x-admin-key": "s3cret"}).status_code == 422
    assert client.get("/api/t/nope").status_code == 404


def test_plan_limit(client, monkeypatch):
    from app.api import routes
    monkeypatch.setitem(routes.PLAN_LIMITS, "trial", 1)
    assert consult(client).status_code == 202
    assert consult(client).status_code == 402


# ---------------------------------------------------------------- harness promises
def _copy_manifests(tmp: Path) -> Path:
    dst = tmp / "manifests"
    shutil.copytree(MANIFEST_DIR, dst)
    return dst


def test_new_feature_with_yaml_only(tmp_path):
    """Adding an agent + workflow step needs no Python changes."""
    mdir = _copy_manifests(tmp_path)
    (mdir / "agents" / "80_quick_tip.yaml").write_text(yaml.safe_dump({
        "id": "quick_tip", "title": "Stylist tip", "kind": "rule",
        "output_schema": {"type": "object", "properties": {"summary": {"type": "string"}, "options": {"type": "array"}}},
        "ui": {"view": "facts", "order": 70},
        "offline": {"rule": "style_recommender"},       # reuse an existing deterministic rule
    }))
    wf = yaml.safe_load((mdir / "workflows" / "consultation.yaml").read_text())
    wf["steps"].append({"id": "tip", "agent": "quick_tip", "needs": ["analysis", "profile"]})
    (mdir / "workflows" / "consultation.yaml").write_text(yaml.safe_dump(wf))

    reg = Registry(mdir, CATALOG_DIR)
    eng = Engine(reg, {"llm": None, "offline": OfflineProvider()})
    res = asyncio.run(eng.run("consultation", {"input": {"gender": "men", "self_report": {}}}, reg.tenants["demo"]))
    assert res.ok and "tip" in res.outputs
    assert any(u["id"] == "quick_tip" for u in reg.ui_manifest())


class FakeClaude:
    name = "fake"
    available = True
    vision = True

    def __init__(self, output):
        self.output = output

    async def run(self, agent, ctx):
        if agent.id == "style_recommender":
            return self.output
        raise RuntimeError("only the recommender is faked")


def test_grounding_rejects_invented_style_and_falls_back():
    reg = Registry()
    invented = {"summary": "x", "options": [
        {"style_id": "unicorn-cut", "name": "Unicorn", "match_score": 99, "why": "", "suits": [], "watch_out": "",
         "maintenance": "low", "trim_weeks": 4, "styling_minutes": 1, "how_to_ask": "", "styling_tip": ""}] * 3}
    eng = Engine(reg, {"llm": FakeClaude(invented), "offline": OfflineProvider()})
    res = asyncio.run(eng.run("consultation", {"input": {"gender": "men", "self_report": {}}}, reg.tenants["demo"]))
    assert res.steps["recommendation"].source == "offline-fallback"
    assert all(o["style_id"] != "unicorn-cut" for o in res.outputs["recommendation"]["options"])
    assert res.steps["analysis"].source == "offline-fallback"      # fake raised -> every LLM step still completed
    assert res.ok


def test_workflow_cycle_is_rejected():
    with pytest.raises(ValueError, match="cycle"):
        WorkflowSpec(id="bad", steps=[{"id": "a", "agent": "x", "needs": ["b"]}, {"id": "b", "agent": "x", "needs": ["a"]}])


def test_grounding_filter_blocks_wrong_audience():
    """A real catalog style for the wrong audience is rejected, then the rules take over."""
    reg = Registry()
    wrong = {"summary": "x", "options": [
        {"style_id": sid, "name": sid, "match_score": 90, "why": "", "suits": [], "watch_out": "", "maintenance": "low",
         "trim_weeks": 4, "styling_minutes": 1, "how_to_ask": "", "styling_tip": ""} for sid in ("classic-side-part", "long-layers", "u-cut")]}
    eng = Engine(reg, {"llm": FakeClaude(wrong), "offline": OfflineProvider()})
    res = asyncio.run(eng.run("consultation", {"input": {"gender": "women", "self_report": {}}}, reg.tenants["demo"]))
    assert res.steps["recommendation"].source == "offline-fallback"           # side part is a men's cut
    styles = {s["id"]: s for s in reg.catalog["hairstyles"]["styles"]}
    assert all(styles[o["style_id"]]["audience"] in ("women", "all") for o in res.outputs["recommendation"]["options"])
    # "all" means no restriction: the same answer is accepted
    res2 = asyncio.run(eng.run("consultation", {"input": {"gender": "all", "self_report": {}}}, reg.tenants["demo"]))
    assert res2.steps["recommendation"].source == "fake"
