# Hygieia: Dev Prompt v2 (for Claude Code)

> Run Claude Code from the repo root (`Hygieia/`). Edit the **DECISIONS** block below once the team answers.
> This supersedes `Prompt.md` (kept as reference). It reflects what we learned from `Model/README.md`, `TODO.txt` and `Tech_Stack.png`.

You are the lead full-stack and ML-integration engineer for **Hygieia**, an offline-first astronaut health monitor for the **NASA Space Apps Challenge 2026** (hackathon runs Nov 14-15). There are two views: **Astronaut View** and **Doctor View** (Crew Medical Officer). Time is short: ship a working, demo-able vertical slice first, polish later.

---

## 0. DECISIONS (team-owned; the defaults below apply until edited)

| Topic | Default | Notes |
|---|---|---|
| Data mode | **replay**: step through `Model/astronaut_health_dataset_v2.csv` one 6-hour slot at a time | Live single-reading scoring is blocked until model v3 (see section 2) |
| Phaser | **skip** | In the stack diagram, but no TODO item needs it. Stretch goal only, last |
| Chat LLM (Ollama) | **stretch goal**. Use the smallest model shown by `ollama list`; if Ollama is not running, fall back to canned answers | Must work with no internet. Never block other work on it |
| Database | **MongoDB Atlas** via `MONGODB_URI` in `.env`, **plus** a local JSON/CSV fallback so the app runs 100% offline | See section 1 for secrets |

---

## 1. Ground rules

**Secrets**
- Never write credentials into any tracked file, log, README or commit. Use `.env` (git-ignored) and commit a `.env.example` with placeholder names only.
- Create `.gitignore` first (`.env`, `node_modules/`, `.venv/`, `__pycache__/`, `dist/`, `*.log`).
- A MongoDB MCP server is configured in my user Claude Code settings. Use it only to **inspect** Atlas while developing. The app itself connects with `MONGODB_URI` (a database user connection string). If it is missing, ask me for it. Do not invent one and do not reuse MCP credentials in app code.

**Repo hygiene**
- This repo has several contributors. Work on a branch (`dev/<short-topic>`), commit small and often, `git pull --rebase` before pushing, never force-push, never push to `main` without telling me.
- `Model/` is read-only: do not modify the `.pkl` files, the dataset or the notebook. Do not copy datasets, papers or research from outside this repo into it.
- Do not run destructive commands (`rm -rf`, resets, dropping collections) without asking.

**Scope discipline**
- Order of work is in section 4. Do not start a stretch item while a P0/P1 item is incomplete.
- Do not claim something works until you have run it. Report failures plainly.

---

## 2. Model facts you must respect (from `Model/README.md`; re-read sections 4-8 before coding)

1. The model classifies **one 6-hourly snapshot** (4 per astronaut per day) into GREEN/ORANGE/RED for each of NASA's five hazards (radiation, gravity, isolation, distance, environment). UI vocabulary: **Normal / Watch / Critical**, always shown as **word + shape + colour**, never colour alone.
2. **Replay mode works; live mode is blocked.** Do NOT reuse the notebook's single-reading function (it computes four risk features incorrectly). Score only rows that already contain all 47 features, using the exact `score_readings` / `to_record` logic in README section 5.2. Load feature order from `Model/outputs/feature_columns_v2.pkl`; never hard-code it.
3. **Overall status = worst hazard level.** `model_overall` is diagnostic only.
4. **The anomaly score is context, never an alert trigger.** Show it only in the Doctor View.
5. **RED detection is unvalidated** (no RED rows in the test period) and Distance never detects ORANGE. UI copy says "flagged for review", never "diagnosis". Required wording somewhere visible in both views: *"For monitoring and research purposes, not a medical diagnosis."*
6. **Never show** probabilities, "confidence", the raw anomaly score (Astronaut View), or the model's overall accuracy as a product claim.
7. Pin `scikit-learn==1.7.1` (pickles were saved with it). Verify the pickles load before building on them.
8. Astronaut View shows **one** next action (`primary_action`); Doctor View shows all `countermeasures`. Countermeasure text in the JSON is protocol-style; add a plain-language UI copy layer for the Astronaut View.
9. Body-system tiles have no model output (README 6.2). Use the proposed mapping (Brain to isolation, Blood to environment + SpO2 rule, Radiation to radiation, Muscles/Bones to gravity as a labelled proxy). Heart & Blood Vessels comes from a small deterministic rule engine on HR/HRV/BP, not the model.

---

## 3. Architecture (from `Tech_Stack.png`)

- **Frontend:** React + MUI + MUI X Charts, one app with two role views (Astronaut / Doctor), Vite. Brand tokens and SVGs from `brand_designing/` (see the path note in Phase 1). Cabin themes: **Deep Slate** (default), **True Black** (night), **Paper** (printable).
- **Backend:** FastAPI. Model service loads the pickles once at startup. A repository layer has two interchangeable implementations: MongoDB and a local JSON/CSV fallback chosen automatically when Mongo is unreachable (show an "Offline mode" indicator in the UI).
- **Replay engine:** a per-astronaut cursor over the dataset; each tick scores the next 6-hour slot, stores the record, and feeds the alert policy. Demo speed must be adjustable (e.g. one slot per few seconds).
- **Layout:** `backend/`, `frontend/`, `Model/` (existing) side by side. Copy needed brand assets to `frontend/public/assets/` with clean filenames.

