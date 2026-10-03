"""Offline provider: runs the deterministic rule an agent names in its manifest."""
from __future__ import annotations

import asyncio
from typing import Any

from ..harness.manifests import AgentSpec
from .rules import RULES


class OfflineProvider:
    available = True

    async def run(self, agent: AgentSpec, ctx: dict[str, Any]) -> Any:
        if not agent.offline:
            raise RuntimeError(f"agent {agent.id} has no offline rule")
        fn = RULES.get(agent.offline.rule)
        if fn is None:
            raise RuntimeError(f"agent {agent.id}: unknown offline rule '{agent.offline.rule}'")
        return await asyncio.to_thread(fn, ctx)
