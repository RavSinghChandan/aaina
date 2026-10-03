"""Deterministic rules - Aaina's offline brain.

Each rule takes the workflow context and returns output matching its agent's
schema. Used when no AI key is configured, when the AI fails, and for agents
that are rules by nature (the care calendar). Agents name their rule in YAML.
"""
from __future__ import annotations

import datetime as dt
import re
from typing import Any, Callable

from .images import render_previews

RULES: dict[str, Callable[[dict[str, Any]], Any]] = {}


def rule(name: str):
    def deco(fn):
        RULES[name] = fn
        return fn
    return deco


def _input(ctx: dict[str, Any]) -> dict[str, Any]:
    return ctx.get("input") or {}


def _self(ctx: dict[str, Any]) -> dict[str, Any]:
    return _input(ctx).get("self_report") or {}


def _styles(ctx: dict[str, Any]) -> list[dict[str, Any]]:
    return (ctx.get("catalog") or {}).get("hairstyles", {}).get("styles", [])


def _routines(ctx: dict[str, Any]) -> dict[str, Any]:
    return (ctx.get("catalog") or {}).get("routines", {})


AUDIENCE = {"women": "women", "female": "women", "woman": "women", "men": "men", "male": "men", "man": "men"}

PROFESSION_WORDS = {
    "corporate": ["bank", "it", "software", "engineer", "consult", "office", "manager", "sales", "finance", "lawyer", "ca", "analyst", "corporate"],
    "creative": ["design", "artist", "media", "film", "music", "content", "creator", "influencer", "fashion", "photograph", "creative", "actor", "model"],
    "healthcare": ["doctor", "nurse", "hospital", "clinic", "pharma", "health", "dentist"],
    "uniformed": ["police", "army", "navy", "air force", "security", "pilot", "cabin", "defence", "uniform"],
    "student": ["student", "college", "school", "university"],
    "homemaker": ["homemaker", "home maker", "housewife", "house wife"],
    "athletic": ["gym", "athlete", "sport", "trainer", "fitness", "coach", "dancer"],
}


def profession_fit(text: str | None) -> str:
    t = f" {(text or '').lower()} "
    for fit, words in PROFESSION_WORDS.items():
        if any(re.search(rf"\b{re.escape(w)}", t) for w in words):
            return fit
    return "any"


@rule("face_analyst")
def face_analyst(ctx: dict[str, Any]) -> dict[str, Any]:
    sr, inp = _self(ctx), _input(ctx)
    shapes = {"oval", "round", "square", "heart", "oblong", "diamond", "triangle"}
    pm = inp.get("photo_measure") if isinstance(inp.get("photo_measure"), dict) else {}
    measured = pm.get("face_shape") if pm.get("face_shape") in shapes else None
    face = sr.get("face_shape") if sr.get("face_shape") in shapes else (measured or "oval")
    from_photo = measured is not None and face == measured
    hair_type = sr.get("hair_type") if sr.get("hair_type") in {"straight", "wavy", "curly", "coily"} else "straight"
    density = sr.get("hair_density") if sr.get("hair_density") in {"fine", "medium", "thick"} else "medium"
    length = inp.get("hair_length_now") if inp.get("hair_length_now") in {"short", "medium", "long"} else "medium"
    skin = sr.get("skin_type") if sr.get("skin_type") in {"oily", "dry", "combination", "normal", "sensitive"} else "unknown"
    return {
        "face_shape": face,
        "face_shape_confidence": round(float(pm.get("confidence") or 0.7), 2) if from_photo else (0.6 if sr.get("face_shape") else 0.4),
        "features": [f"{face.capitalize()} face shape ({'measured from your photo' if from_photo else 'from your answers'})"]
                    + [str(x) for x in (pm.get("notes") or [])[:3] if from_photo],
        "hair": {"type": hair_type, "density": density, "length": length,
                 "texture_notes": f"{density.capitalize()}, {hair_type} hair",
                 "visible_concerns": list(sr.get("hair_concerns") or [])},
        "skin": {"type": skin, "visible_concerns": list(sr.get("skin_concerns") or [])},
        "beard": {"present": bool(inp.get("has_beard")), "notes": "Beard care included" if inp.get("has_beard") else ""},
        "photo_quality": pm.get("quality") if pm.get("quality") in {"good", "ok", "poor"} else "ok",
        "notes": ("Face shape measured on your device from 478 face points; hair and skin from your answers."
                  if from_photo else "Based on your answers."),
    }