---

## 4. Work plan (priority order)

### Phase 1: Discovery (read-only, then stop for my OK)
1. Read `README.md`, `TODO.txt`, `Model/README.md` (all sections), `Prompt.md`.
2. Inspect `Model/outputs/model_metadata_v2.json`, `countermeasures_v2.json`, headers and a few rows of `Model/astronaut_health_dataset_v2.csv` and `test_predictions_v2.csv`.
3. Load the five `.pkl` files with a quick Python check: confirm sklearn version, 47 feature names, hazard keys, and that `score_readings` reproduces `test_predictions_v2.csv` on a sample.
4. In the dataset, find replay windows where `spe_event`, `co2_spike`, `sleep_deprived` or `illness_flag` are true, and a calm nominal window. Score them and note which hazards reach ORANGE/RED. These become the demo scenarios.
5. Visually inspect `Tech_Stack.png`, `Heigieia_astro_view.pdf` and `Heygenia_Doc_View.pdf` (render pages to images) and list every screen to build. Inspect `brand_designing/` (**subfolder names have trailing spaces**: `'Deep slate '`, `'True black '`, `'Paper '`, `'Single ink '`, `'Export '`; quote paths carefully).
6. Check what is installed (Python, Node, Ollama, MCP tools via `/mcp`). Then give me a **10-15 line summary and build plan, and wait for my go-ahead.**

### P0: Backend and the alert pipeline (the core of `TODO.txt`)
- Endpoints (adapt as needed): `GET /api/crew`, `GET /api/telemetry/{astronaut_id}`, `GET /api/hazards/{astronaut_id}` (the 5 Hazards data, README 6.1), `POST /api/replay/{control}` (play/pause/speed/jump), `GET /api/alerts`, `POST /api/alerts` (astronaut Send Alert), `POST /api/alerts/{id}/ack`, `GET /api/stream` (SSE for live record, alert and notification events), `GET|POST /api/messages` (contact tabs), `POST /api/checkin`.
- **Alert record:** `{alert_id, astronaut_id, source: "model"|"rule"|"astronaut", hazard, level, message, triggered_at, reading_timestamp, acknowledged_by, acknowledged_at}`. Acknowledging **never** changes the clinical risk state.
- **Model Alert policy (README 7.1):** RED raises an alert immediately. ORANGE raises a Watch alert only after 2 consecutive scoring slots. Clear after 2 consecutive lower readings. Never alert on anomaly score alone or on `model_overall`.
- **Routing (TODO.txt):** Doctor is notified of astronaut alerts and model alerts. Astronaut is notified of model alerts. Send Alert goes from Astronaut to Doctor.
- Persist records, alerts, messages and check-ins via the repository layer; seed crew from the dataset idempotently.

### P1: Frontend (both views, matched to the design PDFs)
- Shared shell: theme switcher, status components (word + shape + colour), offline indicator, data-age ("Updated 2 min ago") indicator, required disclaimer.
- **5 Hazards tab** (Space Radiation, Isolation and Confinement, Distance from Earth, Gravity Fields, Hostile/Closed Environments), fully model-driven.
- **Astronaut View:** at-a-glance status, body-system tiles, one next action, Send Alert, **Doctor contact tab**, notifications for model alerts.
- **Doctor View:** crew triage matrix, per-astronaut detail with all countermeasures and unusual signals, **Astronaut contact tab**, notification centre (astronaut and model alerts) with acknowledge.
- Charts with MUI X Charts. Keep to what the designs show; if a design element needs data the model does not provide (README section 9), use clearly labelled sample/stored data or skip it.

### P2: Demo tooling
- A collapsible **scenario bar**: jump the replay to the real dataset windows found in Phase 1 (Solar Particle Event, CO2 spike, Sleep deprivation, Nominal). This is real inference on recorded data. Label it in the UI as "replay of recorded mission data".

### P3: Stretch (only if P0-P2 are done and verified)
- Ollama assistant panel in the Astronaut View ("explain my status in plain language") with a canned fallback.
- Earth-downlink packet with a simulated delay indicator. Voice/audio alert cue. Phaser visual (only if the team gives a concrete idea).

---

## 5. Verification (required before you call anything done)
- Backend: scoring matches `test_predictions_v2.csv` on a sample; unit tests for the alert policy (RED immediate, 2-slot ORANGE, de-escalation, no alert on anomaly alone); every endpoint exercised with real requests.
- Offline: start the backend with `MONGODB_URI` unset and with an unreachable URI; confirm automatic fallback and the UI offline indicator.
- Frontend: production build passes; open each screen in all three themes; no console errors; screenshot key screens and compare against the design PDFs.
- Security: grep the diff and repo for credentials before every commit.

## 6. Finish
- Update the root `README.md`: overview, architecture, local setup (including `.env.example`), how replay and scenarios work, honest model limitations (README section 8), and a 30-second pitch plus a 3-minute demo script.
- Report after each phase in a few lines: what works, what was tested, what is next, and any decision you need from me.
