You are a principal full-stack architect, ML engineer, and space-medicine UX specialist building **Hygieia**—an autonomous, offline-first deep-space flight surgeon for the **2026 NASA International Space Apps Challenge** (*"Create Health Monitoring Software for Astronauts on Space Missions"*).

On a deep-space mission (such as Mars transit), round-trip radio latency reaches up to 44 minutes—astronauts cannot wait for Houston during a medical issue and are not trained physicians. Our goal is to fuse our trained ML models, UI designs, and brand system inside `/Hygieia` into an award-winning, working full-stack application that answers NASA's 5 core judging questions: (1) which non-invasive measurements are tracked, (2) why each exam is needed in plain English, (3) how spaceflight hazards drive those changes, (4) when to escalate to the Crew Medical Officer or Earth, and (5) what preventive countermeasures stop a condition from turning critical.

### Full Creative & Technical Autonomy
Treat our existing files, designs, and `Tech_Stack.png` as your core foundation—**and go beyond them wherever you see an opportunity to make the app noticeably smarter, smoother, and more impressive.** You have full freedom to install and integrate any additional libraries, UI packages, charting/animation engines, explainable-AI utilities, audio/TTS triage cues, predictive forecasting, or high-impact space-medicine features that elevate Hygieia into a global-finalist prototype, as long as everything stays cohesive with our brand identity and runs reliably offline.

---

### Phase 1: Mandatory Workspace & Asset Discovery
Before writing any code, inspect every file in `/Hygieia` so nothing is guessed or duplicated:
1. **Project Specs & Remaining Tasks:**
   - Read `README.md`, `TODO.txt`, and `Model/README.md`.
2. **ML Pipeline & Trained Artifacts:**
   - Inspect `Model/outputs/model_metadata_v2.json`, `Model/outputs/countermeasures_v2.json`, and the headers/sample rows of `Model/astronaut_health_dataset_v2.csv` and `Model/outputs/test_predictions_v2.csv`.
   - Inspect `Model/new.ipynb` and run a quick Python check on `Model/outputs/feature_columns_v2.pkl`, `feature_scaler_v2.pkl`, `gradient_boosting_model_v2.pkl`, `isolation_forest_model_v2.pkl`, and `hazard_models_v2.pkl` to verify exact feature schemas, preprocessing steps, class labels, and prediction outputs.
3. **UI Designs, Tech Stack & Brand Identity:**
   - Visually inspect `Tech_Stack.png` to anchor our core stack and architecture.
   - Render/inspect `Heigieia_astro_view.pdf` (Astronaut View) and `Heygenia_Doc_View.pdf` (Crew Medical Officer / Doctor View) to match every screen, card, chart, and navigation flow.
   - Inspect `brand_designing/Hygieia — Mission health identity-identity.pdf` (and `.png`) plus all SVG/PNG assets inside `brand_designing/` (`Hygieia emblem — master.svg`, `Deep slate`, `True black`, `Paper`, and `Single ink`). **CRITICAL PATH NOTE:** Subdirectories inside `brand_designing/` contain trailing spaces (e.g., `'Deep slate '`, `'True black '`, `'Paper '`, `'Single ink '`, `'Export '`). Handle paths carefully and copy clean, web-safe filenames into the frontend's `public/assets/` directory.
4. **Connected MCP & Git Tools:**
   - Check available MCP servers (**MongoDB MCP** and **GitHub**) so we persist telemetry, check-ins, and alerts in MongoDB and commit clean milestones to GitHub.

---

### Phase 2: Backend & Edge ML Engine (FastAPI + Trained v2 Models + MongoDB + Offline Mode)
Build a production-grade backend anchored on `Tech_Stack.png` and enhanced with any supporting libraries that strengthen clinical explainability and real-time responsiveness:
1. **Model Registry & Explainable Inference Service:**
   - Load `feature_columns_v2.pkl`, `feature_scaler_v2.pkl`, `gradient_boosting_model_v2.pkl`, `isolation_forest_model_v2.pkl`, `hazard_models_v2.pkl`, and `countermeasures_v2.json` at startup.
   - Build a unified `/api/predict` (plus WebSocket/SSE live telemetry stream if beneficial) pipeline that transforms incoming vitals + spacecraft cabin environment telemetry, computes anomaly scores (`IsolationForest`), risk severity (`GradientBoosting`), predicted spaceflight hazards (`hazard_models`), rolling personal baseline drift (EWMA / Z-score deltas), and feature-contribution drivers ("why the model flagged this").
   - Map every prediction to plain-English clinical explanations, NASA **RIDGE** spaceflight hazards (**R**adiation, **I**solation/Confinement, **D**istance from Earth, **G**ravity fields, **E**nvironments), step-by-step non-doctor self-exam instructions, and actionable protocols from `countermeasures_v2.json`.
2. **MongoDB Persistence with 100% Offline Deep-Space Resilience:**
   - Seed MongoDB via the MongoDB MCP (or idempotent startup script) using `astronaut_health_dataset_v2.csv` and `test_predictions_v2.csv` for a multi-astronaut crew.
   - Include an automatic local CSV/JSON fallback cache so if MongoDB or network connectivity is unreachable, the app seamlessly runs **100% offline**—explicitly demonstrating autonomous Mars-transit resilience.
