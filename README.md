# Hygieia (Astronaut Health Monitoring Software)

Developed for the **NASA Space Apps Challenge / AppChallenge 2026 / Local Event Taroudannt**, this enables crew members to log, visualize, and address critical microgravity health risks.

Hygieia is an offline-first health monitor for a deep-space crew. A trained model scores every astronaut's 6-hourly health snapshot against **NASA's five hazards of human spaceflight** and the app turns the result into one plain status (**Normal / Watch / Critical**), one next action for the astronaut, and a full crew picture for the Crew Medical Officer. There are two views in one app:

- **Astronaut View**: status first, one clear next action, no clinical detail.
- **Doctor View** (Crew Medical Officer): crew triage, per-astronaut detail with every countermeasure, alerts to acknowledge.

> **For monitoring and research purposes, not a medical diagnosis.** Hygieia is a hackathon prototype. It replays recorded, simulated mission data through the model; it does not read live sensors. Read [Limitations](#limitations) before drawing any conclusion from what it shows.

## Contents

1. [The five hazards](#the-five-hazards)
2. [Architecture](#architecture)
3. [Setup from a clean clone](#setup-from-a-clean-clone)
4. [Running it](#running-it)
5. [How replay and the scenario bar work](#how-replay-and-the-scenario-bar-work)
6. [Alerts and notifications](#alerts-and-notifications)
7. [30-second pitch and 3-minute demo script](#30-second-pitch-and-3-minute-demo-script)
8. [Limitations](#limitations)
9. [Repository layout](#repository-layout)

## The five hazards

The model (`Model/`, version "v2") classifies **one 6-hourly snapshot** per astronaut, four per day, into GREEN / ORANGE / RED for each of five hazards. The app shows these as **Normal / Watch / Critical**, always as a word plus a shape plus a colour, never colour alone (check circle, triangle, octagon). **Overall status is the worst of the five hazard levels.** The model's own "overall" output is shown only to the doctor, as a diagnostic.

| Hazard (tab label) | Model key | Main signals behind it | First suggested action at Watch / Critical (from `countermeasures_v2.json`) |
|---|---|---|---|
| Space Radiation | `radiation` | radiation dose, solar particle events | Monitor space weather forecasts / IMMEDIATE: Enter storm shelter |
| Isolation and Confinement | `isolation` | sleep, mood, reaction time (PVT) | Enforce 7+ hour sleep schedule / Mandatory rest period |
| Distance from Earth | `distance` | combination of critical signals that need an autonomous response | Prepare autonomous medical protocols / Execute EIMO autonomous care |
| Gravity Fields | `gravity` | core temperature, eye OCT change (SANS), VO₂max | Increase ARED exercise sessions / Medical evaluation required |
| Hostile/Closed Environments | `environment` | cabin CO₂, SpO₂, fluid intake | Check CDRA CO2 scrubber status / Verify dual-bed CDRA operation |

Each hazard has three suggested actions per level in the catalog. The **Doctor View shows all of them**, worst hazard first; the **Astronaut View shows only the first one**, rewritten in plain language by a copy layer (`backend/app/ui_copy.py`). That wording is a demo draft and needs validation by mission clinicians.

**What goes into one reading (14 measurements):** heart rate, heart rate variability, systolic and diastolic blood pressure, core temperature, SpO₂, sleep hours, mood score, PVT reaction time, fluid intake, cabin CO₂, radiation dose for the reading, eye OCT change, VO₂max. Per `Model/README.md`, the model also uses each astronaut's preflight baseline, a mission-phase hazard intensity, and rolling statistics; in replay mode all 47 features are already in the dataset rows.

**Mission phases** (from `Model/README.md`; the dataset runs 1,095 mission days, six astronauts, four readings a day, 26,280 rows):

| Phase | Mission days |
|---|---|
| launch_adaptation | 1-14 |
| transit_to_mars | 15-180 |
| mars_surface | 181-680 |
| transit_return | 681-860 |
| earth_readaptation | 861-1095 |

**Six body-system tiles** (Brain, Heart & Blood Vessels, Blood, Muscles, Radiation, Bones) have *no model output of their own*. Their status is a mapping, documented in `Model/README.md` section 6.2:

| Tile | Status comes from |
|---|---|
| Brain | model `isolation` |
| Heart & Blood Vessels | a small rule engine on heart rate, HRV and blood pressure (placeholder thresholds, see [Limitations](#limitations)) |
| Blood | model `environment` or the SpO₂ rule, whichever is worse |
| Radiation | model `radiation` |
| Muscles, Bones | model `gravity`, as a labelled proxy only |

## Architecture

```
 Model/ (read-only)        backend/  (FastAPI, port 8000)                           frontend/  (React + MUI, port 5173)

 dataset CSV  ─┐           ┌──────────────┐  records  ┌──────────────────┐  alerts   ┌───────────────────────┐
 5 pickles     ├────────►  │ ModelService │ ────────► │ ReplayEngine     │  messages │ Repository            │
 countermeas.  ┘  rows     │ (v2 model,   │           │ one shared clock │ ────────► │ local JSON  (always)  │
                           │  scikit-     │           │ alert policy     │           │ MongoDB Atlas (when   │
                           │  learn 1.7.1)│           │ rule engine      │           │ reachable, mirrored)  │
                           └──────────────┘           └────────┬─────────┘           └───────────────────────┘
                                                               │ EventBus
                                    REST  /api/*  +  SSE  GET /api/stream
                                                               │
                                          ┌────────────────────┴───────────────────┐
                                          │ Astronaut View   |   Doctor View       │
                                          │ Deep Slate / True Black / Paper themes │
                                          └────────────────────────────────────────┘
```

| Part | What it does |
|---|---|
| `backend/app/model_service.py` | Loads the pickles once at startup and scores dataset rows with the exact `score_readings` / `to_record` logic from `Model/README.md` section 5.2. There is deliberately no live single-reading scoring (see Limitations). |
| `backend/app/replay.py` | The replay engine: one mission clock for the whole crew, stepping the recorded dataset one 6-hour slot at a time. Each step scores every astronaut, stores the records, runs the rule engine and feeds the alert policy. Also holds the demo scenarios. |
| `backend/app/alert_policy.py` | Alert rules from `Model/README.md` section 7.1 (below). Pure logic, unit tested. |
| `backend/app/rules.py` | Heart & SpO₂ rule engine and the body-system mapping. |
| `backend/app/repository.py` | Storage. Every write goes to a **local JSON store first**, so the app works with no network. When MongoDB Atlas is reachable, writes are mirrored there and small collections are loaded from it at startup. If Atlas drops, the app keeps running locally, queues what it could not mirror, and pushes it when the link returns. |
| `backend/app/main.py` | The REST API and the live event stream (below). |
| `frontend/` | React + MUI + MUI X Charts, built with Vite. One app, two role views, three cabin themes, status components that use word + shape + colour, a data-age indicator ("Updated 2 min ago"), an Offline-mode indicator, and the disclaimer on every screen. |

**Live updates.** The backend pushes events over Server-Sent Events at `GET /api/stream`: `tick` (a new reading was scored), `replay`, `storage`, `alert`, `alert_cleared`, `alert_ack`, `message`, `checkin`, and a `ping` heartbeat every 10 s. The Astronaut stream is filtered server-side to that astronaut and carries no clinical detail. The page reconnects by itself if the stream goes quiet.

**API** (all under `/api`; the doctor/astronaut `view` parameter controls how much detail is returned):

| Endpoint | Purpose |
|---|---|
| `GET /health` | status, storage mode, replay state, disclaimer |
| `GET /crew` | crew, baselines, latest record, open alerts |
| `GET /telemetry/{astronaut_id}?range=24h\|7d\|30d\|mission` | time series and latest record |
| `GET /hazards/{astronaut_id}` | the five hazards (5 Hazards tab) |
| `GET /replay`, `POST /replay/{play\|pause\|step\|speed\|jump}` | replay state and controls |
| `GET /alerts`, `POST /alerts`, `POST /alerts/{id}/ack` | alert list, astronaut Send Alert, acknowledge |
| `GET /messages`, `POST /messages` | contact tabs |
| `GET /checkin`, `POST /checkin` | self-reported daily check-in (stored, never a model input) |
| `GET /stream` | live events (SSE) |

The `Tech_Stack.png` diagram also shows Phaser and Ollama. Neither is used (see Limitations).

## Setup from a clean clone

**You need:** Git; **Python 3.12** (the version tested: the model files were saved with scikit-learn 1.7.1, which `backend/requirements.txt` pins, and newer Python versions may have no wheels for it); [uv](https://docs.astral.sh/uv/) (recommended) or pip; **Node 20.19+ or 22.12+** (Vite 8 requirement; tested on Node 26). Commands assume Linux or macOS and were tested on Linux.

```bash
git clone https://github.com/N0w-StM/Hygieia.git
cd Hygieia
git checkout dev/frontend   # the app lives on this branch until it is merged
cp .env.example .env
uv venv --python 3.12 backend/.venv
uv pip install --python backend/.venv/bin/python -r backend/requirements.txt
(cd frontend && npm install)
```

Without uv, replace the two `uv` lines with:

```bash
python3.12 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
```

`.env` is git-ignored. With `MONGODB_URI` left empty (as in `.env.example`) the app runs **fully offline** on a local JSON store under `backend/data/` (also git-ignored).

| Variable in `.env` | Meaning | Default |
|---|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string for a database user. Empty means offline mode. **Never commit it, paste it in chat, or put it in any file other than `.env`.** | empty |
| `MONGODB_DB` | database name | `hygieia` |
| `REPLAY_SECONDS_PER_SLOT` | seconds of real time per 6-hour reading when replay is playing | `5` |
| `REPLAY_START_DAY` | mission day the replay starts on | `79` |
| `REPLAY_AUTOPLAY` | `1` starts playing at launch, `0` starts paused | `1` |
| `HYGIEIA_DATA_DIR` | optional, where the local JSON store lives (not in `.env.example`) | `backend/data` |

**To use Atlas** (optional): paste your database user's connection string from the Atlas "Connect" dialog into `MONGODB_URI` in `.env`, and add your machine's IP address under Network Access in Atlas. If the IP is not allowed, the connection fails and the app simply runs in Offline mode.

Check the install:

```bash
backend/.venv/bin/python -m pytest -q backend   # 39 tests, includes scoring parity with Model/outputs/test_predictions_v2.csv
(cd frontend && npm run build)                  # production build
```

## Running it

Run both from the repository root, in two terminals.

**Terminal 1, backend** (port 8000):

```bash
backend/.venv/bin/uvicorn app.main:app --app-dir backend --port 8000 --timeout-graceful-shutdown 2
```

**Terminal 2, frontend** (port 5173, proxies `/api` to the backend):

```bash
cd frontend && npm run dev
```

Open <http://localhost:5173>. The role is in the URL, so you can keep two windows side by side:

- Astronaut View: <http://localhost:5173/#/astronaut/status>
- Doctor View: <http://localhost:5173/#/doctor/overview>
- Add `?theme=deepSlate`, `?theme=trueBlack` or `?theme=paper` before the `#` to pick a theme from the URL. The header also has a Cabin theme selector.

`--timeout-graceful-shutdown 2` makes Ctrl+C exit within 2 to 3 seconds (measured with a live stream open). Without it, uvicorn waits for the browsers' open live streams and can appear to hang.

**Offline on purpose.** Prefix the backend command with an empty `MONGODB_URI`; this overrides whatever `.env` holds, so the header shows **Offline mode**:

```bash
MONGODB_URI= backend/.venv/bin/uvicorn app.main:app --app-dir backend --port 8000 --timeout-graceful-shutdown 2
```

**Reset the demo data** (run it with the backend stopped). It deletes only documents in Hygieia's own collections (`crew`, `records`, `alerts`, `messages`, `checkins`) of the database named `hygieia`; it never drops a collection or the database and never touches anything else. The database name is fixed in the script and ignores `MONGODB_DB`. The backend re-creates the crew from the dataset on its next start.

```bash
backend/.venv/bin/python backend/scripts/reset_data.py --local            # dry run: prints counts, deletes nothing
backend/.venv/bin/python backend/scripts/reset_data.py --yes --local      # actually deletes (also empties the local store)
```

Without `--local` the local JSON store is left alone, and old alerts and messages would still show.

**What was checked for offline behaviour.** Backend started with `MONGODB_URI` empty, and with an unreachable URI: both fall back to the local store and the header shows **Offline mode**, with the number of items waiting to sync when a URI is set. With the backend stopped, the page shows **No link** and a banner, and returns to normal by itself when the backend is back.

## How replay and the scenario bar work

Hygieia does not read live sensors. It **replays `Model/astronaut_health_dataset_v2.csv`**, one 6-hour reading at a time, through the real model (`Model/README.md` explains why live mode is blocked until a v3 model). Every number on screen is real model output on recorded data; nothing is simulated or altered. The bar at the bottom of every screen says so: "Replay of recorded mission data".

- **One clock for the whole crew.** A step moves every astronaut forward one reading (6 hours). MET is shown as `DDD:HH:MM`; the bar shows "Day N" where mission day = MET days + 1. The replay starts on day 79 (`REPLAY_START_DAY`) and stops at the end of the recording (day 1095).
- **Controls.** Play / Pause, **Step one reading**, speed (1 reading per 1, 2, 5, 10 or 30 seconds), and the **Scenarios** chips. The replay state lives in the backend, so every open window follows it.
- **Scenarios jump the clock to real windows of the dataset.** The names below describe what the model actually outputs in each window (a test, `backend/tests/test_scenarios.py`, checks every label against the scored data). Clicking a chip in a window also switches that window to the scenario's focus astronaut.
- **Jumping resets alert debouncing**, and open model and rule alerts are marked cleared ("replay moved"). Alerts an astronaut sent by hand stay.

| Scenario chip | Starts | Focus | What the model shows in that window |
|---|---|---|---|
| Nominal | day 512, 00:00 | Alex Morgan | every crew member Normal on all five hazards |
| Radiation: Watch (whole crew) | day 69, 12:00 | Alex Morgan | Space Radiation at **Watch** for all six crew. It does not reach Critical. The dataset annotates these days as solar particle events, but because the model only reaches Watch, the chip is not called a solar particle event. |
| Radiation: Critical (one crew member at a time) | day 601, 00:00 | Alex Morgan | Space Radiation **Critical** for four consecutive readings (one step after the start). Two readings after Alex clears, Priya Nair goes Critical for four readings. Not an annotated solar particle event. |
| Cabin environment: Watch, then Critical (whole crew) | day 400, 12:00 | Alex Morgan | Hostile/Closed Environments Watch for three readings, then Critical for three, then clears, for all six crew. Annotated in the dataset as a CO₂ spike. |
| Isolation: Watch, then Critical (one crew member) | day 163, 12:00 | Amina Diallo | Isolation Watch for three days, then Critical for four days, during a run of short sleep. |
| Multiple hazards: Distance and Isolation Critical, Gravity Watch | day 438, 06:00 | Kenji Sato | three hazards flagged together during an annotated illness period; Lukas Berg's Isolation is at Watch in the same window. |

## Alerts and notifications

**Model alert policy** (from `Model/README.md` section 7.1; defaults, not clinician-tuned):

- **Critical (RED)** raises an alert immediately.
- **Watch (ORANGE)** raises an alert only after **2 consecutive** readings (a single ORANGE is common among false alarms).
- An alert clears after **2 consecutive lower** readings.
- **Never** from the anomaly score alone, and never from the model's own overall output. Alerts come from per-hazard levels (plus the rule engine, tagged `source: "rule"`).

**Routing** (from `TODO.txt`):

| Alert | Raised by | Goes to |
|---|---|---|
| Model alert | model, per hazard | Doctor **and** Astronaut |
| Rule alert | heart / SpO₂ rule engine | Doctor and Astronaut |
| Send Alert | the astronaut, by hand | **Doctor only** |

The Doctor gets a toast and a bell badge, and manages alerts on the **Alerts** page. **Acknowledge** records who has seen an alert and when; it **never changes the clinical risk state**. The astronaut sees "Seen by ..." under their Send Alert once it is acknowledged.

How the `TODO.txt` items map to the app:

| TODO item | Where it is |
|---|---|
| 5 Hazards tab | "5 Hazards" in both views, model-driven |
| Doctor contact tab (Astronaut View) | Astronaut View → "Doctor" |
| Astronaut contact tab (Doctor View) | Doctor View → "Astronauts" |
| Send Alert (Astronaut View) | My Status → "Send Alert" |
| Model Alert | alert policy above, to both views |
| Notifications | bell and toast in both views; Alerts page with Acknowledge for the Doctor |

## 30-second pitch and 3-minute demo script

### 30-second pitch

> The doctor can be up to about 44 minutes round trip away. Hygieia is an offline-first health monitor that works on board. Every six hours our model checks each astronaut against NASA's five hazards: radiation, isolation, distance, gravity and closed environments. The astronaut sees one status, Normal, Watch or Critical, and one next action. The medical officer sees the whole crew and every countermeasure. No network needed. Today it replays recorded mission data; live sensors come next.

About 77 words, roughly 30 seconds at a normal speaking pace. The 44-minute figure comes from our own project brief (`Prompt.md`), not from a source in this repository: check it before you quote it as fact.

### Before you go on stage

1. **Stop the backend**, then clear old demo data (dry run first to see the counts; see [Running it](#running-it)):
   ```bash
   backend/.venv/bin/python backend/scripts/reset_data.py --local
   backend/.venv/bin/python backend/scripts/reset_data.py --yes --local
   ```
2. **Start the backend paused, at 1 reading per second, offline on purpose** (the Offline-mode beat at the end depends on this):
   ```bash
   REPLAY_AUTOPLAY=0 REPLAY_SECONDS_PER_SLOT=1 MONGODB_URI= backend/.venv/bin/uvicorn app.main:app --app-dir backend --port 8000 --timeout-graceful-shutdown 2
   ```
3. **Start the frontend:** `cd frontend && npm run dev`.
4. **Open two windows side by side**, each at least 900 px wide (a 1920 px screen split in half works; narrower windows switch to the phone/tablet layout, where the Scenarios chips start collapsed, so click **Scenarios** to open them):
   - **Left window, "L", Astronaut:** <http://localhost:5173/?theme=deepSlate#/astronaut/status>
   - **Right window, "R", Doctor:** <http://localhost:5173/?theme=deepSlate#/doctor/overview>
5. Check that both headers say **Offline mode**, both bell badges are empty, and the bar at the bottom reads "1 reading / 1 s". **Click through the whole script once with a stopwatch**, then stop the backend and repeat steps 1 and 2 so the Alerts page starts empty on stage.

To show **Synced** instead (with an Atlas URI in `.env`), drop the `MONGODB_URI=` prefix and change the last beat: say the data is mirrored to MongoDB Atlas and catches up after a loss of link. The rest of the script is identical.

### 3-minute script

All six scenario chips are in the bar at the bottom of each window; the script uses five. **Clicking a chip in L also switches L to that scenario's astronaut.** Play, Pause and Step are the buttons at the bottom left: **Play replay**, **Pause replay**, **Step one reading** (skip-next icon).

| Time | Do (window: click) | Say |
|---|---|---|
| **0:00-0:20**<br>Nominal | L: chip **Nominal**, then nav **5 Hazards**.<br>R: stay on Crew Overview. | "Recorded mission data through our real model, no network: the badge says Offline mode. Six astronauts, all Normal. Every six hours we track fourteen measurements, from heart rate and sleep to cabin CO₂ and radiation dose, grouped into NASA's five hazards. Each card says in one line what it covers and which signals feed it." |
| **0:20-1:00**<br>Radiation Critical, Send Alert, Acknowledge | L: chip **Radiation: Critical (one crew member at a time)**, nav **My Status**, then **Step one reading** once. A toast appears in both windows.<br>L: scroll down to the **Need help?** card, click **Send Alert**, choose **I feel unwell**, click the red **Send Alert**, then **Close**.<br>R: on Crew Overview, **Priority alerts** lists the help request first; click its **Acknowledge**.<br>L: the **Need help?** card now reads "Seen by Dr. Lena Ortiz". | "One radiation reading and Space Radiation is Critical. The astronaut gets one action: go to the shielded area. Critical alerts fire at once; a Watch needs two readings in a row." (Send Alert) "If they need help, Send Alert goes straight to the medical officer." (Acknowledge) "The doctor acknowledges; the astronaut sees 'Seen by Dr. Lena Ortiz'. Acknowledging never changes the risk status. At Critical the astronaut is told to contact the flight surgeon." |
| **1:00-1:35**<br>Cabin environment | L: chip **Cabin environment: Watch, then Critical (whole crew)**, then **Play replay**. About 5 s later My Status reads "Critical: Environment"; click **Pause replay**.<br>L: nav **Body Preview**; point at Blood.<br>R: Crew Overview, all six crew Critical. | "Cabin CO₂ rises. Hostile/Closed Environments goes Watch, then Critical, for the whole crew at once. On the body map it shows under Blood: that mapping is ours, the model itself only has the five hazards." |
| **1:35-2:10**<br>Isolation | L: chip **Isolation: Watch, then Critical (one crew member)** (L is now Amina Diallo), nav **My Status**, then **Step one reading** three times: "Watch: Isolation" and "Plan at least 7 hours of sleep tonight."<br>L: **Play replay**; about 11 s later it reads "Critical: Isolation" and "Stop work and rest now."; click **Pause replay**. | "Days of short sleep. Two Watch readings in a row raise the alert, and the astronaut gets one protective action before anything is Critical: plan seven hours of sleep." (Play) "Left alone, it escalates to Critical and the action becomes: stop work and rest." |
| **2:10-2:45**<br>Multiple hazards | L: chip **Multiple hazards: Distance and Isolation Critical, Gravity Watch** (L is now Kenji Sato), then **Play replay**; after about 10 s click **Pause replay**. Then click **Step one reading** until Kenji's row in R shows Isolation **Critical** (at most two clicks, none if it already does; that state only lasts three readings, so do not let it play on).<br>R: Crew Overview lists **Kenji Sato** first (Isolation and Distance Critical, Gravity Watch) and Lukas Berg second (Watch); click Kenji's row to open **Crew Member**; point at **Countermeasures**. | "The triage matrix puts the sickest astronaut first. Distance from Earth Critical means the crew acts on their own and logs everything for delayed uplink to Earth. The doctor sees every countermeasure, worst hazard first; the astronaut only ever sees one." |
| **2:45-3:00**<br>Offline and themes | R: hover the **Offline mode** badge (tooltip: "Running on the local data store. No database link is configured.").<br>R: header **Cabin theme**: choose **Paper**, then **True Black**, then **Deep Slate**. | "No network, end to end. With a link it mirrors to MongoDB Atlas and catches up. Paper for a printable manifest, True Black for night shifts. Replay of recorded data, flagged for review, not a diagnosis." |

**Rehearsed through the API** against this exact launch command, at 1 reading per second: the radiation segment reaches Critical one step after the jump; the cabin segment reaches Critical after about 5 s of play; isolation shows Watch after 3 steps and Critical after about 11 s more; the multi-hazard label is fully true 11 readings after the jump and stays true for only 3 readings, which is why that row says to pause early and step. The wording on screen is quoted from that run. Narration timing is yours to rehearse.

**If something goes wrong on stage:** a missed toast is still in the bell badge and on the **Alerts** page. Clicking any scenario chip again jumps back to its start, so any segment can be repeated (open model alerts are then marked cleared as "replay moved"). If the replay runs on by itself, click **Pause replay**.

### How the demo answers NASA's five questions

The five questions are the ones listed in `Prompt.md`. The last column says plainly what the app does *not* cover.

| NASA question | Where in the demo | What the app shows | Not covered |
|---|---|---|---|
| 1. Which non-invasive measurements are tracked? | 0:00, 5 Hazards | 14 measurements per 6-hour reading, listed per hazard on each card (heart rate, HRV and blood pressure feed the Heart tile rule) | values come from recorded, simulated data, not sensors |
| 2. Why is each exam needed, in plain English? | 0:00, 5 Hazards | one plain sentence per hazard on what it covers and which signals feed it; AI Chat's offline answers say what is flagged | only that one sentence per hazard: no per-measurement explanation of why an exam is needed, and no step-by-step self-exam instructions |
| 3. How do spaceflight hazards drive the changes? | 0:20 radiation, 1:00 cabin | a hazard rises, its history strip, the body-system tile and the overall status change with it | Muscles and Bones are only a proxy of the Gravity hazard |
| 4. When to escalate to the Crew Medical Officer or Earth? | 0:20 Send Alert and Acknowledge, 2:10 Distance | Critical alerts at once, Watch after 2 readings, "Contact flight surgeon" at Critical, Send Alert; the Distance catalog says to act autonomously and log for delayed uplink | no Earth-downlink packet or delay simulation is built |
| 5. Which preventive countermeasures stop it turning Critical? | 1:35 Isolation Watch, 2:10 Doctor's list | one protective action at Watch, before Critical; the doctor sees all catalog countermeasures | plain-language wording is a demo draft that mission clinicians must validate |


## Limitations

Read these before presenting or reusing anything.

**It is a replay, not live monitoring.** All data is a recorded, simulated dataset (six astronauts, 1,095 days). Live scoring from raw sensor readings is blocked until a v3 model: three groups of features (baseline deviations, the 7-day rolling statistics, four composite risk scores) cannot be reproduced from a single reading with certainty (`Model/README.md` section 2). The model scores a 6-hour snapshot, so an alert can lag by 6-12 hours; minute-level protocol alerts would need a separate rule engine.

**RED detection is unvalidated, and some hazards are weak.** From the held-out test period (the last 20% of the mission, days 877-1095), per `Model/README.md` section 8:

| Hazard | What the test period showed | What it means |
|---|---|---|
| Radiation | no flagged rows | unproven |
| Gravity | Watch recall 71% | informative; the model never outputs Critical for gravity |
| Isolation | Watch recall 38% | misses most Watch-level readings |
| Distance | Watch recall 0% | has not detected a Watch-level reading in evaluation; do not rely on it alone |
| Environment | no flagged rows | unproven |

The test period contained **no RED rows at all**, so Critical detection has never been tested. The model README says the labels are derived from thresholds in the style of NASA-STD-3001, so high scores show the model learned those rules, not clinical validity. The model's overall accuracy is below an always-GREEN baseline, so it is not quoted as a product claim, and the app never shows probabilities or "confidence". Statuses always read "flagged for review", never "diagnosis".

**The anomaly score is context only.** About a third of the recorded readings fall below 0 on it, so it never raises an alert and appears only in the Doctor View.

**Heart and SpO₂ thresholds are placeholders.** The rule engine's limits (`PROTOCOL` in `backend/app/rules.py`) are demo values chosen by us, not a mission medical protocol. On this dataset the heart rule reaches Watch on about 300 of 26,280 readings and never raises an alert, and the SpO₂ rule never fires (recorded SpO₂ never drops below about 95%). The "recorded dose so far" shown to the doctor is the sum of per-reading values with no dose-limit rule, because the dose window per reading is unconfirmed.

**Body-system tiles are a mapping, not measurements.** Muscles and Bones follow the Gravity hazard as a labelled proxy. There is no bone, muscle, blood-count or lab data anywhere in the model.

**AI Chat is canned.** It is labelled **"Offline demo answers"**: fixed templates filled from the astronaut's latest reading. No language model runs. Ollama appears in `Tech_Stack.png` but is not integrated.

**The body preview is 2D.** A schematic SVG figure plus an equivalent list, instead of a 3D model. Phaser (also in `Tech_Stack.png`) is not used.

**Crew names are samples.** The dataset only has IDs (`ASTRO_001` to `ASTRO_006`) and baselines. Names and roles are illustrative; Alex Morgan and Dr. Lena Ortiz come from the design PDFs. The crew records say `sample_profile: true`.

**No accounts or login.** The Astronaut / Doctor toggle and the "signed in as" picker are UI controls, and acknowledgements are recorded under the Crew Medical Officer's name. Anyone who can open the page can use either view. There is no Earth-downlink packet, communication-delay simulation or voice cue.

**Prototype engineering limits.** Single backend instance only (not designed for several backends sharing one database). CORS and the dev proxy assume `localhost:5173`; there is no production deployment setup. After the backend dies, the page can take up to roughly 40 seconds to show "No link". Tested in Chromium-based browsers (Chrome, Brave) only, not Firefox or Safari, and not audited with assistive technology.

**Deliberate differences from the design PDFs** (`Heigieia_astro_view.pdf`, `Heygenia_Doc_View.pdf`):

- The PDFs are light-only. **Paper** is the light theme closest to them; **Deep Slate** (default) and **True Black** are dark themes from the brand sheet.
- "3D Preview" is a 2D figure called **Body Preview**, with no Skin/Skeleton toggle or rotate/zoom controls.
- Astronaut AI Chat: the PDFs show five states (empty, active, critical, error, offline). Built: empty, active (canned answers) and the Critical banner. Not built: the error/retry state and a separate offline state; the answers are always labelled offline demo answers.
- Doctor Overview: **no overall health score (84/100)**. The model does not produce one and we did not invent one; the page shows the worst-hazard status and counts instead. No System balance radar and no Recent events panel; the Settings and Help links are not built.
- Doctor per-system pages (Heart, Brain, Blood, Muscles, Radiation, Bones) with lab-style values such as hemoglobin or bone density are replaced by **one Crew Member page**: six system tiles, countermeasures, model context and trends. Those lab values are not model inputs or outputs (`Model/README.md` section 9) and we have no data for them.
- The Alert-detail page (SpO₂ chart and review checklist) is replaced by alert rows with an Acknowledge button.
- Added beyond the PDFs because `TODO.txt` asks for them: the 5 Hazards tab, both contact tabs, Send Alert, notifications, the scenario bar, the theme switcher and the Offline indicator.
- The PDFs' "Emblem asset pending" placeholder is replaced with the real lockups from `brand_designing/`.

## Repository layout

```
Model/               trained v2 model files, dataset, notebook, README (read-only, do not edit)
backend/app/         FastAPI app: model service, replay engine, alert policy, rules, storage, API
backend/tests/       39 tests (scoring parity, alert policy, scenarios, API, storage failover, reset script)
backend/scripts/     reset_data.py: clears demo data (dry run by default)
frontend/            React + MUI app (Vite); brand assets are in frontend/public/assets/
brand_designing/     brand identity sheet and lockups (note: subfolder names have trailing spaces)
Heigieia_astro_view.pdf, Heygenia_Doc_View.pdf   the Astronaut and Doctor design PDFs
Tech_Stack.png       the planned stack; TODO.txt the feature list; Prompt.md, Prompt_v2.md the dev briefs
.env.example         placeholder settings (copy to .env; .env is git-ignored)
```
