"""Ops panel, the customer CSV, one-repair-then-fallback, and the offline evals staying above their floors."""
import asyncio
import csv
import io
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import ops
from app.harness import Engine, Registry
from app.main import create_app
from app.providers import OfflineProvider
from tests.test_aaina import consult

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ADMIN_KEY", "test-admin")
    ops.reset()
    app = create_app(database_url=f"sqlite:///{tmp_path}/t.db", llm="offline")
    with TestClient(app) as c:
        yield c


def test_ops_needs_the_admin_key(client):
    assert client.get("/api/admin/ops").status_code == 401


def test_ops_counts_consultations_and_agent_steps(client):
    assert consult(client).status_code == 202
    snap = client.get("/api/admin/ops", headers={"x-admin-key": "test-admin"}).json()
    assert snap["consultations"] == {"total": 1, "failed": 0}
    steps = {a["step"]: a for a in snap["agents"]}
    assert steps["recommendation"]["runs"] == 1
    assert steps["recommendation"]["sources"] == {"offline": 1}
    assert snap["salons_today"] == {"demo": 1}
    assert any(r["route"] == "POST /api/t/{slug}/consultations" for r in snap["routes"])


def test_customer_csv_lists_this_salons_customers(client):
    consult(client)
    res = client.get("/api/t/demo/customers.csv")
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(res.text)))
    assert len(rows) == 1
    assert rows[0]["phone"] == "9000000001" and rows[0]["visits"] == "1"


class FlakyModel:
    """Answers with a style that is not in the catalog first, then a valid one."""
    name, available, vision = "flaky", True, False

    def __init__(self, fix: bool):
        self.calls, self.fix = 0, fix
        self.offline = OfflineProvider()

    async def run(self, agent, ctx):
        self.calls += 1
        out = await self.offline.run(agent, ctx)
        if agent.id == "style_recommender" and (self.calls == 1 or not self.fix) and "rejected" not in agent.prompt:
            out["options"][0]["style_id"] = "not-a-real-style"
        return out


def _recommend(model):
    registry = Registry()
    engine = Engine(registry, {"llm": model, "offline": OfflineProvider(), "image": None})
    tenant = next(iter(registry.tenants.values()))
    ctx = {"input": {"gender": "men", "maintenance": "low", "dislikes": [], "self_report": {}}, "images": {}}
    agent = registry.agents["style_recommender"]
    ctx |= {"analysis": {}, "profile": {}}
    out, source = asyncio.run(engine._execute(agent, ctx, tenant))
    return engine, out, source


def test_a_rejected_answer_gets_one_repair():
    engine, out, source = _recommend(FlakyModel(fix=True))
    assert source == "flaky"
    assert (engine.repairs, engine.repaired) == (1, 1)
    assert all(o["style_id"] != "not-a-real-style" for o in out["options"])


def test_disliked_and_high_upkeep_styles_never_reach_the_customer():
    registry = Registry()
    engine = Engine(registry, {"llm": None, "offline": OfflineProvider(), "image": None})
    tenant = next(iter(registry.tenants.values()))
    agent = registry.agents["style_recommender"]
    ctx = {"input": {"gender": "men", "maintenance": "low", "dislikes": ["fade"], "self_report": {}},
           "images": {}, "analysis": {}, "profile": {"audience": "men"}}
    out, _ = asyncio.run(engine._execute(agent, ctx, tenant))
    rows = {s["id"]: s for s in registry.catalog["hairstyles"]["styles"]}
    picked = [rows[o["style_id"]] for o in out["options"]]
    assert not any("fade" in f"{r['id']} {r['name']} {r['look']}".lower() for r in picked)
    assert not any(r["maintenance"] == "high" for r in picked)


def test_offline_evals_stay_above_their_floors():
    done = subprocess.run([sys.executable, "-m", "evals.run", "--check"], cwd=ROOT, capture_output=True, text=True,
                          env={"AAINA_LLM": "offline", "PATH": ""})
    assert done.returncode == 0, done.stdout + done.stderr
