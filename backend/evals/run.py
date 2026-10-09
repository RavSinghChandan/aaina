"""Evals for Aaina's haircut recommendations: does the AI follow the salon's rules?

    python -m evals.run                 # offline rules, free, used in CI
    python -m evals.run --live          # the real model (AAINA_LLM / backend/.env); costs a few paise
    python -m evals.run --check         # exit 1 if a score is below its floor

Each of the 15 customer profiles goes through the real harness (face analysis,
profile, recommendation) and every recommendation is checked against what the
customer and the catalog allow:

  catalog      every style id exists in the catalog
  audience     no women's cut for a men's consultation, or the other way round
  dislikes     nothing the customer said they dislike
  maintenance  no high-maintenance cut for someone who wants low maintenance
  distinct     three different styles
  language     the summary is written in the customer's script
  model_kept   every AI step's answer passed the harness, at most after one repair (live only)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from app.api.routes import LANGUAGE_NAMES  # noqa: E402
from app.harness import Engine, Registry  # noqa: E402
from app.harness.manifests import WorkflowSpec  # noqa: E402
from app.providers import OfflineProvider, make_llm  # noqa: E402

FLOORS = {"catalog": 1.0, "audience": 1.0, "dislikes": 1.0, "maintenance": 1.0, "distinct": 1.0}
SCRIPTS = {"hi": r"[ऀ-ॿ]", "mr": r"[ऀ-ॿ]", "bn": r"[ঀ-৿]",
           "ta": r"[஀-௿]", "te": r"[ఀ-౿]"}
WORKFLOW = WorkflowSpec(id="eval_recommend", steps=[
    {"id": "analysis", "agent": "face_analyst"},
    {"id": "profile", "agent": "profile_builder"},
    {"id": "recommendation", "agent": "style_recommender", "needs": ["analysis", "profile"]},
])


def _style_text(row: dict) -> str:
    return " ".join(str(row.get(k, "")) for k in ("id", "name", "length", "look")).lower()


def check(profile: dict, rec: dict, catalog: dict, source: str) -> dict[str, bool]:
    rows = {s["id"]: s for s in catalog["hairstyles"]["styles"]}
    ids = [o.get("style_id") for o in rec.get("options", [])]
    known = [rows[i] for i in ids if i in rows]
    want = profile["gender"]
    script = SCRIPTS.get(profile["language"])
    return {
        "catalog": len(known) == len(ids) and len(ids) >= 3,
        "audience": all(r["audience"] in (want, "all") for r in known) if want != "all" else True,
        "dislikes": not any(d.lower() in _style_text(r) for r in known for d in profile["dislikes"]),
        "maintenance": not (profile["maintenance"] == "low" and any(r["maintenance"] == "high" for r in known)),
        "distinct": len(set(ids)) == len(ids),
        # Offline rules write English by design (the app translates its own labels), so only a model is held to this.
        "language": (bool(re.search(script, rec.get("summary", ""))) if script else True) if source not in ("offline", "offline-fallback") else None,
        "model_kept": source not in ("offline-fallback",),
    }


async def run(live: bool) -> dict:
    registry = Registry()
    registry.workflows[WORKFLOW.id] = WORKFLOW
    llm = make_llm() if live else None
    if live and (llm is None or not llm.available):
        raise SystemExit("--live needs AAINA_LLM and its API key (backend/.env)")
    engine = Engine(registry, {"llm": llm, "offline": OfflineProvider(), "image": None})
    tenant = next(iter(registry.tenants.values()))
    profiles = [json.loads(l) for l in (HERE / "profiles.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    gate = asyncio.Semaphore(5)

    async def one(p: dict) -> dict:
        answers = {k: v for k, v in p.items() if k != "id"} | {"language": LANGUAGE_NAMES[p["language"]]}
        async with gate:
            t0 = time.perf_counter()
            result = await engine.run(WORKFLOW.id, {"input": answers, "images": {}, "today": "2026-10-09"}, tenant)
        step = result.steps["recommendation"]
        rec = result.outputs.get("recommendation") or {}
        checks = check(p, rec, registry.catalog, step.source or "")
        # Every AI step's own answer passed the harness, possibly after one repair, without falling back to rules.
        checks["model_kept"] = None if not live else not any(s.source == "offline-fallback" for s in result.steps.values())
        return {"id": p["id"], "source": step.source, "ms": int((time.perf_counter() - t0) * 1000),
                "checks": checks,
                "styles": [o.get("style_id") for o in rec.get("options", [])], "error": step.error}

    rows = await asyncio.gather(*(one(p) for p in profiles))
    names = list(rows[0]["checks"])
    scores = {}
    for n in names:
        applied = [r["checks"][n] for r in rows if r["checks"][n] is not None]
        scores[n] = round(sum(applied) / len(applied), 3) if applied else None
    return {"mode": "live" if live else "offline", "model": getattr(llm, "name", "offline rules"),
            "profiles": len(rows), "scores": scores, "repairs": engine.repairs, "repaired": engine.repaired,
            "p50_ms": sorted(r["ms"] for r in rows)[len(rows) // 2],
            "failures": [r for r in rows if any(v is False for v in r["checks"].values())]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    if args.live:
        from app.main import load_env_file
        load_env_file()
    res = asyncio.run(run(args.live))
    (HERE / f"results_{res['mode']}.json").write_text(json.dumps(res, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{res['mode']} ({res['model']}), {res['profiles']} customers, p50 {res['p50_ms']} ms, "
          f"{res['repairs']} answers sent back for a fix, {res['repaired']} fixed")
    for k, v in res["scores"].items():
        print(f"  {k:<12} {'n/a offline' if v is None else f'{v:.0%}'}")
    for f in res["failures"]:
        print("  fail:", f["id"], [k for k, v in f["checks"].items() if v is False], f["styles"], f["error"] or "")
    below = [k for k, floor in FLOORS.items() if res["scores"][k] is not None and res["scores"][k] < floor]
    if args.check and below:
        print("Below floor:", ", ".join(below))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
