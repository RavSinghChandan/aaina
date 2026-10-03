"""The workflow engine: runs any workflow manifest as a DAG.

* Steps whose `needs` are satisfied run concurrently.
* Each step's output is validated against its agent's schema.
* LLM steps fall back to the agent's offline rule on any failure, so a
  consultation always completes - with `source` telling you which brain ran.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from .manifests import AgentSpec, Registry, TenantSpec, WorkflowSpec
from .schema import check_grounding, validate
from .templating import truthy

log = logging.getLogger("aaina.engine")

EventSink = Callable[[str, dict[str, Any]], Awaitable[None] | None]


class StepError(RuntimeError):
    pass


@dataclass
class StepResult:
    status: str = "pending"          # pending | running | done | skipped | failed
    source: str | None = None        # deepseek | claude | offline | offline-fallback | image
    ms: int = 0
    error: str | None = None


@dataclass
class RunResult:
    workflow: str
    steps: dict[str, StepResult] = field(default_factory=dict)
    outputs: dict[str, Any] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return all(s.status in ("done", "skipped") for s in self.steps.values())

    def to_dict(self) -> dict[str, Any]:
        return {
            "workflow": self.workflow,
            "ok": self.ok,
            "steps": {k: vars(v) for k, v in self.steps.items()},
            "outputs": self.outputs,
        }


class Engine:
    def __init__(self, registry: Registry, providers: dict[str, Any]):
        self.registry = registry
        self.providers = providers      # {"llm": DeepSeek|Claude|None, "offline": OfflineProvider, "image": photo editor | None}

    def choose_provider(self, agent: AgentSpec, tenant: TenantSpec) -> str:
        """'llm' when an AI provider can serve this agent, else 'offline'."""
        if agent.kind != "llm" or tenant.provider == "offline":
            return "offline"
        llm = self.providers.get("llm")
        if llm is None or not llm.available:
            return "offline"
        if agent.needs_image and not getattr(llm, "vision", False):
            return "offline"          # never let a text-only model guess what it cannot see
        return "llm"

    async def run(
        self,
        workflow_id: str,
        context: dict[str, Any],
        tenant: TenantSpec,
        on_event: EventSink | None = None,
    ) -> RunResult:
        wf: WorkflowSpec = self.registry.workflows[workflow_id]
        result = RunResult(workflow=wf.id, steps={s.id: StepResult() for s in wf.steps})
        ctx = dict(context)
        ctx.setdefault("catalog", self.registry.catalog)
        ctx.setdefault("tenant", tenant.model_dump())
        pending = {s.id: s for s in wf.steps}
        done: set[str] = set()

        async def emit(step_id: str) -> None:
            if on_event is None:
                return
            r = on_event(step_id, vars(result.steps[step_id]))
            if asyncio.iscoroutine(r):
                await r

        async def run_step(step) -> None:
            agent = self.registry.agents[step.agent]
            sr = result.steps[step.id]
            if not truthy(ctx, step.when):
                sr.status = "skipped"
                await emit(step.id)
                return
            sr.status = "running"
            await emit(step.id)
            t0 = time.perf_counter()
            try:
                output, source = await self._execute(agent, ctx, tenant)
                sr.source = source
                ctx[step.id] = output
                result.outputs[step.id] = output
                sr.status = "done"
            except Exception as exc:  # the step fails; the rest of the graph decides
                log.exception("step %s failed", step.id)
                sr.status, sr.error = "failed", str(exc)[:300]
            sr.ms = int((time.perf_counter() - t0) * 1000)
            await emit(step.id)

        while pending:
            ready = [s for s in pending.values() if set(s.needs) <= done]
            # a step whose dependency failed cannot run
            blocked = [s for s in ready if any(result.steps[n].status == "failed" for n in s.needs)]
            for s in blocked:
                result.steps[s.id].status = "failed"
                result.steps[s.id].error = "a required earlier step failed"
                await emit(s.id)
            runnable = [s for s in ready if s not in blocked]
            if not ready:
                raise StepError(f"workflow {wf.id} cannot progress: {sorted(pending)}")
            await asyncio.gather(*(run_step(s) for s in runnable))
            for s in ready:
                done.add(s.id)
                pending.pop(s.id, None)
        return result

    async def _execute(self, agent: AgentSpec, ctx: dict[str, Any], tenant: TenantSpec) -> tuple[Any, str]:
        # image agents: edit the customer's own photo when an image provider and a consented photo exist
        img = self.providers.get("image")
        if agent.kind == "image" and img is not None and getattr(img, "available", False) \
                and (ctx.get("images") or {}).get("photo") and tenant.provider != "offline":
            try:
                out = await img.run(agent, ctx)
                problems = validate(out, agent.output_schema) if agent.output_schema else []
                if problems:
                    raise StepError("schema: " + "; ".join(problems[:3]))
                return out, getattr(img, "name", "image")
            except Exception as exc:
                log.warning("agent %s: image provider failed (%s), using offline rule", agent.id, exc)
                out = await self.providers["offline"].run(agent, ctx)
                return out, "offline-fallback"
        provider_name = self.choose_provider(agent, tenant)
        if provider_name == "llm":
            llm = self.providers["llm"]
            try:
                out = await llm.run(agent, ctx)
                problems = validate(out, agent.output_schema) if agent.output_schema else []
                problems += check_grounding(out, agent.ground, self.registry.catalog, ctx)
                if problems:
                    raise StepError("schema: " + "; ".join(problems[:3]))
                return out, getattr(llm, "name", "llm")
            except Exception as exc:
                if not agent.offline:
                    raise
                log.warning("agent %s: %s failed (%s), using offline rule", agent.id, getattr(llm, "name", "llm"), exc)
                out = await self.providers["offline"].run(agent, ctx)
                return out, "offline-fallback"
        out = await self.providers["offline"].run(agent, ctx)
        if agent.output_schema:
            problems = validate(out, agent.output_schema) + check_grounding(out, agent.ground, self.registry.catalog, ctx)
            if problems:
                raise StepError(f"offline rule {agent.offline.rule if agent.offline else '?'} broke schema: {problems[:3]}")
        return out, ("image" if agent.kind == "image" else "offline")