@rule("profile_builder")
def profile_builder(ctx: dict[str, Any]) -> dict[str, Any]:
    inp = _input(ctx)
    audience = AUDIENCE.get(str(inp.get("gender", "")).lower(), "all")
    fit = profession_fit(inp.get("profession"))
    vibes = [v for v in (inp.get("vibes") or []) if v in {"classic", "modern", "bold", "low-key", "romantic", "edgy", "professional"}] or ["classic", "modern"]
    maint = inp.get("maintenance") if inp.get("maintenance") in {"low", "medium", "high"} else "medium"
    constraints = []
    if fit in ("corporate", "uniformed", "healthcare"):
        constraints.append("Needs a work-appropriate, tidy look")
    if maint == "low":
        constraints.append("Little time for styling")
    concerns = list((_self(ctx).get("hair_concerns") or [])) + list((_self(ctx).get("skin_concerns") or []))
    who = inp.get("name") or "You"
    job = inp.get("profession") or "your work"
    return {
        "headline": f"{who}: {', '.join(vibes[:2])} style for {job}, {maint}-maintenance",
        "audience": audience,
        "profession_fit": fit,
        "style_personality": vibes,
        "maintenance_appetite": maint,
        "lifestyle": list(inp.get("lifestyle") or []),
        "likes": list(inp.get("likes") or []),
        "dislikes": list(inp.get("dislikes") or []),
        "constraints": constraints,
        "care_priorities": [c.replace("_", " ") for c in concerns] or ["Healthy, easy-to-manage hair"],
    }


_MAINT = {"low": 0, "medium": 1, "high": 2}


def score_style(style: dict[str, Any], analysis: dict[str, Any], profile: dict[str, Any], inp: dict[str, Any]) -> tuple[int, list[str]]:
    audience = profile.get("audience", "all")
    if audience != "all" and style["audience"] not in (audience, "all"):
        return -999, []
    blob = f"{style['name']} {style['length']} {' '.join(style.get('vibes', []))} {style['id']}".lower()
    for d in profile.get("dislikes") or []:
        if d and d.lower().strip() in blob:
            return -999, []
    score, suits = 40, []
    hair = analysis.get("hair", {})
    if analysis.get("face_shape") in style.get("face_shapes", []):
        score += 30
        suits.append(f"{analysis['face_shape']} face")
    if hair.get("type") in style.get("hair_types", []):
        score += 25
        suits.append(f"{hair['type']} hair")
    else:
        score -= 20
    fit = profile.get("profession_fit", "any")
    if fit in style.get("professions", []) or "any" in style.get("professions", []):
        score += 12
        if fit != "any":
            suits.append(f"{fit} work")
    overlap = set(profile.get("style_personality") or []) & set(style.get("vibes", []))
    score += min(15, 5 * len(overlap))
    want, need = _MAINT.get(profile.get("maintenance_appetite", "medium"), 1), _MAINT.get(style.get("maintenance"), 1)
    score += 10 if want == need else (-15 if need > want else 4)
    if want == need:
        suits.append(f"{style['maintenance']} maintenance")
    for like in profile.get("likes") or []:
        if like and like.lower().strip() in blob:
            score += 10
    goals = " ".join(inp.get("hair_goals") or []).lower()
    if "keep length" in goals and style["length"] == "short":
        score -= 25
    if "go short" in goals and style["length"] == "short":
        score += 10
    if hair.get("density") == "fine" and style["id"] in ("pompadour", "wolf-cut"):
        score -= 10
    return score, suits


