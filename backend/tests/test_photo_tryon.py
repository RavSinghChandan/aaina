"""The image slot: when a photo editor is plugged in, the three cuts are put on the customer's own photo."""
import asyncio
import base64

from app.harness import Engine, Registry
from app.providers import OfflineProvider

PHOTO = {"media_type": "image/jpeg", "data": base64.b64encode(b"jpeg").decode()}


class FakeEditor:
    name, available = "fake-editor", True

    def __init__(self, fail=False):
        self.fail, self.calls = fail, 0

    async def run(self, agent, ctx):
        self.calls += 1
        if self.fail:
            raise RuntimeError("editor down")
        opts = ctx["recommendation"]["options"][:3]
        return {"previews": [{"style_id": o["style_id"], "kind": "photo", "image": "data:image/jpeg;base64,eA==", "caption": ""} for o in opts]}


def run(editor, photo=PHOTO):
    reg = Registry()
    eng = Engine(reg, {"llm": None, "offline": OfflineProvider(), "image": editor})
    return asyncio.run(eng.run("consultation", {"input": {"gender": "men", "self_report": {}}, "images": {"photo": photo, "extra": []}}, reg.tenants["demo"]))


def test_editor_puts_top_three_on_photo():
    res = run(FakeEditor())
    assert res.steps["previews"].source == "fake-editor"
    assert [p["kind"] for p in res.outputs["previews"]["previews"]] == ["photo"] * 3


def test_editor_failure_or_no_photo_falls_back_to_drawings():
    res = run(FakeEditor(fail=True))
    assert res.steps["previews"].source == "offline-fallback" and res.ok
    ed = FakeEditor()
    res = run(ed, photo=None)
    assert ed.calls == 0 and res.steps["previews"].source == "image"
