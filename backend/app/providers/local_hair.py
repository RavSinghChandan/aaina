"""Local photo try-on: repaints only the hair on the customer's own photo with an
open-source Stable Diffusion inpainting model, on this machine (Apple GPU / CUDA / CPU).
Free, no API key, and the photo never leaves the computer.

The phone sends a hair mask and the face outline (`images.geometry`). For each cut
we build an edit mask = current hair + room for the new shape (taller for volume,
longer for long styles) MINUS the face and beard, crop around the head, inpaint,
and blend the result back into the untouched photo.
"""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import os
import threading
from typing import Any

from PIL import Image, ImageChops, ImageDraw, ImageFilter

from ..harness.manifests import AgentSpec
from ..harness.templating import render
from .images import SHAPES, SvgStyleCards

log = logging.getLogger("aaina.local_hair")

MODEL = os.getenv("AAINA_INPAINT_MODEL", "Lykon/dreamshaper-8-inpainting")
NEGATIVE = ("hat, cap, beanie, helmet, headband, hood, turban, cartoon, illustration, painting, drawing, anime, 3d render, "
            "blurry, lowres, deformed, extra head, bald patch, wig, plastic, oversaturated, text, watermark")


def _img(data_url_or_b64: str) -> Image.Image:
    b64 = data_url_or_b64.split(",", 1)[1] if data_url_or_b64.startswith("data:") else data_url_or_b64
    return Image.open(io.BytesIO(base64.b64decode(b64)))


def edit_mask(geom: dict[str, Any], hair: Image.Image, length: str, top: int = 12,
              src: Image.Image | None = None) -> tuple[Image.Image, Image.Image]:
    """(paint, erase) masks at photo size.

    paint: where the new cut may be drawn. The model fills this region with hair, so its
    outline IS the new silhouette: current hair up to the style's height line, an arch
    whose height comes from the catalog (`top`: 4 buzz ... 22 pompadour), and side bands
    for longer styles. Never the face below the eyebrows, never the beard.
    erase: current hair that sticks out beyond the new silhouette; it is removed with a
    classic fill so the old shape cannot leak into the new cut."""
    W, H = int(geom["width"]), int(geom["height"])
    old = hair.convert("L").resize((W, H)).point(lambda v: 255 if v > 127 else 0)
    ux, uy = geom["up"]
    cx0, cx1 = geom["cheek_l"], geom["cheek_r"]
    cw = cx1 - cx0
    face_len = geom["chin"][1] - uy
    brow, nose = geom["brow_y"], geom["nose_y"]
    lift = face_len * (0.03 + top * 0.016)

    shape = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(shape)
    d.ellipse([ux - cw * 0.62, uy - lift, ux + cw * 0.62, brow + face_len * 0.12], fill=255)
    if length in ("ear", "jaw", "neck", "shoulder", "long"):
        drop = {"ear": 0.15, "jaw": 0.35, "neck": 0.6, "shoulder": 0.85, "long": 1.3}[length]
        y1 = geom["chin"][1] + face_len * drop
        d.rectangle([cx0 - cw * 0.42, brow, cx0 + cw * 0.04, y1], fill=255)
        d.rectangle([cx1 - cw * 0.04, brow, cx1 + cw * 0.42, y1], fill=255)
    else:
        # short cuts: the sides hug the head down to the ears
        eye = geom["eye_y"] - (geom["eye_y"] - brow) * 0.35                  # stop above the glasses line
        r = int(cw * 0.05)
        d.rounded_rectangle([cx0 - cw * 0.05, brow - (nose - brow) * 0.3, cx0 + cw * 0.06, eye], radius=r, fill=255)
        d.rounded_rectangle([cx1 - cw * 0.06, brow - (nose - brow) * 0.3, cx1 + cw * 0.05, eye], radius=r, fill=255)

    face = Image.new("L", (W, H), 0)
    fd = ImageDraw.Draw(face)
    fd.polygon([tuple(p) for p in geom["face_oval"]], fill=255)
    fd.rectangle([0, 0, W, brow - (nose - brow) * 0.15], fill=0)           # the forehead above the brows may change

    old_all = old.filter(ImageFilter.MaxFilter(15))
    if src is not None:
        # thin strand tips the hair model misses: anything clearly darker than the backdrop
        # in the zone around the head, outside the face
        lum = src.convert("L")
        corners = [lum.getpixel((x, y)) for x in (2, W - 3) for y in (2, min(H - 3, int(H * 0.05)))]
        bg = sorted(corners)[len(corners) // 2]
        zone = Image.new("L", (W, H), 0)
        ImageDraw.Draw(zone).ellipse([ux - cw * 0.95, uy - face_len * 0.75, ux + cw * 0.95, brow + face_len * 0.05], fill=255)
        dark = lum.point(lambda v: 255 if v < bg - 35 else 0)
        old_all = ImageChops.lighter(old_all, ImageChops.multiply(dark, zone).filter(ImageFilter.MaxFilter(9)))
    paint = ImageChops.subtract(shape, face)
    erase = ImageChops.subtract(ImageChops.subtract(old_all, shape), face)
    return (paint.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1.5)),
            erase.filter(ImageFilter.MaxFilter(5)))


def erase_hair(src: Image.Image, erase: Image.Image) -> Image.Image:
    """Fill old hair outside the new silhouette from the surrounding background (OpenCV Telea)."""
    import cv2
    import numpy as np
    if not erase.getbbox():
        return src
    arr = cv2.cvtColor(np.array(src), cv2.COLOR_RGB2BGR)
    filled = cv2.inpaint(arr, np.array(erase), 15, cv2.INPAINT_TELEA)
    return Image.fromarray(cv2.cvtColor(filled, cv2.COLOR_BGR2RGB))


