"""The Claude provider builds a valid request from any agent manifest - checked
against the real SDK with a mocked network, so no API credit is spent."""
import asyncio
import json

import anthropic
import httpx2

from app.harness import Registry
from app.providers.claude import ClaudeProvider

ANALYSIS = {"face_shape": "round", "face_shape_confidence": 0.8, "features": ["soft jaw"],
            "hair": {"type": "wavy", "density": "medium", "length": "long", "texture_notes": "", "visible_concerns": []},
            "skin": {"type": "combination", "visible_concerns": []}, "beard": {"present": False, "notes": ""},
            "photo_quality": "good", "notes": ""}


def run_agent(agent_id, ctx, reply):
    seen = {}

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen["url"] = str(request.url)
        seen["headers"] = dict(request.headers)
        seen["body"] = json.loads(request.content)
        return httpx2.Response(200, json={
            "id": "msg_test", "type": "message", "role": "assistant", "model": "claude-opus-5-5",
            "content": [{"type": "text", "text": json.dumps(reply)}],
            "stop_reason": "end_turn", "stop_sequence": None,
            "usage": {"input_tokens": 10, "output_tokens": 10}})

    reg = Registry()
    client = anthropic.DefaultAsyncHttpxClient(transport=httpx2.MockTransport(handler))
    provider = ClaudeProvider(api_key="test-key", http_client=client)
    out = asyncio.run(provider.run(reg.agents[agent_id], ctx | {"catalog": reg.catalog}))
    return out, seen


def test_vision_agent_request_shape():
    ctx = {"input": {"gender": "women", "self_report": {}}, "images": {"photo": {"media_type": "image/png", "data": "iVBORw0KGgo="}, "extra": []}}
    out, seen = run_agent("face_analyst", ctx, ANALYSIS)
    body = seen["body"]
    assert out["face_shape"] == "round"
    assert seen["url"].split("?")[0].endswith("/v1/messages")
    assert body["model"] == "claude-opus-5-5"
    assert body["fallbacks"] == "default"
    assert "server-side-fallback-2026-07-01" in seen["headers"].get("anthropic-beta", "")
    assert body["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert body["messages"][0]["content"][0]["type"] == "image"
    fmt = body["output_config"]["format"]
    assert fmt["type"] == "json_schema"
    assert fmt["schema"]["additionalProperties"] is False
    assert set(fmt["schema"]["required"]) == set(fmt["schema"]["properties"])
    assert fmt["schema"]["properties"]["hair"]["additionalProperties"] is False
    assert body["output_config"]["effort"] == "medium"
    assert "temperature" not in body


def test_recommender_prompt_is_grounded_in_catalog():
    ctx = {"input": {}, "analysis": ANALYSIS, "profile": {"audience": "women"}}
    reply = {"summary": "s", "options": []}
    _, seen = run_agent("style_recommender", ctx, reply)
    system = seen["body"]["system"][0]["text"]
    assert "long-layers" in system and "low-taper-fade" in system      # catalog ids are in the instructions
    assert "image" not in [b["type"] for b in seen["body"]["messages"][0]["content"]]
