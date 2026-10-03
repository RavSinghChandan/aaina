"""Claude provider: vision + reasoning for `kind: llm` agents.

The agent manifest supplies everything: system prompt, user prompt template,
whether the customer photo is attached, and the JSON schema the answer must
follow (enforced with structured outputs). This file never names an agent.
"""
from __future__ import annotations

import json
import os
from typing import Any

import anthropic

from ..harness.manifests import AgentSpec
from ..harness.schema import strictify
from ..harness.templating import render

DEFAULT_MODEL = "claude-opus-5-5"
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class ClaudeRefusal(RuntimeError):
    pass


class ClaudeProvider:
    def __init__(self, model: str | None = None, api_key: str | None = None, http_client: Any = None):
        self.model = model or os.getenv("AAINA_MODEL", DEFAULT_MODEL)
        key = api_key if api_key is not None else os.getenv("ANTHROPIC_API_KEY")
        self.available = bool(key)
        extra = {"http_client": http_client} if http_client is not None else {}
        self._client = anthropic.AsyncAnthropic(api_key=key, timeout=120.0, max_retries=2, **extra) if key else None

    async def run(self, agent: AgentSpec, ctx: dict[str, Any]) -> Any:
        if not self._client:
            raise RuntimeError("Claude is not configured (ANTHROPIC_API_KEY missing)")

        content: list[dict[str, Any]] = []
        if agent.needs_image:
            for img in _images(ctx):
                content.append({"type": "image", "source": {"type": "base64", "media_type": img["media_type"], "data": img["data"]}})
        content.append({"type": "text", "text": render(agent.prompt, ctx)})

        system_text = render(agent.system, ctx) if agent.system else "You are Aaina, a salon consultation assistant."
        kwargs: dict[str, Any] = dict(
            model=self.model,
            max_tokens=agent.max_tokens,
            betas=[FALLBACK_BETA],
            fallbacks="default",
            # Stable instructions first, cached; the per-customer prompt follows.
            system=[{"type": "text", "text": system_text, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": content}],
            output_config={"effort": agent.effort},
        )
        if agent.output_schema:
            kwargs["output_config"]["format"] = {"type": "json_schema", "schema": strictify(agent.output_schema)}

        try:
            response = await self._client.beta.messages.create(**kwargs)
        except anthropic.RateLimitError as exc:
            raise RuntimeError(f"Claude rate limited: {exc.message}") from exc
        except anthropic.APIStatusError as exc:
            raise RuntimeError(f"Claude API error {exc.status_code}: {exc.message}") from exc
        except anthropic.APIConnectionError as exc:
            raise RuntimeError("Claude unreachable") from exc

        if response.stop_reason == "refusal":
            raise ClaudeRefusal(f"declined ({getattr(response.stop_details, 'category', None)})")
        if response.stop_reason == "max_tokens":
            raise RuntimeError("Claude hit max_tokens before finishing")
        text = next((b.text for b in response.content if b.type == "text"), "")
        if not agent.output_schema:
            return {"text": text}
        return json.loads(text)


def _images(ctx: dict[str, Any]) -> list[dict[str, str]]:
    imgs = ctx.get("images") or {}
    out = []
    if imgs.get("photo"):
        out.append(imgs["photo"])
    out.extend(imgs.get("extra") or [])
    return out[:5]