class LocalHairEditor:
    name = "local-inpaint"

    def __init__(self):
        self.available = True
        self._pipe = None
        self._lock = threading.Lock()
        self.steps = int(os.getenv("AAINA_INPAINT_STEPS", "28"))

    def _load(self):
        with self._lock:
            if self._pipe is None:
                import torch
                from diffusers import AutoPipelineForInpainting
                device = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
                dtype = torch.float16 if device != "cpu" else torch.float32
                pipe = AutoPipelineForInpainting.from_pretrained(MODEL, torch_dtype=dtype, variant="fp16" if device != "cpu" else None,
                                                                 safety_checker=None, requires_safety_checker=False)
                pipe.to(device)
                pipe.enable_attention_slicing()
                self._pipe, self._device = pipe, device
                log.info("inpainting model %s ready on %s", MODEL, device)
        return self._pipe

    def warm(self):
        threading.Thread(target=self._load, daemon=True).start()

    async def run(self, agent: AgentSpec, ctx: dict[str, Any]) -> dict[str, Any]:
        images = ctx.get("images") or {}
        photo, geom = images.get("photo"), images.get("geometry")
        if not photo or not geom:
            raise RuntimeError("no photo or hair map to edit")
        styles = {s["id"]: s for s in ((ctx.get("catalog") or {}).get("hairstyles") or {}).get("styles", [])}
        options = ((ctx.get("recommendation") or {}).get("options") or [])[:3]
        analysis = ctx.get("analysis") or {}
        previews, failures = [], 0
        for o in options:                                      # one at a time: an 8 GB Mac cannot hold two runs
            style = styles.get(o.get("style_id"), {})
            prompt = render(agent.prompt, {**ctx, "option": o, "style": style})
            try:
                seed = sum(map(ord, o.get("style_id", ""))) % 10_000         # stable per cut, different between cuts
                img = await asyncio.to_thread(self.edit, photo["data"], geom, style, prompt, seed)
                previews.append({"style_id": o.get("style_id", ""), "kind": "photo", "image": img,
                                 "caption": f"{o.get('name', 'This cut')} on your photo (AI edit, made on this computer)"})
            except Exception as exc:
                failures += 1
                log.exception("local try-on failed for %s", o.get("style_id"))
                previews.append({"style_id": o.get("style_id", ""), "kind": "drawing", "image": SvgStyleCards().render(o, style, analysis),
                                 "caption": f"Illustration of {o.get('name', 'this cut')} (the photo edit did not work: {str(exc)[:60]})"})
        if options and failures == len(options):
            raise RuntimeError("every photo edit failed")
        return {"previews": previews}

    def edit(self, photo_b64: str, geom: dict[str, Any], style: dict[str, Any], prompt: str, seed: int = 7) -> str:
        import torch
        pipe = self._load()
        src = _img(photo_b64).convert("RGB")
        W, H = src.size
        geom = {**geom, "width": W, "height": H} if (geom.get("width"), geom.get("height")) != (W, H) else geom
        silhouette = SHAPES.get(style.get("shape", ""), ("short", 12, set()))
        mask, erase = edit_mask(geom, _img(geom["hair_mask"]), silhouette[0], silhouette[1], src)
        src = erase_hair(src, erase)

        # square crop around the head, model works at 512 or 640
        ux, uy = geom["up"]
        face_len = geom["chin"][1] - uy
        side = int(min(max(W, H), face_len * (2.6 if style.get("length") == "long" else 2.1 if style.get("length") == "medium" else 1.75)))
        side = min(side, W, H)
        cx = int(min(max(ux - side / 2, 0), W - side))
        cy = int(min(max(uy - face_len * 0.5, 0), H - side))
        box = (cx, cy, cx + side, cy + side)
        S = int(os.getenv("AAINA_INPAINT_SIZE", "512"))      # 512 fits an 8 GB Mac
        crop, mcrop = src.crop(box).resize((S, S), Image.LANCZOS), mask.crop(box).resize((S, S), Image.LANCZOS)

        gen = torch.Generator(device="cpu").manual_seed(seed)
        out = pipe(prompt=prompt, negative_prompt=NEGATIVE, image=crop, mask_image=mcrop, width=S, height=S,
                   num_inference_steps=self.steps, guidance_scale=7.0, strength=1.0, generator=gen).images[0]

        # put the new hair back into the full-resolution photo; everything outside the mask stays original
        # take the model's pixels only where the hair really changed, so a background the model
        # merely re-shaded keeps its original pixels (no halo)
        patch = out.resize((side, side), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=2, percent=120, threshold=2))
        orig = src.crop(box)
        diff = ImageChops.difference(patch.convert("L"), orig.convert("L")).filter(ImageFilter.GaussianBlur(1))
        changed = diff.point(lambda v: 0 if v < 14 else 255 if v > 42 else int((v - 14) * 255 / 28))
        alpha = ImageChops.multiply(mask.crop(box), changed.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1)))
        merged = src.copy()
        merged.paste(patch, box[:2], alpha)
        if self._device == "mps":
            torch.mps.empty_cache()
        buf = io.BytesIO()
        merged.save(buf, "JPEG", quality=88)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def make_image_provider():
    """AAINA_IMAGE = local | off (default off: the model is large and needs a decent machine)."""
    if os.getenv("AAINA_IMAGE", "off").lower() != "local":
        return None
    try:
        import diffusers  # noqa: F401
        import torch  # noqa: F401
    except ImportError:
        log.warning("AAINA_IMAGE=local but torch/diffusers are not installed; using drawings")
        return None
    p = LocalHairEditor()
    p.warm()
    return p