@rule("style_recommender")
def style_recommender(ctx: dict[str, Any]) -> dict[str, Any]:
    analysis, profile, inp = ctx.get("analysis") or {}, ctx.get("profile") or {}, _input(ctx)
    scored = []
    for s in _styles(ctx):
        sc, suits = score_style(s, analysis, profile, inp)
        if sc > -999:
            scored.append((sc, s, suits))
    scored.sort(key=lambda t: (-t[0], t[1]["id"]))
    top = scored[:3]
    if len(top) < 3:  # relax dislikes rather than return fewer than three
        extra = [s for s in _styles(ctx) if s["id"] not in {t[1]["id"] for t in top}]
        top += [(40, s, []) for s in extra[: 3 - len(top)]]
    best = max((t[0] for t in top), default=100) or 100
    options = []
    for sc, s, suits in top:
        options.append({
            "style_id": s["id"],
            "name": s["name"],
            "match_score": int(max(55, min(97, 60 + 37 * sc / max(best, 1)))),
            "why": s["why"],
            "suits": suits or ["your profile"],
            "watch_out": f"Needs a trim about every {s['trim_weeks']} weeks to keep its shape.",
            "maintenance": s["maintenance"],
            "trim_weeks": int(s["trim_weeks"]),
            "styling_minutes": int(s["styling_minutes"]),
            "how_to_ask": s["how_to_ask"],
            "styling_tip": _routines(ctx).get("hair", {}).get("styling", {}).get((analysis.get("hair") or {}).get("type", "straight"), ""),
        })
    shape = analysis.get("face_shape", "your")
    return {"summary": f"Three cuts chosen for a {shape} face, {(analysis.get('hair') or {}).get('type', 'your')} hair and your lifestyle.", "options": options}


@rule("style_previews")
def style_previews(ctx: dict[str, Any]) -> dict[str, Any]:
    by_id = {s["id"]: s for s in _styles(ctx)}
    options = (ctx.get("recommendation") or {}).get("options", [])
    return {"previews": render_previews(options, by_id, ctx.get("analysis") or {})}


def _steps(items: list[dict[str, Any]]) -> list[dict[str, str]]:
    return [{"step": i["step"], "why": i.get("why", "")} for i in items]


@rule("hair_care_planner")
def hair_care_planner(ctx: dict[str, Any]) -> dict[str, Any]:
    hair = _routines(ctx).get("hair", {})
    analysis = ctx.get("analysis") or {}
    concerns = set((analysis.get("hair") or {}).get("visible_concerns") or []) | set(_self(ctx).get("hair_concerns") or [])
    daily, weekly, monthly = [], [], []
    for item in hair.get("base", []):
        (weekly if "week" in item["when"].lower() else daily).append(item)
    products = [{"type": "Shampoo", "look_for": "Mild, sulphate-free", "why": "Cleans without stripping"}]
    for c in sorted(concerns):
        for item in hair.get("concerns", {}).get(c, []):
            when = item["when"].lower()
            (monthly if "week" in when and any(n in when for n in ("8", "10", "month")) else weekly if "week" in when else daily).append(item)
        if c == "dandruff":
            products.append({"type": "Anti-dandruff shampoo", "look_for": "Zinc pyrithione or ketoconazole", "why": "Controls flaking"})
        if c == "frizz":
            products.append({"type": "Leave-in / serum", "look_for": "Light silicone or argan oil", "why": "Seals the cuticle"})
    top = ((ctx.get("recommendation") or {}).get("options") or [{}])[0]
    trim = int(top.get("trim_weeks") or 8)
    monthly.append({"step": f"Trim to keep your {top.get('name', 'cut')} sharp (every {trim} weeks)", "why": "Holds the shape"})
    hair_type = (analysis.get("hair") or {}).get("type", "straight")
    family = str(_input(ctx).get("family_hair_history") or "").lower()
    note = "Grooming guidance, not medical advice."
    if "thin" in family or "fall" in family:
        note += " With a family history of thinning, start gentle scalp care early and see a dermatologist if you notice change."
    return {
        "daily": _steps(daily), "weekly": _steps(weekly), "monthly": _steps(monthly),
        "products": products,
        "styling": hair.get("styling", {}).get(hair_type, ""),
        "salon_visits": [{"service": "Haircut / trim", "every_weeks": trim}, {"service": "Hair spa", "every_weeks": 4}],
        "note": note,
    }


