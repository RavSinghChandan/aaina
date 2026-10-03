"""DeepSeek provider for `kind: llm` agents (text only - DeepSeek cannot see images).

Uses DeepSeek's OpenAI-compatible chat API in JSON mode. The agent's schema is
written into the instructions; the engine validates every answer against it
and falls back to the offline rule if the JSON is wrong, so a loose answer can
never reach a customer.
"""
from __future__ import annotations

import json
import os
from typing import Any

import httpx

from ..harness.manifests import AgentSpec
from ..harness.schema import strictify
from ..harness.templating import render


class DeepSeekProvider:
    name = "deepseek"
    vision = False

    def __init__(self, api_key: str | None = None, base_url: str | None = None, model: str | None = None,
                 transport: httpx.AsyncBaseTransport | None = None):
        self.api_key = api_key if api_key is not None else os.getenv("DEEPSEEK_API_KEY", "")
        self.base_url = (base_url or os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")).rstrip("/")
        self.model = model or os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
        self.available = bool(self.api_key)
        self._transport = transport

    async def run(self, agent: AgentSpec, ctx: dict[str, Any]) -> Any:
        if not self.available:
            raise RuntimeError("DeepSeek is not configured (DEEPSEEK_API_KEY missing)")
        system = render(agent.system, ctx) if agent.system else "You are Aaina, a salon consultation assistant."
        if agent.output_schema:
            system += (
                "\n\nReply with a single JSON object only - no prose, no markdown fences. "
                "It must match this JSON schema exactly (every listed property present, no extra keys):\n"
                + json.dumps(strictify(agent.output_schema), ensure_ascii=False)
            )
        body: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": render(agent.prompt, ctx)}],
            "max_tokens": min(agent.max_tokens, 8000),
            "stream": False,
        }
        if agent.output_schema:
            body["response_format"] = {"type": "json_object"}

        async with httpx.AsyncClient(base_url=self.base_url, timeout=90.0, transport=self._transport) as client:
            for attempt in range(2):                      # one retry for transient network or 5xx errors
                try:
                    r = await client.post("/chat/completions", json=body, headers={"Authorization": f"Bearer {self.api_key}"})
                except httpx.TransportError as exc:
                    if attempt:
                        raise RuntimeError("DeepSeek unreachable") from exc
                    continue
                if r.status_code >= 500 and not attempt:
                    continue
                break
        if r.status_code == 401:
            raise RuntimeError("DeepSeek rejected the API key (401)")
        if r.status_code == 402:
            raise RuntimeError("DeepSeek account has no balance (402)")
        if r.status_code == 429:
            raise RuntimeError("DeepSeek rate limited (429)")
        if r.status_code >= 400:
            raise RuntimeError(f"DeepSeek error {r.status_code}: {r.text[:200]}")

        choice = r.json()["choices"][0]
        if choice.get("finish_reason") == "length":
            raise RuntimeError("DeepSeek hit max_tokens before finishing")
        text = (choice["message"].get("content") or "").strip()
        if not agent.output_schema:
            return {"text": text}
        if text.startswith("```"):                       # defensive: strip fences if the model adds them
            text = text.strip("`").split("\n", 1)[-1].rsplit("```", 1)[0]
        return json.loads(text)
