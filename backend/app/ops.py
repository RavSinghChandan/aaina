"""What the running service is doing, for the owner's ops panel.

In memory, since the process started: API traffic, errors and latency per
route; and for every consultation, each agent step's latency and whether the
model's answer was kept, repaired or replaced by the offline rule. A free
instance restarts often, so this is a live view, not a history.
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from typing import Any

_SAMPLES = 500
_lock = threading.Lock()
_started = time.time()
_routes: dict[str, dict[str, Any]] = defaultdict(lambda: {"count": 0, "client_errors": 0, "server_errors": 0, "ms": deque(maxlen=_SAMPLES)})
_agents: dict[str, dict[str, Any]] = defaultdict(lambda: {"runs": 0, "failed": 0, "sources": defaultdict(int), "ms": deque(maxlen=_SAMPLES)})
_runs = {"total": 0, "failed": 0}
_salons: dict[str, int] = defaultdict(int)
_salon_day = {"day": ""}


def _pct(samples: deque, p: float) -> int | None:
    if not samples:
        return None
    ordered = sorted(samples)
    return int(ordered[min(len(ordered) - 1, int(p * len(ordered)))])


def record_request(route: str, status: int, ms: float) -> None:
    with _lock:
        r = _routes[route]
        r["count"] += 1
        r["ms"].append(ms)
        if status >= 500:
            r["server_errors"] += 1
        elif status >= 400:
            r["client_errors"] += 1


def record_run(salon: str, result: dict[str, Any]) -> None:
    """One finished workflow run (RunResult.to_dict())."""
    with _lock:
        _runs["total"] += 1
        _runs["failed"] += 0 if result.get("ok") else 1
        today = time.strftime("%Y-%m-%d")
        if _salon_day["day"] != today:
            _salons.clear()
            _salon_day["day"] = today
        _salons[salon] += 1
        for step, info in (result.get("steps") or {}).items():
            if info.get("status") == "skipped":
                continue
            a = _agents[step]
            a["runs"] += 1
            a["failed"] += 1 if info.get("status") == "failed" else 0
            a["sources"][info.get("source") or "none"] += 1
            a["ms"].append(info.get("ms") or 0)


def snapshot(repairs: int = 0, repaired: int = 0) -> dict[str, Any]:
    with _lock:
        routes = [{"route": k, "count": v["count"], "client_errors": v["client_errors"], "server_errors": v["server_errors"],
                   "p50_ms": _pct(v["ms"], 0.5), "p95_ms": _pct(v["ms"], 0.95)} for k, v in _routes.items()]
        total = sum(r["count"] for r in routes)
        agents = []
        for k, v in _agents.items():
            fallbacks = v["sources"].get("offline-fallback", 0)
            model = sum(n for s, n in v["sources"].items() if s not in ("offline", "offline-fallback", "image", "none"))
            agents.append({"step": k, "runs": v["runs"], "failed": v["failed"], "sources": dict(v["sources"]),
                           "fallback_rate": round(fallbacks / (model + fallbacks), 3) if model + fallbacks else 0.0,
                           "p50_ms": _pct(v["ms"], 0.5), "p95_ms": _pct(v["ms"], 0.95)})
        return {
            "uptime_s": int(time.time() - _started),
            "requests": total,
            "server_error_rate": round(sum(r["server_errors"] for r in routes) / total, 4) if total else 0.0,
            "routes": sorted(routes, key=lambda r: -r["count"]),
            "consultations": dict(_runs),
            "agents": sorted(agents, key=lambda a: a["step"]),
            "repairs": {"sent_back": repairs, "fixed": repaired},
            "salons_today": dict(sorted(_salons.items(), key=lambda kv: -kv[1])),
        }


def reset() -> None:
    """For tests."""
    with _lock:
        _routes.clear()
        _agents.clear()
        _salons.clear()
        _runs.update(total=0, failed=0)
