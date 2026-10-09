"""Load and validate the manifests that define Aaina's agents, workflows and tenants.

Everything the product does is described here as data. The core never names a
specific agent: it reads whatever YAML is in the manifests directory.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, model_validator

ROOT = Path(__file__).resolve().parents[2]
MANIFEST_DIR = ROOT / "manifests"
CATALOG_DIR = ROOT / "catalog"


class UISpec(BaseModel):
    view: str = "json"          # generic renderer the app uses: options, routine, profile, timeline, ...
    title: str | None = None
    order: int = 100
    hidden: bool = False


class OfflineSpec(BaseModel):
    rule: str                    # name of a deterministic rule in providers/rules.py


class GroundSpec(BaseModel):
    """Declare that an output field must use values that exist in a catalog."""
    field: str                   # dotted path; lists are walked, e.g. options.style_id
    catalog: str                 # dotted path into the catalog, e.g. hairstyles.styles
    key: str = "id"
    # Optional: the chosen catalog row must also match these fields. Each allowed
    # value is a literal, or "$path" read from the workflow context. A resolved
    # value of "all" means "no restriction".
    filter: dict[str, list[str]] = Field(default_factory=dict)
    # Optional customer preferences, enforced in code rather than left to the prompt.
    # avoid: "$path" to a list of words; a row whose avoid_fields mention one is not allowed.
    avoid: str | None = None
    avoid_fields: list[str] = Field(default_factory=lambda: ["id", "name"])
    # cap: a ranked field may not exceed the customer's level by more than `slack` steps.
    cap: "CapSpec | None" = None
    # Preferences are relaxed (the filter never is) if they would leave fewer choices than this.
    min_choices: int = 3


class CapSpec(BaseModel):
    field: str                   # e.g. maintenance
    order: list[str]             # low to high, e.g. [low, medium, high]
    value: str                   # "$input.maintenance"
    slack: int = 0


class AgentSpec(BaseModel):
    id: str
    title: str
    kind: Literal["llm", "rule", "image"] = "llm"
    description: str = ""
    needs_image: bool = False
    inputs: list[str] = Field(default_factory=list)
    system: str = ""
    prompt: str = ""
    output_schema: dict[str, Any] = Field(default_factory=dict)
    effort: Literal["low", "medium", "high", "xhigh", "max"] = "medium"
    max_tokens: int = 16000
    ground: list[GroundSpec] = Field(default_factory=list)
    ui: UISpec = Field(default_factory=UISpec)
    offline: OfflineSpec | None = None

    @model_validator(mode="after")
    def _check(self) -> "AgentSpec":
        if self.kind == "llm" and not self.prompt:
            raise ValueError(f"agent {self.id}: llm agents need a prompt")
        if self.kind in ("rule", "image") and not self.offline:
            raise ValueError(f"agent {self.id}: {self.kind} agents need offline.rule")
        return self


GroundSpec.model_rebuild()


class StepSpec(BaseModel):
    id: str
    agent: str
    needs: list[str] = Field(default_factory=list)
    when: str | None = None      # optional condition: "context.path" truthy, or "not context.path"


class WorkflowSpec(BaseModel):
    id: str
    title: str = ""
    description: str = ""
    steps: list[StepSpec]

    @model_validator(mode="after")
    def _check(self) -> "WorkflowSpec":
        ids = [s.id for s in self.steps]
        if len(ids) != len(set(ids)):
            raise ValueError(f"workflow {self.id}: duplicate step ids")
        known = set(ids)
        for s in self.steps:
            unknown = [n for n in s.needs if n not in known]
            if unknown:
                raise ValueError(f"workflow {self.id}: step {s.id} needs unknown {unknown}")
        _assert_acyclic(self)
        return self


def _assert_acyclic(wf: WorkflowSpec) -> None:
    graph = {s.id: set(s.needs) for s in wf.steps}
    done: set[str] = set()
    while graph:
        ready = [k for k, v in graph.items() if v <= done]
        if not ready:
            raise ValueError(f"workflow {wf.id}: dependency cycle in {sorted(graph)}")
        for k in ready:
            done.add(k)
            del graph[k]


class Branding(BaseModel):
    primary: str = "#86BC25"
    accent: str = "#00ABAB"
    logo_url: str | None = None
    tagline: str = "Find the look that is truly yours."


class TenantSettings(BaseModel):
    store_photos: bool = False   # photos are never stored unless the salon opts in
    audience: list[Literal["women", "men", "all"]] = Field(default_factory=lambda: ["all"])
    city: str | None = None
    currency: str = "INR"


class TenantSpec(BaseModel):
    slug: str
    name: str
    plan: Literal["trial", "starter", "pro"] = "trial"
    provider: Literal["auto", "offline"] = "auto"   # "offline" forces rules for this salon
    workflows: list[str] = Field(default_factory=lambda: ["consultation", "choose_style"])
    branding: Branding = Field(default_factory=Branding)
    settings: TenantSettings = Field(default_factory=TenantSettings)


class Registry:
    """Everything loaded from disk. Reloadable without restarting code paths."""

    def __init__(self, manifest_dir: Path = MANIFEST_DIR, catalog_dir: Path = CATALOG_DIR):
        self.manifest_dir = manifest_dir
        self.catalog_dir = catalog_dir
        self.agents: dict[str, AgentSpec] = {}
        self.workflows: dict[str, WorkflowSpec] = {}
        self.tenants: dict[str, TenantSpec] = {}
        self.catalog: dict[str, Any] = {}
        self.forms: dict[str, Any] = {}
        self.reload()

    def reload(self) -> None:
        self.agents = {a.id: a for a in (AgentSpec(**d) for d in _read_dir(self.manifest_dir / "agents"))}
        self.workflows = {w.id: w for w in (WorkflowSpec(**d) for d in _read_dir(self.manifest_dir / "workflows"))}
        self.tenants = {t.slug: t for t in (TenantSpec(**d) for d in _read_dir(self.manifest_dir / "tenants"))}
        self.catalog = {p.stem: yaml.safe_load(p.read_text()) for p in sorted(self.catalog_dir.glob("*.yaml"))}
        self.forms = {f["id"]: f for f in _read_dir(self.manifest_dir / "forms")}
        for wf in self.workflows.values():
            missing = [s.agent for s in wf.steps if s.agent not in self.agents]
            if missing:
                raise ValueError(f"workflow {wf.id} references unknown agents {missing}")

    def ui_manifest(self) -> list[dict[str, Any]]:
        """What the app needs to render any agent's output generically."""
        return [
            {"id": a.id, "title": a.ui.title or a.title, "view": a.ui.view, "order": a.ui.order,
             "hidden": a.ui.hidden, "description": a.description}
            for a in sorted(self.agents.values(), key=lambda a: a.ui.order)
        ]


def _read_dir(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    out = []
    for p in sorted(path.glob("*.y*ml")):
        data = yaml.safe_load(p.read_text())
        if data:
            out.append(data)
    return out
