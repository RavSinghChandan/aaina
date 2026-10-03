"""Photo try-on: the cuts are edited onto the customer's own photo, with safe fallbacks."""
import asyncio
import base64
import json

import httpx

from app.harness import Engine, Registry
from app.providers import OfflineProvider
from app.providers.photo_edit import OpenAIPhotoEdit

PHOTO = {"media_type": "image/jpeg", "data": base64.b64encode(b"\xff\xd8fake-jpeg").decode()}
EDITED = base64.b64encode(b"edited-jpeg").decode()


def run(transport, photo=PHOTO):
    reg = Registry()
    eng = Engine(reg, {"llm": None, "offline": OfflineProvider(), "image": OpenAIPhotoEdit(api_key="k", transport=transport)})
    ctx = {"input": {"gender": "men", "self_report": {}}, "images": {"photo": photo, "extra": []}}
    return asyncio.run(eng.run("consultation", ctx, reg.tenants["demo"]))


def test_three_cuts_edited_on_the_customer_photo():
    seen = []

    def handler(req: httpx.Request):
        body = req.content.decode("latin-1")
        seen.append(body)
        assert req.url.path.endswith("/images/edits") and req.headers["authorization"] == "Bearer k"
        return httpx.Response(200, json={"data": [{"b64_json": EDITED}]})

    res = run(httpx.MockTransport(handler))
    prev = res.outputs["previews"]["previews"]
    assert res.steps["previews"].source == "openai-image"
    assert len(prev) == 3 and all(p["kind"] == "photo" and p["image"] == "data:image/jpeg;base64," + EDITED for p in prev)
    assert len(seen) == 3                                           # one edit per recommended cut, top three only
    names = [o["name"] for o in res.outputs["recommendation"]["options"]]
    assert all(any(n in b for b in seen) for n in names)            # each prompt names its own cut
    assert all("fake-jpeg" in b and "Change ONLY the hair" in b for b in seen)   # the real photo is sent, hair-only edit


def test_one_failed_edit_falls_back_to_a_drawing_for_that_cut():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        return httpx.Response(400, json={"error": "bad"}) if calls["n"] == 1 else httpx.Response(200, json={"data": [{"b64_json": EDITED}]})

    prev = run(httpx.MockTransport(handler)).outputs["previews"]["previews"]
    assert sorted(p["kind"] for p in prev) == ["drawing", "photo", "photo"]


def test_all_failed_or_no_photo_uses_drawings():
    res = run(httpx.MockTransport(lambda r: httpx.Response(401, json={})))
    assert res.steps["previews"].source == "offline-fallback" and res.ok
    assert all(p["kind"] == "drawing" for p in res.outputs["previews"]["previews"])
    res = run(httpx.MockTransport(lambda r: httpx.Response(500)), photo=None)       # no photo: never calls OpenAI
    assert res.steps["previews"].source == "image"
