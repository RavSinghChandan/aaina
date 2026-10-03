# Aaina — the AI mirror for salons

*Aaina* (आईना) means mirror. A customer sits in the chair, the salon takes one photo,
and Aaina's agents recommend the three haircuts that suit that person — with a
preview of each, a hair-care routine, a face-care routine, a 360° profile, and a
care calendar that tells them when to come back.

Sold to salons and parlours (men, women and unisex) on subscription, for example
₹500 per month per salon.

---

## 1. The problem

Most Indian salons are single-owner shops. The consultation is a guess:
"short on the sides?" The customer can't see the result before the cut, the stylist
can't easily explain *why* a style suits a face, and nothing brings the customer
back on time. Aaina turns the first five minutes into a confident, visual
decision and a reason to return.

| Who | Pain | What Aaina gives them |
|---|---|---|
| Customer | "Will this suit me?" | 3 options chosen for their face, hair, job and taste, with a preview |
| Stylist | Hard to explain or upsell | The reasoning, how-to-cut notes, the products and routine |
| Owner | Customers drift away | A care calendar: "trim due 14 Nov", "spa due", repeat visits |

---

## 2. The harness — new features without touching core code

Aaina is built as a **harness**: a small, fixed core that runs whatever the
manifests describe. Features are *data*, not code.

```
manifests/
  agents/        one YAML per agent: prompt, inputs, output schema, UI view, offline rule
  workflows/     one YAML per flow: which agents run, in what order, in parallel
  tenants/       seed salons: branding, enabled workflows, plan
catalog/         domain knowledge the agents are grounded in (styles, routines)
app/harness/     the fixed core: manifest loader, template renderer, DAG engine
app/providers/   pluggable brains: claude (vision + reasoning), offline (rules), images
```

**To add a feature** (say, beard styling): add `manifests/agents/beard_stylist.yaml`
with its prompt, output schema and `ui.view`, then add one step to a workflow.
The engine runs it, the API returns it, and the Angular app renders it through the
generic view for that `ui.view`. No core Python or Angular code changes.

### 2.1 Agent manifest

```yaml
id: hair_care_planner
title: Hair care routine
kind: llm                 # llm | rule | image
needs_image: false
inputs: [analysis, profile, recommendation]   # context keys the prompt can read
system: |                 # stable instructions (prompt-cached)
  You are a trichology-aware stylist...
prompt: |                 # per-customer template, {{ path.to.value }}
  Face and hair analysis: {{ analysis }}
output_schema: { ...JSON Schema... }          # enforced via structured outputs
ui: { view: routine, order: 40 }              # how the app renders the result
offline: { rule: hair_care_planner }          # deterministic fallback
```

### 2.2 Workflow manifest

```yaml
id: consultation
steps:
  - { id: analysis,       agent: face_analyst }
  - { id: profile,        agent: profile_builder }
  - { id: recommendation, agent: style_recommender, needs: [analysis, profile] }
  - { id: previews,       agent: preview_renderer,  needs: [recommendation] }
  - { id: hair_care,      agent: hair_care_planner, needs: [recommendation] }
  - { id: face_care,      agent: skin_care_planner, needs: [analysis, profile] }
  - { id: calendar,       agent: care_calendar,     needs: [recommendation, hair_care] }
```

Steps whose `needs` are met run **in parallel**. Each step's output lands in the
shared context under its `id`, which later prompts can reference.

### 2.3 Providers and graceful degradation

| Provider | Used for | When |
|---|---|---|
| `claude` | Vision (face, hair) and reasoning | `ANTHROPIC_API_KEY` set and the salon's plan enables AI |
| `offline` | Deterministic rules over the catalog | No key, an API error, or demo mode — the product never breaks |
| `images` | Style previews | Offline: an illustrated style card (SVG). Pluggable: a real image model |

Every LLM call is grounded: the recommender must pick style IDs from
`catalog/hairstyles.yaml`, so it never invents a haircut the salon can't name.

---

## 3. Multi-tenancy

* Every salon is a **tenant** (`slug`, branding, enabled workflows, plan, settings).
* The tenant comes from the URL: `/api/t/{tenant}/...` and `/t/{tenant}` in the app.
* Every row (customers, consultations, care events) carries `tenant_id`; every query
  is scoped by it. One salon can never read another's data.
* Usage is metered per tenant per month — the basis for subscription billing.

---

## 4. Privacy and consent (DPDP Act 2023)

* **Explicit consent** before any photo is taken; the consultation is rejected without it.
* **Photos are processed in memory and not stored** unless the salon enables storage
  *and* the customer agrees.
* **No genetic data.** A simple self-reported family hair-history question replaces it.
* Social-media photos are **optional uploads by the customer**, never scraped.
* **Right to erasure:** one call deletes a customer and everything linked to them.
* Skin and hair advice is grooming advice, not medical advice; the app says so.

---

## 5. The customer journey (mobile first)

1. **Consent** — what is used, what is not stored.
2. **Photo** — front camera or upload; optional "styles I like / my social photos".
3. **About you** — gender identity, profession, lifestyle, hair goals, likes and
   dislikes, maintenance appetite, budget, family hair history.
4. **Thinking** — live progress as each agent works.
5. **Results** — three options with previews and reasons; choose one.
   Tabs: hair routine, face routine, 360° profile, care calendar.
6. **Big screen** — the same three options, full-screen on the salon TV.

---

## 6. Deployment (free tier)

| Part | Where | Notes |
|---|---|---|
| Angular app | Vercel | Static, `vercel.json` rewrites |
| FastAPI API | Render (free web service) | `render.yaml`, Docker |
| Database | **Neon or Supabase Postgres (free)** via `DATABASE_URL` | Render's free disk is wiped on every redeploy — do not rely on SQLite in production |

Environment: `ANTHROPIC_API_KEY`, `DATABASE_URL`, `ALLOWED_ORIGINS`,
`AAINA_PROVIDER` (`claude` or `offline`), `ADMIN_KEY` (protects tenant creation).

---

## 7. Not built yet (on purpose)

* Login and roles (salon owner, stylist) — planned; `ADMIN_KEY` guards admin calls until then.
* Payments (Razorpay subscriptions) — usage metering is in place.
* WhatsApp reminders from the care calendar.
* A photorealistic image model for previews — the provider interface is ready.
