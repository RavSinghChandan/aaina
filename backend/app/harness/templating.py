"""Tiny, safe template renderer for agent prompts.

`{{ path.to.value }}` is replaced with the value at that path in the context.
Dicts and lists are rendered as compact JSON so the model sees structured data.
No code execution, no filters - prompts stay data, not programs.
"""
from __future__ import annotations

import json
import re
from typing import Any

_TOKEN = re.compile(r"\{\{\s*([a-zA-Z0-9_.\-]+)\s*\}\}")
_MISSING = object()


def lookup(context: dict[str, Any], path: str) -> Any:
    node: Any = context
    for part in path.split("."):
        if isinstance(node, dict) and part in node:
            node = node[part]
        elif isinstance(node, list) and part.isdigit() and int(part) < len(node):
            node = node[int(part)]
        else:
            return _MISSING
    return node


def render(template: str, context: dict[str, Any]) -> str:
    def repl(m: re.Match[str]) -> str:
        value = lookup(context, m.group(1))
        if value is _MISSING or value is None:
            return "(not provided)"
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        return str(value)

    return _TOKEN.sub(repl, template)


def truthy(context: dict[str, Any], expr: str | None) -> bool:
    """Evaluate a workflow `when:` condition: 'a.b' or 'not a.b'."""
    if not expr:
        return True
    expr = expr.strip()
    negate = expr.startswith("not ")
    value = lookup(context, expr[4:].strip() if negate else expr)
    result = bool(value) and value is not _MISSING
    return not result if negate else result