3. **Interactive Endpoints & Mission Utilities:**
   - `GET /api/crew` & `GET /api/telemetry/{astronaut_id}`: Historical time-series vitals, rolling personal baselines, short-horizon risk projection, and cabin environment context ($CO_2$, radiation dose, mission Sol).
   - `POST /api/checkin`: Persists daily astronaut check-ins (sleep hours, mood/stress, hydration, resistive exercise) and updates gamified readiness scores & streaks.
   - `POST /api/simulate`: Injects live spaceflight scenarios for our hackathon pitch demo (*Solar Particle Event*, *Cabin CO₂ Scrubber Lag*, *30-Day Microgravity Fluid Shift / SANS*, *Acute Sleep Deprivation*, or *Reset to Nominal*) and runs real inference on the perturbed telemetry.
   - Add any high-value endpoints that elevate the mission workflow (e.g., generating a compressed **Earth-Downlink Medical Telemetry Packet** with simulated 22-minute one-way Mars transmission delay status, or voice/audio alert cues for critical events).

---

### Phase 3: Dual-Role Frontend (`Astro View` + `Doc View` + Brand System + Judge Demo Controls)
Build a polished, ultra-responsive frontend matching `Heigieia_astro_view.pdf`, `Heygenia_Doc_View.pdf`, and `brand_designing/`, adding any micro-interactions, visualizations, or UX upgrades that make it feel like real flight software:
1. **Exact Brand Identity & Cabin Theme Switcher:**
   - Apply the exact color tokens, typography, and copied SVGs from `brand_designing/`.
   - Support seamless switching between **Deep Slate** (primary operational HUD), **True Black** (low-glare cabin/night mode), and **Paper** (high-contrast printable mission manifest view).
2. **Astronaut View (`Heigieia_astro_view.pdf`):**
   - **At-a-Glance Triage HUD:** Color-coded status indicators (Nominal / Watchlist / Critical) with sparklines and baseline deltas for Heart Rate, Blood Pressure, Blood Sugar, Core Temp, Sleep, and Mood.
   - **Interactive Human Body "Digital Twin":** Clickable anatomical SVG map color-coded by organ/system risk. Clicking **Head/Eyes** opens Neuro-Ocular (SANS) & cognitive fatigue status plus an interactive **30-second Amsler Grid self-test**; clicking **Heart/Chest** opens cardiovascular & orthostatic tolerance trends; clicking **Muscles/Bones** opens microgravity deconditioning & ARED exercise load. Every organ drawer explains *why* the exam matters in plain English and gives step-by-step self-check instructions.
   - **Dynamic Baseline Drift Charts:** Interactive time-series charts showing personal healthy baseline bands, mission-day drift, and predicted trajectory.
   - **Plain-English Action & Countermeasure Cards:** Structured into three clear tabs: *What's Happening* (zero medical jargon + top contributing biomarkers), *Self-Check Protocol*, and *Preventive Countermeasure*.
   - **Gamified Mission Readiness Loop:** Daily 30-second check-in modal/widget driving a Mission Readiness Ring (0–100%), compliance streaks, and crew readiness milestones.
3. **Doctor / Crew Medical Officer View (`Heygenia_Doc_View.pdf`):**
   - **Crew-Wide Triage Matrix:** Fleet overview comparing all crew members' vitals, hazard probabilities, and anomaly scores side-by-side.
   - **Guided "Peer-Medic" First-Responder Mode:** When any astronaut enters Amber/Red status, automatically surfaces a step-by-step peer-assist protocol so a non-doctor crewmate can perform vital checks, administer onboard medical kit countermeasures, and queue an Earth-downlink medical packet.
4. **Docked "Mission Event Simulator" Bar (Judge Demo Secret Weapon):**
   - Add a sleek, collapsible simulator bar at the bottom of the screen allowing us during our 3-minute live pitch to trigger *Solar Particle Event*, *Cabin CO₂ Spike*, *Microgravity Fluid Shift (SANS)*, or *Nominal Orbit* and watch the ML backend, body map, drift charts, and triage protocols update in real time.

---

### Phase 4: Complete `TODO.txt`, Verify End-to-End & Prepare GitHub Submission
1. Execute every remaining requirement in `TODO.txt`.
2. Start the backend and frontend, test every endpoint and UI interaction, verify real `.pkl` model inference returns accurate predictions with zero errors, verify MongoDB persistence + offline fallback, and fix any console or layout issues.
3. Update the root `README.md` with our project overview, NASA OSDR/HRP scientific grounding, system architecture, local setup instructions, and a 30-second pitch + 3-minute judge demo script, then make clean Git commits ready for GitHub push.

Start now with **Phase 1**: inspect all files, PDFs, images, model artifacts, and `TODO.txt`, give a concise 10–15 line summary of what you discovered and your concrete build + enhancement plan, and immediately build and verify the complete system.
