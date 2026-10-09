"""JSON-schema helpers.

Manifest authors write plain schemas. `strictify` makes them suitable for
structured outputs (every object closed, every property required), and
`validate` checks any provider's output against the same schema, so offline
rules and the LLM are held to one contract.
"""
from __future__ import annotations

import copy
from typing import Any


def strictify(schema: dict[str, Any]) -> dict[str, Any]:
    s = copy.deepcopy(schema)

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        if node.get("type") == "object" or "properties" in node:
            props = node.get("properties", {})
            node["additionalProperties"] = False
            node["required"] = list(props.keys())
            for v in props.values():
                walk(v)
        if "items" in node:
            walk(node["items"])
        for key in ("anyOf", "oneOf", "allOf"):
            for sub in node.get(key, []):
                walk(sub)

    walk(s)
    return s


_TYPES = {
    "string": str, "integer": int, "number": (int, float), "boolean": bool,
    "array": list, "object": dict, "null": type(None),
}


def coerce(value: Any, schema: dict[str, Any]) -> Any:
    """Turn a whole-number float into an int where the schema asks for an integer.

    Models often write 92.0 for 92; that is the same value, not a broken answer.
    Nothing else changes: a real fraction such as 92.5 still fails validation.
    """
    t = schema.get("type")
    types = t if isinstance(t, list) else [t]
    if "integer" in types and isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        props = schema.get("properties", {})
        return {k: coerce(v, props[k]) if k in props else v for k, v in value.items()}
    if isinstance(value, list) and "items" in schema:
        return [coerce(v, schema["items"]) for v in value]
    return value


def validate(value: Any, schema: dict[str, Any], path: str = "$") -> list[str]:
    """Return a list of problems; empty means valid. Covers the subset we use."""
    errs: list[str] = []
    t = schema.get("type")
    if t:
        types = t if isinstance(t, list) else [t]
        py = tuple(x for name in types for x in (_TYPES[name] if isinstance(_TYPES[name], tuple) else (_TYPES[name],)))
        if isinstance(value, bool) and "boolean" not in types and ("integer" in types or "number" in types):
            errs.append(f"{path}: expected {t}, got boolean")
            return errs
        if not isinstance(value, py):
            errs.append(f"{path}: expected {t}, got {type(value).__name__}")
            return errs
    if "enum" in schema and value not in schema["enum"]:
        errs.append(f"{path}: {value!r} not in {schema['enum']}")
    if isinstance(value, dict):
        for req in schema.get("required", schema.get("properties", {}).keys()):
            if req not in value:
                errs.append(f"{path}: missing '{req}'")
        for k, sub in schema.get("properties", {}).items():
            if k in value:
                errs.extend(validate(value[k], sub, f"{path}.{k}"))
    if isinstance(value, list) and "items" in schema:
        if "minItems" in schema and len(value) < schema["minItems"]:
            errs.append(f"{path}: needs at least {schema['minItems']} items")
        for i, item in enumerate(value):
            errs.extend(validate(item, schema["items"], f"{path}[{i}]"))
    return errs


def _collect(node: Any, parts: list[str]) -> list[Any]:
    if not parts:
        return node if isinstance(node, list) else [node]
    if isinstance(node, list):
        return [v for item in node for v in _collect(item, parts)]
    if isinstance(node, dict) and parts[0] in node:
        return _collect(node[parts[0]], parts[1:])
    return []


def check_grounding(output: Any, grounds: list[Any], catalog: dict[str, Any], ctx: dict[str, Any] | None = None) -> list[str]:
    """Every value at `field` must exist as `key` in the catalog and be one the customer allows."""
    problems: list[str] = []
    ctx = ctx or {}
    for g in grounds:
        rows = _rows(g, catalog)
        allowed = allowed_rows(g, catalog, ctx)
        for value in _collect(output, g.field.split(".")):
            row = rows.get(value)
            if row is None:
                problems.append(f"{g.field}={value!r} is not in catalog {g.catalog}")
            elif value not in allowed:
                problems.append(f"{g.field}={value!r} is not allowed: {_why_not(g, row, ctx) or 'filtered out'}")
    return problems


def allowed_rows(g: Any, catalog: dict[str, Any], ctx: dict[str, Any]) -> dict[Any, dict[str, Any]]:
    """The catalog rows this customer may be offered, by key.

    The filter (e.g. audience) is a hard rule. Preferences (avoid, cap) are
    applied too, unless together they would leave fewer than `min_choices` rows;
    then they are relaxed rather than return too few options.
    """
    rows = _rows(g, catalog)
    hard = {k: r for k, r in rows.items() if not _why_not(g, r, ctx, preferences=False)}
    strict = {k: r for k, r in hard.items() if not _why_not(g, r, ctx)}
    return strict if len(strict) >= getattr(g, "min_choices", 0) else hard


def narrow_catalog(catalog: dict[str, Any], grounds: list[Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """A copy of the catalog holding only the rows each ground allows, so a model never sees the rest."""
    out = copy.deepcopy(catalog)
    for g in grounds:
        allowed = allowed_rows(g, catalog, ctx)
        *parent, leaf = g.catalog.split(".")
        node = out
        for part in parent:
            node = node.get(part, {}) if isinstance(node, dict) else {}
        if isinstance(node, dict) and isinstance(node.get(leaf), list):
            node[leaf] = [r for r in node[leaf] if isinstance(r, dict) and r.get(g.key) in allowed]
    return out


def _rows(g: Any, catalog: dict[str, Any]) -> dict[Any, dict[str, Any]]:
    return {row.get(g.key): row for row in _collect(catalog, g.catalog.split(".")) if isinstance(row, dict)}


def _why_not(g: Any, row: dict[str, Any], ctx: dict[str, Any], preferences: bool = True) -> str | None:
    for fname, vals in (getattr(g, "filter", None) or {}).items():
        allowed = _resolve_allowed(vals, ctx)
        if allowed is not None and row.get(fname) not in allowed:
            return f"{fname}={row.get(fname)!r}, allowed {sorted(allowed)}"
    if not preferences:
        return None
    if getattr(g, "avoid", None):
        words = _resolve(g.avoid, ctx) or []
        text = " ".join(str(row.get(f, "")) for f in g.avoid_fields).lower()
        hit = next((w for w in words if isinstance(w, str) and w.strip() and w.lower().strip() in text), None)
        if hit:
            return f"the customer dislikes {hit!r}"
    cap = getattr(g, "cap", None)
    if cap is not None:
        level = _resolve(cap.value, ctx)
        if level in cap.order and row.get(cap.field) in cap.order:
            if cap.order.index(row[cap.field]) > cap.order.index(level) + cap.slack:
                return f"{cap.field}={row[cap.field]!r} is above the customer's {level!r}"
    return None


def _resolve(value: Any, ctx: dict[str, Any]) -> Any:
    if not (isinstance(value, str) and value.startswith("$")):
        return value
    node: Any = ctx
    for part in value[1:].split("."):
        node = node.get(part) if isinstance(node, dict) else None
    return node


def _resolve_allowed(values: list[str], ctx: dict[str, Any]) -> set[Any] | None:
    out: set[Any] = set()
    for v in values:
        if isinstance(v, str) and v.startswith("$"):
            node: Any = ctx
            for part in v[1:].split("."):
                node = node.get(part) if isinstance(node, dict) else None
            if node in (None, "", "all"):
                return None          # customer gave no restriction
            out.add(node)
        else:
            out.add(v)
    return out
