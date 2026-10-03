# Aaina — the AI mirror for salons

One photo and a few questions; Aaina recommends the three haircuts that truly suit a
customer, with previews, a hair routine, a face routine, a 360° profile and a care
calendar that brings them back on time. Multi-tenant: every salon gets its own link.

* `backend/` — FastAPI + the agent **harness** (agents and workflows are YAML)
* `frontend/` — Angular 21, mobile first, works on phones, tablets and the salon TV
* `docs/ARCHITECTURE.md` — the design: harness, providers, tenancy, privacy

---

## Run it locally

```bash
# API  (http://localhost:8000)
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env              # add ANTHROPIC_API_KEY for photo analysis; leave empty for offline mode
.venv/bin/uvicorn app.main:app --reload --port 8000

# App  (http://localhost:4200)
cd frontend
npm install && npx ng serve
```

Open `http://localhost:4200/t/demo` — a demo salon is created automatically.

Tests: `cd backend && .venv/bin/python -m pytest` (14 tests, no API key needed).

### Offline mode vs AI mode

| | Offline (no key) | AI (`ANTHROPIC_API_KEY` set) |
|---|---|---|
| Face & hair analysis | From the customer's answers | From the photo (Claude vision) |
| Recommendations | Scoring rules over the catalog | Claude, grounded in the same catalog |
| Routines | Rules over the routine catalog | Claude, personalised |
| Previews, calendar | Same | Same |

If the AI fails or answers outside the schema or catalog, that step falls back to the
offline rule automatically — a consultation never breaks in front of a customer.

---

## Deploy for free (about 15 minutes)

1. **Database — Neon (free).** Create a project at neon.tech, copy the Postgres
   connection string. (Render's free disk is wiped on every deploy; don't use SQLite there.)
2. **API — Render (free).** Push this repo to GitHub, then in Render:
   *New → Blueprint →* select the `aaina` repo (it reads `render.yaml` at the root). Set:
   * `DATABASE_URL` = the Neon string
   * `ANTHROPIC_API_KEY` = your key (or leave empty to sell in offline mode first)
   * `ALLOWED_ORIGINS` = your Vercel URL, e.g. `https://aaina.vercel.app`
   * `ADMIN_KEY` is generated — keep it; you need it to create salons.
   Check `https://<your-service>.onrender.com/api/health`.
3. **App — Vercel.** In `frontend/src/app/core/config.ts` set `PROD_API` to your Render
   URL, then `cd frontend && npx vercel deploy --prod`. Add your own domain in Vercel.
4. **First salon.** Open `https://<your-app>/start`, enter the salon name and the
   `ADMIN_KEY`, and share the link it gives you.

Free-tier note: Render's free service sleeps after 15 minutes idle and takes ~50 s to
wake. Open the salon link a minute before a demo, or move to the $7 plan once paying.

---

## Add a feature without touching core code

Example — a beard-style agent for men's salons:

1. Create `backend/manifests/agents/80_beard_stylist.yaml`:
   ```yaml
   id: beard_stylist
   title: Beard style
   kind: llm
   needs_image: true
   inputs: [analysis, profile]
   system: You recommend beard styles for an Indian men's salon...
   prompt: "Analysis: {{ analysis }}  Profile: {{ profile }}"
   output_schema:
     type: object
     properties:
       daily: { type: array, items: { type: object, properties: { step: { type: string }, why: { type: string } } } }
   ui: { view: routine, title: Beard style & care, order: 45 }
   offline: { rule: skin_care_planner }   # any existing rule as a safety net
   ```
2. Add one line to `backend/manifests/workflows/consultation.yaml`:
   ```yaml
   - { id: beard, agent: beard_stylist, needs: [analysis, profile] }
   ```
3. Restart the API. The new tab appears in the app, rendered by the existing `routine`
   view. Questions work the same way: add a field to `manifests/forms/intake.yaml`.
   New haircuts: add them to `catalog/hairstyles.yaml`.

Available views: `facts`, `options`, `routine`, `profile`, `timeline` (anything else
renders as a readable key–value list).

---

## Privacy (India, DPDP Act 2023)

Explicit consent before any photo; photos are processed in memory and **not stored**
unless the salon enables it and the customer agrees; no genetic data; optional photos
are uploaded by the customer, never scraped; one call erases a customer
(`DELETE /api/t/{salon}/customers/{id}`). Advice is grooming guidance, not medical advice.

## Not built yet

Login and roles, Razorpay subscriptions (usage is already metered per salon per month),
automated WhatsApp reminders (one-tap `wa.me` links work today), and a photorealistic
image model for previews (plug it into `app/providers/images.py`).
