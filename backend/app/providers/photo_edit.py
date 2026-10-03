"""Photo try-on for `kind: image` agents: each recommended cut, edited onto the
customer's own photo by an image-editing model (OpenAI Images "edits").

The agent's `prompt` is rendered once per option with `option`, `style`,
`input` and `analysis`, so how the edit is described lives in the manifest.
If one picture fails, that option gets the illustrated card instead and is
marked `kind: drawing`; if every picture fails the engine falls back to the
offline rule.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
from typing import Any

import httpx

from ..harness.manifests import AgentSpec
from ..harness.templating import render
from .images import SvgStyleCards

log = logging.getLogger("aaina.photo_edit")


class OpenAIPhotoEdit:
    name = "openai-image"

    def __init__(self, api_key: str | None = None, model: str | None = None, base_url: str | None = None,
                 transport: httpx.AsyncBaseTransport | None = None):
        self.api_key = api_key if api_key is not None else os.getenv("OPENAI_API_KEY", "")
        self.model = model or os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-1.5")
        self.base_url = (base_url or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")).rstrip("/")
        self.quality = os.getenv("OPENAI_IMAGE_QUALITY", "medium")
        self.available = bool(self.api_key)
        self._transport = transport

    async def run(self, agent: AgentSpec, ctx: dict[str, Any]) -> dict[str, Any]:
        photo = (ctx.get("images") or {}).get("photo")
        if not photo:
            raise RuntimeError("no customer photo to edit")
        raw = base64.b64decode(photo["data"])
        styles = {s["id"]: s for s in ((ctx.get("catalog") or {}).get("hairstyles") or {}).get("styles", [])}
        options = ((ctx.get("recommendation") or {}).get("options") or [])[:3]
        analysis = ctx.get("analysis") or {}

        async with httpx.AsyncClient(base_url=self.base_url, timeout=180.0, transport=self._transport) as client:
            results = await asyncio.gather(*(
                self._edit(client, raw, photo["media_type"], render(agent.prompt, {**ctx, "option": o, "style": styles.get(o.get("style_id"), {})}))
                for o in options), return_exceptions=True)

        previews, failures = [], 0
        for o, res in zip(options, results):
            style = styles.get(o.get("style_id"), {})
            if isinstance(res, Exception):
                failures += 1
                log.warning("try-on for %s failed: %s", o.get("style_id"), res)
                previews.append({"style_id": o.get("style_id", ""), "kind": "drawing",
                                 "image": SvgStyleCards().render(o, style, analysis),
                                 "caption": f"Illustration of {o.get('name', 'this cut')} (the photo try-on did not work for this one)"})
            else:
                previews.append({"style_id": o.get("style_id", ""), "kind": "photo", "image": res,
                                 "caption": f"{o.get('name', 'This cut')} on your photo (AI edit)"})
        if options and failures == len(options):
            raise RuntimeError("every photo try-on failed")
        return {"previews": previews}

    async def _edit(self, client: httpx.AsyncClient, raw: bytes, media_type: str, prompt: str) -> str:
        data = {"model": self.model, "prompt": prompt, "size": "1024x1536", "quality": self.quality, "n": "1",
                "output_format": "jpeg", "output_compression": "82"}
        if self.model.startswith("gpt-image-1"):
            data["input_fidelity"] = "high"                 # keep the face as it is
        ext = {"image/png": "png", "image/webp": "webp"}.get(media_type, "jpg")
        for attempt in range(2):
            r = await client.post("/images/edits", headers={"Authorization": f"Bearer {self.api_key}"}, data=data,
                                  files={"image[]": (f"photo.{ext}", raw, media_type)})
            if r.status_code >= 500 and not attempt:
                continue
            break
        if r.status_code == 401:
            raise RuntimeError("OpenAI rejected the API key (401)")
        if r.status_code == 429:
            raise RuntimeError("OpenAI rate limit or no credit (429)")
        if r.status_code >= 400:
            raise RuntimeError(f"OpenAI image error {r.status_code}: {r.text[:200]}")
        b64 = r.json()["data"][0]["b64_json"]
        return "data:image/jpeg;base64," + b64


def make_image_provider():
    """AAINA_IMAGE = auto | openai | off. auto uses OpenAI when OPENAI_API_KEY is set."""
    choice = os.getenv("AAINA_IMAGE", "auto").lower()
    if choice == "off":
        return None
    p = OpenAIPhotoEdit()
    return p if p.available else None
