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


def check_grounding(output: Any, grounds: list[Any], catalog: dict[str, Any]) -> list[str]:
    """Every value at `field` must exist as `key` in the named catalog list."""
    problems: list[str] = []
    for g in grounds:
        allowed_rows = _collect(catalog, g.catalog.split("."))
        allowed = {row.get(g.key) for row in allowed_rows if isinstance(row, dict)}
        for value in _collect(output, g.field.split(".")):
            if value not in allowed:
                problems.append(f"{g.field}={value!r} is not in catalog {g.catalog}")
    return problems