@rule("skin_care_planner")
def skin_care_planner(ctx: dict[str, Any]) -> dict[str, Any]:
    skin = _routines(ctx).get("skin", {})
    analysis = ctx.get("analysis") or {}
    stype = (analysis.get("skin") or {}).get("type") or _self(ctx).get("skin_type") or "normal"
    if stype not in skin.get("types", {}):
        stype = "normal"
    t = skin["types"][stype]
    morning = [{"step": t["cleanser"], "why": "Suits your skin type"}] + _steps(skin.get("base", {}).get("am", [])[1:])
    night = _steps(skin.get("base", {}).get("pm", [])[:1]) + [{"step": t["moisturiser"], "why": "Repairs overnight"}]
    concerns = set((analysis.get("skin") or {}).get("visible_concerns") or []) | set(_self(ctx).get("skin_concerns") or [])
    weekly = [{"step": skin["concerns"][c]["step"], "why": skin["concerns"][c]["why"]} for c in sorted(concerns) if c in skin.get("concerns", {})]
    beard = bool((analysis.get("beard") or {}).get("present")) or bool(_input(ctx).get("has_beard"))
    if beard:
        b = skin["concerns"]["beard_care"]
        weekly.append({"step": b["step"], "why": b["why"]})
    return {
        "skin_type": stype,
        "morning": morning, "night": night, "weekly": weekly,
        "products": [{"type": "Sunscreen", "look_for": "SPF 30+, PA+++", "why": "Daily protection in Indian sun"},
                     {"type": "Cleanser", "look_for": t["cleanser"], "why": f"For {stype} skin"}],
        "note": "Grooming guidance, not medical advice. See a dermatologist for severe acne or persistent problems.",
    }


@rule("care_calendar")
def care_calendar(ctx: dict[str, Any]) -> dict[str, Any]:
    inp = _input(ctx)
    options = (ctx.get("recommendation") or {}).get("options") or []
    chosen_id = inp.get("chosen_style_id") or (options[0]["style_id"] if options else None)
    chosen = next((o for o in options if o["style_id"] == chosen_id), options[0] if options else {"name": "your cut", "trim_weeks": 8})
    today = dt.date.fromisoformat(str(ctx.get("today"))[:10]) if ctx.get("today") else dt.date.today()
    trim_days = int(chosen.get("trim_weeks") or 8) * 7

    def ev(days: int, title: str, kind: str, detail: str) -> dict[str, Any]:
        return {"in_days": days, "date": (today + dt.timedelta(days=days)).isoformat(), "title": title, "kind": kind, "detail": detail}

    events = [
        ev(14, "Routine check-in", "check-in", "How is the new routine going? Adjust products if needed."),
        ev(28, "Hair spa", "spa", "Deep conditioning keeps the cut looking healthy."),
        ev(trim_days, f"Trim your {chosen.get('name', 'cut')}", "trim", f"Every {trim_days // 7} weeks keeps the shape sharp."),
        ev(trim_days * 2, f"Next trim + refresh", "trim", "Good time to review the look and try a variation."),
    ]
    for v in ((ctx.get("hair_care") or {}).get("salon_visits") or []):
        if "facial" in v.get("service", "").lower():
            events.append(ev(int(v["every_weeks"]) * 7, v["service"], "facial", "Salon service"))
    events.sort(key=lambda e: e["in_days"])
    return {"style_id": chosen.get("style_id", chosen_id or ""), "next_visit_days": min(e["in_days"] for e in events if e["kind"] in ("trim", "spa")), "events": events}
