"""DeepSeek provider: request shape, vision honesty, and safe fallback - mocked network, no tokens spent."""
import asyncio
import json

import httpx

from app.harness import Engine, Registry
from app.providers import DeepSeekProvider, OfflineProvider


def reply(content: str, finish: str = "stop"):
    return {"id": "x", "object": "chat.completion", "model": "deepseek-chat",
            "choices": [{"index": 0, "finish_reason": finish, "message": {"role": "assistant", "content": content}}]}


def provider_with(handler):
    return DeepSeekProvider(api_key="test-key", transport=httpx.MockTransport(handler))


def test_request_shape_and_parse():
    seen = {}

    def handler(request: httpx.Request):
        seen["url"], seen["auth"], seen["body"] = str(request.url), request.headers["authorization"], json.loads(request.content)
        return httpx.Response(200, json=reply(json.dumps({"headline": "h", "audience": "women", "profession_fit": "any",
            "style_personality": ["modern"], "maintenance_appetite": "low", "lifestyle": [], "likes": [], "dislikes": [],
            "constraints": [], "care_priorities": []})))

    reg = Registry()
    out = asyncio.run(provider_with(handler).run(reg.agents["profile_builder"], {"input": {"gender": "women"}, "catalog": reg.catalog}))
    body = seen["body"]
    assert seen["url"] == "https://api.deepseek.com/chat/completions"
    assert seen["auth"] == "Bearer test-key"
    assert body["model"] == "deepseek-chat" and body["response_format"] == {"type": "json_object"}
    assert "JSON schema" in body["messages"][0]["content"] and '"additionalProperties": false' in body["messages"][0]["content"]
    assert body["messages"][1]["role"] == "user"
    assert out["audience"] == "women"


def test_text_only_model_never_reads_the_photo_and_bad_json_falls_back():
    calls = []

    def handler(request: httpx.Request):
        system = json.loads(request.content)["messages"][0]["content"]
        calls.append(system[:40])
        if "senior stylist" in system:            # recommender: return junk to prove fallback
            return httpx.Response(200, json=reply("not json at all"))
        return httpx.Response(500, json={"error": "boom"})   # every other agent errors -> offline fallback

    reg = Registry()
    eng = Engine(reg, {"llm": provider_with(handler), "offline": OfflineProvider()})
    ctx = {"input": {"gender": "men", "self_report": {"face_shape": "square"}}, "images": {"photo": {"media_type": "image/png", "data": "x"}}}
    res = asyncio.run(eng.run("consultation", ctx, reg.tenants["demo"]))
    assert res.ok
    assert res.steps["analysis"].source == "offline"                 # vision agent skipped DeepSeek entirely
    assert not any("analyst" in c for c in calls)
    assert res.steps["recommendation"].source == "offline-fallback"  # junk JSON caught by the engine
    assert len(res.outputs["recommendation"]["options"]) == 3


def test_auth_error_is_explicit():
    p = provider_with(lambda r: httpx.Response(401, json={"error": "bad key"}))
    reg = Registry()
    try:
        asyncio.run(p.run(reg.agents["profile_builder"], {"input": {}, "catalog": reg.catalog}))
    except RuntimeError as e:
        assert "401" in str(e)
    else:
        raise AssertionError("expected a 401 error")
