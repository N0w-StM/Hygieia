# Hygieia Health Model (v2): Integration Guide for the App Builder

This document tells you everything you need to wire the trained model into the two Hygieia apps (**Astronaut view** and **Doctor / Mission-health-officer view**): what goes in, what comes out, how to run it, how its outputs map onto the screens in the design system, and what it can **not** do.

It describes the model only. It does not specify the app features in `TODO.txt` (contact tabs, send-alert, notifications UI); it only says where model outputs plug into them.

---
# the Models

Retrained ensemble for NASA's Five Hazards of Human Spaceflight using `astronaut_health_dataset_v2.csv`.

## Results (temporal hold-out: last 20% of the mission)

- Rows: 26,280 | Features: 47 | Train: 21,024 | Test: 5,256
- Overall accuracy: 93.11% | Balanced accuracy: 61.97% | Macro-F1: 0.3710
- RED recall: n/a (RED events missed as GREEN: 0 of 0)
- Leave-astronauts-out CV: accuracy 96.85% / macro-F1 0.6062 (mean over 5 folds)

| Hazard | Accuracy | Weighted F1 | RED recall |
|---|---|---|---|
| Radiation | 100.00% | 1.0000 | n/a |
| Gravity | 99.24% | 0.9935 | n/a |
| Isolation | 97.36% | 0.9779 | n/a |
| Distance | 99.45% | 0.9969 | n/a |
| Environment | 100.00% | 1.0000 | n/a |

> Note: the alert labels are derived from NASA-STD-3001-style thresholds, so very high scores are
> expected. Treat them as proof the model learned the rules, not as clinical validation.

## Architecture

1. Isolation Forest (unsupervised) produces an anomaly score.
2. Gradient Boosting predicts the overall GREEN / ORANGE / RED status (anomaly score is an extra feature).
3. One Gradient Boosting classifier per hazard (radiation, gravity, isolation, distance, environment).
4. Safety rule: the final overall status is never lower than the worst per-hazard prediction.

## Files

| File | Purpose |
|---|---|
| `isolation_forest_model_v2.pkl` | anomaly detector |
| `gradient_boosting_model_v2.pkl` | overall status classifier |
| `hazard_models_v2.pkl` | dict of per-hazard classifiers |
| `feature_scaler_v2.pkl` | StandardScaler fitted on training data |
| `feature_columns_v2.pkl` | ordered feature names |
| `countermeasures_v2.json` | NASA-protocol countermeasure database |
| `model_metadata_v2.json` | metrics, versions, split info |
| `test_predictions_v2.csv` | per-row test predictions |

## Usage

```python
# load artifacts and define predict_health_status_v2 (see Step 17 of the notebook)
result = predict_health_status_v2(sensor_data, baseline_data, history=recent_readings)
print(result['overall_status'], result['hazards'])
```

`sensor_data` needs the raw readings (heart_rate, hrv_rmssd, sbp, dbp, core_temp, spo2, sleep_hours,
mood_score, pvt_reaction_ms, fluid_intake_ml, co2_mmhg, radiation_msv, sans_trt_um, vo2max, mission_day).
`baseline_data` needs baseline_hr, baseline_hrv_rmssd, baseline_sbp, baseline_dbp, baseline_spo2.
Derived features (deviations, risk scores, 7-day rolling stats) are computed inside the function.

Install: `pip install numpy pandas scikit-learn matplotlib joblib` (models were saved with scikit-learn 1.7.1).

## 0. Read this first (the 8 facts that matter)

1. **The model classifies one reading at a time into GREEN / ORANGE / RED** for each of NASA's **five hazards** (radiation, gravity, isolation, distance, environment) plus an overall level. These map to the UI's **Normal / Watch / Critical**.
2. **The model's unit of work is a 6-hourly health snapshot** (4 per astronaut per day), not a live sensor stream. Minute-level alerts (e.g. "SpO₂ < 94 % for 3 min") must come from a **separate deterministic rule engine** that uses mission-protocol thresholds. The model cannot do them.
3. **The model has five hazard outputs, but the UI has six body systems.** There is no 1-to-1 mapping; see [section 6](#6-mapping-model-outputs-to-the-ui). The "5 Hazards" tab in `TODO.txt` *is* a 1-to-1 match.
4. **Replay mode works today; live single-reading mode is blocked.** The notebook's single-reading function reproduces the training features incorrectly (four risk-score formulas don't match the dataset). Build against the record contract in [section 4](#4-outputs-what-you-get-back) and feed it by replaying `astronaut_health_dataset_v2.csv` until model v3 ships ([section 2](#2-readiness-and-blockers)).
5. **Show the per-hazard levels. Treat the model's own "overall" output as secondary.** It performed worse than the per-hazard models. The recommended overall status is the worst hazard level.
6. **The anomaly score is context, never an alert trigger by itself.** The detector was configured to flag 15 % of training data as anomalous by design.
7. **RED detection is unvalidated.** The held-out test period contained no RED rows. UI copy must say "flagged for review", never "diagnosis".
8. **The model runs fully offline** (pickled scikit-learn objects, no network calls), which suits the offline-first requirement in the design system.

---

## 1. What the model is

```
raw readings + preflight baseline + mission context
      │
      ▼
feature engineering ── 47 features
      │
      ▼
StandardScaler ──► Isolation Forest ──► anomaly score (the 48th input)
      │                                        │
      └────────────────────┬───────────────────┘
                           ├─► Gradient Boosting          → overall level (0/1/2)
                           └─► 5 × Gradient Boosting      → one level (0/1/2) per hazard
```

- Trained on `astronaut_health_dataset_v2.csv`: 26,280 rows, 6 astronauts, 1,095 days, 4 readings/day.
- Levels: `0 = GREEN`, `1 = ORANGE`, `2 = RED`.
- Everything is **individualised**: deviations are measured against each astronaut's own preflight baseline.

---

## 2. Readiness and blockers

| Capability | Status | Notes |
|---|---|---|
| Score rows that already contain all 47 features (**replay mode**) | Works | Use this to drive both apps now |
| Score a single live reading from raw sensors (**live mode**) | Blocked | Feature parity not achieved |
| Per-hazard levels | Usable with caveats | See [section 8](#8-what-the-ui-must-and-must-not-claim) |
| Overall level from the model's own classifier | Not recommended | Use worst-hazard instead |
| Probabilities | Do not show | Over-confident, uncalibrated |

**Why live mode is blocked.** Three of the 47 features cannot be reproduced from a raw reading with certainty:

| Feature group | Count | Status |
|---|---|---|
| Baseline deviations (`hr_deviation`, `hrv_deviation`, `sbp_deviation`, `dbp_deviation`, `spo2_deviation`) | 5 | Assumed `reading − baseline`; consistent with the data |
| Rolling 7-day mean/std of 9 signals (`<signal>_7d_mean`, `<signal>_7d_std`) | 18 | **Window semantics unconfirmed.** In the dataset, the first four readings of day 1 have identical sleep/mood/PVT rolling values, which suggests a daily window, not 28 readings |
| Composite risks (`radiation_risk`, `gravity_risk`, `isolation_risk`, `environment_risk`) | 4 | **Formulas unknown.** The notebook's formulas differ from the dataset's columns (max absolute differences 4.6, 4.1, 10.7, 4.3) |

**Planned fix (model v3):** retrain with features that one shared function computes for both training and serving (drop the four risk columns or recover their formulas, define the rolling window explicitly). The output record in section 4 will not change, so the apps can be built now.

---

## 3. Inputs: what the model needs

### 3.1 Per reading (one per astronaut every 6 hours)

| Field | Unit | Typical source | Range seen in training data |
|---|---|---|---|
| `heart_rate` | bpm | PPG / ECG | 46.9 - 107.5 |
| `hrv_rmssd` | ms | PPG / ECG | 16.6 - 104.4 |
| `sbp` | mmHg | BP cuff | 89.9 - 154.7 |
| `dbp` | mmHg | BP cuff | 46.4 - 89.4 |
| `core_temp` | °C | thermometer | 36.34 - 40.23 |
| `spo2` | % | pulse oximeter | 95.13 - 99.99 |
| `sleep_hours` | h (last sleep period) | actigraphy | 3.5 - 9.5 |
| `mood_score` | 0-100 | questionnaire | not profiled |
| `pvt_reaction_ms` | ms | PVT-B cognitive test | not profiled |
| `fluid_intake_ml` | mL | manual log | not profiled |
| `vo2max` | ml/min/kg | fitness test | not profiled |
| `co2_mmhg` | mmHg | ECLSS telemetry | not profiled |
| `radiation_msv` | mSv **per reading** | dosimeter | not profiled |
| `sans_trt_um` | µm (OCT ΔTRT) | OCT imaging | not profiled |
| `mission_day` | integer ≥ 1 | mission clock | 1 - 1095 |

Notes:

- `mission_day = floor(MET days) + 1`. The UI's `MET 078:14:16` is mission day **79**.
- **Do not feed the UI's units directly.** The astronaut screen shows "0.82 mSv today" (a daily total) and the doctor screen shows cumulative dose (142 mSv). The model expects the dose for one reading window. Confirm the window with the data owner, and compute the per-reading value from the dosimeter log.
- **Aggregate before scoring.** The doctor screens show 5-minute heart-rate readings. Reduce them to one value per 6-hour slot (mean over the slot) before building the model input.
- Missing values are treated as 0 by the pipeline. Never send a placeholder 0 for a missing sensor; mark the reading as incomplete and skip or flag it.

### 3.2 Per astronaut (once, preflight)

`baseline_hr`, `baseline_hrv_rmssd`, `baseline_sbp`, `baseline_dbp`, `baseline_spo2`.

### 3.3 Mission context

The five hazard intensities (0-1) depend on the mission phase. They are model inputs (`hazard_radiation`, `hazard_gravity`, `hazard_isolation`, `hazard_distance`, `hazard_environment`):

| Phase | Mission days | Radiation | Gravity | Isolation | Distance | Environment |
|---|---|---|---|---|---|---|
| launch_adaptation | 1-14 | 0.3 | 0.9 | 0.2 | 0.1 | 0.4 |
| transit_to_mars | 15-180 | 0.9 | 1.0 | 0.6 | 0.7 | 0.5 |
| mars_surface | 181-680 | 0.6 | 0.5 | 0.8 | 1.0 | 0.7 |
| transit_return | 681-860 | 0.9 | 1.0 | 0.9 | 0.6 | 0.5 |
| earth_readaptation | 861+ | 0.1 | 0.7 | 0.1 | 0.0 | 0.2 |

Keep this as backend configuration. Mission day 79 (the design's example) falls in `transit_to_mars`.

### 3.4 The 47 model features (exact names and groups)

Always load the order from `outputs/feature_columns_v2.pkl`; do not hard-code it.

| Group | Count | Columns |
|---|---|---|
| Vitals | 6 | `heart_rate`, `hrv_rmssd`, `sbp`, `dbp`, `core_temp`, `spo2` |
| Behavioural | 4 | `sleep_hours`, `mood_score`, `pvt_reaction_ms`, `fluid_intake_ml` |
| Mission / environment | 4 | `co2_mmhg`, `radiation_msv`, `sans_trt_um`, `vo2max` |
| Hazard context | 5 | `hazard_radiation`, `hazard_gravity`, `hazard_isolation`, `hazard_distance`, `hazard_environment` |
| Deviations | 5 | `hr_deviation`, `hrv_deviation`, `sbp_deviation`, `dbp_deviation`, `spo2_deviation` |
| Rolling mean | 9 | `<s>_7d_mean` for s in heart_rate, hrv_rmssd, sbp, dbp, core_temp, spo2, sleep_hours, mood_score, pvt_reaction_ms |
| Rolling std | 9 | `<s>_7d_std` for the same 9 signals |
| Risk scores | 4 | `radiation_risk`, `gravity_risk`, `isolation_risk`, `environment_risk` |
| Mission clock | 1 | `mission_day` |

---

## 4. Outputs: what you get back

### 4.1 Raw model output (per scored row)

| Field | Type | Meaning |
|---|---|---|
| `level_radiation`, `level_gravity`, `level_isolation`, `level_distance`, `level_environment` | int 0/1/2 | per-hazard level |
| `overall_level` | int 0/1/2 | **worst of the five hazard levels** (recommended). Optionally also include the model's own overall prediction |
| `model_overall` | int 0/1/2 | the overall classifier's own prediction (diagnostic only) |
| `anomaly_score` | float | Isolation Forest `decision_function`; **lower = more unusual**; below 0 is the unusual side |

### 4.2 Status vocabulary

| Model | UI | UI copy (from the design system's "Safe status language") |
|---|---|---|
| GREEN (0) | Normal, green, check | "No action needed." |
| ORANGE (1) | Watch, orange, triangle | "One protective action, with an explanation." |
| RED (2) | Critical, red, octagon | "Immediate action and flight surgeon contact." |

Use the shape and the word together; never colour alone.

### 4.3 Recommended API record (stable across model versions)

This is the contract to code both apps against. `to_record()` in section 5 produces it. The values below are **illustrative, not an actual model run**; they mirror the design's "Watch: Radiation" state.

```json
{
  "astronaut_id": "ASTRO_001",
  "reading_timestamp": "2030-03-19T12:00:00Z",
  "mission_day": 79,
  "model_version": "v2",
  "overall":  { "level": 1, "label": "ORANGE", "ui_label": "Watch" },
  "hazards": {
    "radiation":   { "level": 1, "label": "ORANGE", "ui_label": "Watch" },
    "gravity":     { "level": 0, "label": "GREEN",  "ui_label": "Normal" },
    "isolation":   { "level": 0, "label": "GREEN",  "ui_label": "Normal" },
    "distance":    { "level": 0, "label": "GREEN",  "ui_label": "Normal" },
    "environment": { "level": 0, "label": "GREEN",  "ui_label": "Normal" }
  },
  "primary_action": { "hazard": "radiation", "level": "ORANGE", "action": "Monitor space weather forecasts" },
  "countermeasures": [
    { "hazard": "radiation", "level": "ORANGE", "action": "Monitor space weather forecasts" },
    { "hazard": "radiation", "level": "ORANGE", "action": "Prepare storm shelter access" },
    { "hazard": "radiation", "level": "ORANGE", "action": "Review EVA schedule" }
  ],
  "anomaly": { "score": -0.1112 },
  "unusual_signals": [ { "feature": "radiation_msv", "z": 3.2 } ],
  "diagnostics": { "model_overall_level": 1 }
}
```

- `countermeasures` is ordered worst hazard first, then catalog priority. `primary_action` is its first element.
- `unusual_signals` are the features furthest from the training distribution (z-scores). Doctor view only; they point at *where to look*, not *why*.
- Add `scored_at` and a data-age indicator in the backend so the UI can show real stale-data age, as the design requires.

### 4.4 Countermeasure catalog

`outputs/countermeasures_v2.json`: `{hazard: {"ORANGE": [...], "RED": [...]}}`, three actions per level, priority 1 first. These are protocol-style texts (e.g. "Cancel/abort EVA operations"). The astronaut view needs plain language, so keep a UI-copy layer on top and have mission clinicians validate the wording.

---

## 5. How to run it

### 5.1 Install

```bash
pip install numpy pandas scikit-learn joblib
```

Use the scikit-learn version in `outputs/model_metadata_v2.json` (`sklearn_version`); pickles may fail under a different one.

### 5.2 Score rows and build API records (tested on mock artifacts)

```python
import json
import joblib
import numpy as np
import pandas as pd

ART = 'outputs'
iso_forest    = joblib.load(f'{ART}/isolation_forest_model_v2.pkl')
gb_model      = joblib.load(f'{ART}/gradient_boosting_model_v2.pkl')
hazard_models = joblib.load(f'{ART}/hazard_models_v2.pkl')
scaler        = joblib.load(f'{ART}/feature_scaler_v2.pkl')
feature_cols  = joblib.load(f'{ART}/feature_columns_v2.pkl')
with open(f'{ART}/countermeasures_v2.json') as f:
    COUNTERMEASURES = json.load(f)

HAZARDS  = ['radiation', 'gravity', 'isolation', 'distance', 'environment']
LABEL    = {0: 'GREEN', 1: 'ORANGE', 2: 'RED'}
UI_LABEL = {0: 'Normal', 1: 'Watch', 2: 'Critical'}

def score_readings(df, include_overall_model=False):
    """Score rows that already contain every column in feature_cols.
    Returns (results DataFrame, standardised feature matrix)."""
    missing = [c for c in feature_cols if c not in df.columns]
    if missing:
        raise ValueError(f'Missing feature columns: {missing}')
    X = (df[feature_cols].apply(pd.to_numeric, errors='coerce')
                         .replace([np.inf, -np.inf], np.nan).fillna(0).astype(float))
    Xs = scaler.transform(X)
    anomaly = iso_forest.decision_function(Xs)
    Xe = np.column_stack([Xs, anomaly])

    out = pd.DataFrame(index=df.index)
    for h in HAZARDS:
        out[f'level_{h}'] = hazard_models[h].predict(Xe).astype(int)
    out['model_overall'] = gb_model.predict(Xe).astype(int)
    cols = [f'level_{h}' for h in HAZARDS] + (['model_overall'] if include_overall_model else [])
    out['overall_level'] = out[cols].max(axis=1)
    out['anomaly_score'] = anomaly
    return out, Xs

def top_unusual_signals(z_row, k=3):
    """Features furthest from the training distribution (doctor view only; not causal)."""
    idx = np.argsort(-np.abs(z_row))[:k]
    return [{'feature': feature_cols[i], 'z': round(float(z_row[i]), 2)} for i in idx]

def to_record(row, z_row, meta):
    """meta = {astronaut_id, reading_timestamp, mission_day}"""
    levels = {h: int(row[f'level_{h}']) for h in HAZARDS}
    overall = int(row['overall_level'])
    actions = []
    for h in sorted(HAZARDS, key=lambda x: -levels[x]):          # worst hazard first
        if levels[h] >= 1:
            for a in COUNTERMEASURES[h][LABEL[levels[h]]]:       # catalog order = priority order
                actions.append({'hazard': h, 'level': LABEL[levels[h]], 'action': a})
    return {
        **meta,
        'model_version': 'v2',
        'overall': {'level': overall, 'label': LABEL[overall], 'ui_label': UI_LABEL[overall]},
        'hazards': {h: {'level': l, 'label': LABEL[l], 'ui_label': UI_LABEL[l]} for h, l in levels.items()},
        'primary_action': actions[0] if actions else None,
        'countermeasures': actions,
        'anomaly': {'score': round(float(row['anomaly_score']), 4)},
        'unusual_signals': top_unusual_signals(z_row),
        'diagnostics': {'model_overall_level': int(row['model_overall'])},
    }
```

### 5.3 Replay mode (use this to build and demo the apps now)

Simulate the live mission by stepping through the dataset one 6-hour slot at a time. The dataset rows already contain all 47 features, so scoring is exact:

```python
df = pd.read_csv('astronaut_health_dataset_v2.csv')
res, Z = score_readings(df)                      # whole dataset at once, or slice by slot

row = df[(df.astronaut_id == 'ASTRO_001') & (df.mission_day == 79) & (df.sample_id == 2)]
i = df.index.get_loc(row.index[0])
record = to_record(res.iloc[i], Z[i], {
    'astronaut_id': 'ASTRO_001',
    'reading_timestamp': str(df.loc[row.index[0], 'timestamp']),
    'mission_day': 79,
})
```

For the doctor's 7 d / 30 d / Mission trend ranges, store every scored record and aggregate in the backend. The model returns nothing time-series by itself.

### 5.4 Live mode (target, not yet available)

Request the backend should accept once model v3 is in place (the client never sends history; the backend keeps the rolling buffer):

```json
{
  "astronaut_id": "ASTRO_001",
  "reading_timestamp": "2030-03-19T12:00:00Z",
  "mission_day": 79,
  "readings": { "heart_rate": 62, "hrv_rmssd": 55, "sbp": 118, "dbp": 72, "core_temp": 37.8, "spo2": 98,
                "sleep_hours": 7.4, "mood_score": 70, "pvt_reaction_ms": 260, "fluid_intake_ml": 2500,
                "vo2max": 42, "co2_mmhg": 2.2, "radiation_msv": 0.2, "sans_trt_um": 8 },
  "baseline": { "baseline_hr": 65, "baseline_hrv_rmssd": 80, "baseline_sbp": 115,
                "baseline_dbp": 75, "baseline_spo2": 98 }
}
```

Response: the record in section 4.3. (Values above are illustrative.)

---

## 6. Mapping model outputs to the UI

### 6.1 The five hazards ↔ the "5 Hazards" tab

A direct 1-to-1 match, so this tab can be fully model-driven:

| Model key | Tab label (from `TODO.txt`) | Main signals behind it |
|---|---|---|
| `radiation` | Space Radiation | radiation dose, solar particle events |
| `isolation` | Isolation and Confinement | sleep, mood, PVT reaction time |
| `distance` | Distance from Earth | combination of critical signals needing autonomous response |
| `gravity` | Gravity Fields | core temperature, SANS (ΔTRT), VO₂max |
| `environment` | Hostile/Closed Environments | CO₂, SpO₂, fluid intake |

### 6.2 The six body systems (Overview / My Status tiles)

The model has **no per-body-system output.** This mapping is a **product decision to confirm with mission clinicians**; the defaults below are proposals:

| UI system | Status source | Notes |
|---|---|---|
| Brain | model `isolation` | sleep, mood, PVT feed it |
| Heart & Blood Vessels | **rule engine** (HR, HRV, BP vs. protocol ranges) | no dedicated model output |
| Blood | model `environment` **plus** SpO₂ rule | the design's critical alert is a 3-minute SpO₂ rule |
| Muscles | model `gravity` (shared) | proxy only; the design states activity values are not diagnoses |
| Radiation | model `radiation` **plus** dose-budget rule | cumulative dose vs. mission limit (200 mSv in the designs) is app logic |
| Bones | model `gravity` (shared) | proxy only |
| *(no tile)* | model `distance` | surface as an autonomy banner or in the 5 Hazards tab, and as an alert escalation factor |

### 6.3 What each view should take from the record

| Element | Astronaut view | Doctor view |
|---|---|---|
| Overall status (Normal/Watch/Critical) | Yes | Yes |
| Per-hazard / per-system status | Yes (words and shape) | Yes |
| Next action | **One** (`primary_action`) | All (`countermeasures`) |
| Anomaly score, unusual signals, `model_overall_level`, model version | **No** (design: "no clinical detail") | Yes, as context |
| Probabilities | No | No (uncalibrated) |
| Data age / stale indicator | Yes ("Updated 2 min ago") | Yes |

---

## 7. Where the model plugs into the TODO features

| TODO item | Model involvement |
|---|---|
| 5 Hazards tab | Directly fed by `hazards` (section 6.1) |
| Model Alert (to doctor and astronaut views) | Model produces the trigger data; policy in section 7.1 |
| Notifications (for the doctor) | Consumes model-alert events; the model supplies content only |
| Doctor contact tab, astronaut contact tab, Send Alert | **No model involvement** |

### 7.1 Recommended starting alert policy (tune with clinicians)

The model scores every 6 hours, so alert latency is up to 6-12 h. Use these rules as a starting point:

- **Raise a model alert when** any hazard reaches **RED**: immediately, no debounce.
- **Raise a Watch alert when** any hazard is ORANGE for **2 consecutive scoring slots** (12 h). A single ORANGE is common among false alarms.
- **Clear / de-escalate** after 2 consecutive lower readings.
- **Never alert on `anomaly_score` alone.** By configuration about 15 % of normal training readings fall below 0.
- **Do not drive alerts from `model_overall`** (about 5.6 % of normal test readings were falsely flagged ORANGE by it). Use the worst hazard level.
- Keep the **minute-level protocol rules** (SpO₂ < 94 % for 3 min, resting HR above personal baseline, dose rate, etc.) in a separate rule engine. Both sources can feed the same alert/notification pipeline, with a `source` field (`model`, `rule`, `astronaut`).
- Alert event suggestion: `{alert_id, astronaut_id, source, hazard, level, triggered_at, reading_timestamp, acknowledged_by, acknowledged_at}`. The design requires that acknowledging never changes the clinical risk state.

---

## 8. What the UI must and must not claim

**Facts to respect in copy and behaviour** (from the held-out evaluation; test period = mission days 877-1095):

| Hazard | Test accuracy | ORANGE recall | What it means |
|---|---|---|---|
| Radiation | 100 % | n/a | test set had no flagged rows; unproven |
| Gravity | 99.2 % | 71 % | informative |
| Isolation | 97.4 % | 38 % | misses most ORANGE |
| Distance | 99.5 % | **0 %** | currently never detects ORANGE; do not rely on it alone |
| Environment | 100 % | n/a | test set had no flagged rows; unproven |

- **RED recall is untested** (no RED rows in the test period; gravity never reaches RED anywhere in the dataset).
- The 93 % overall accuracy figure is **below** an always-GREEN baseline (98 %); never quote it as a product claim.
- Leave-astronauts-out accuracy 96.9 %, macro-F1 0.61: moderate generalisation to unseen crew.

**Required wording** (already in the designs): "For monitoring and research purposes, not a medical diagnosis." Use "flagged for review" language. Risk thresholds must come from the mission medical protocol, not hard-coded in the UI.

**Do not:**

- show probabilities, "confidence", or the raw anomaly score to the astronaut;
- present a model status as a diagnosis, or derive Muscle/Bone health claims from `gravity`;
- feed daily or cumulative values (mSv today, cumulative dose) where the model expects a per-reading value;
- score raw 5-minute sensor data without aggregating to the 6-hour cadence;
- treat a missing sensor as 0.

---

## 9. UI data the model does not cover

These appear in the doctor screens but are neither model inputs nor outputs; they come from the app's own data store or sensors:

hemoglobin, RBC and WBC counts, plasma volume, glucose, serum calcium, bone-turnover CTX, bone density, lean muscle mass, strength output, recovery score, activity load / activity minutes / exercise minutes, ECG rhythm, fluid shift index, cognitive score, stress index, alertness, vestibular balance, overall health score (84/100), dose rate, solar particle status, EVA exposure, cumulative dose and dose budget.

The "overall health score" in the designs is **not** produced by this model. If you need one, define it in the backend (and validate it clinically) rather than inventing a mapping from the levels.

---

## 10. Files

| File | Purpose |
|---|---|
| `outputs/isolation_forest_model_v2.pkl` | anomaly detector |
| `outputs/gradient_boosting_model_v2.pkl` | overall classifier (diagnostic) |
| `outputs/hazard_models_v2.pkl` | `dict` of 5 per-hazard classifiers (keys = hazard names) |
| `outputs/feature_scaler_v2.pkl` | StandardScaler fitted on training data |
| `outputs/feature_columns_v2.pkl` | ordered list of the 47 features |
| `outputs/countermeasures_v2.json` | countermeasure catalog |
| `outputs/model_metadata_v2.json` | metrics, sklearn version, split info |
| `outputs/test_predictions_v2.csv` | per-row test predictions (useful as fixtures for app tests) |
| `astronaut_health_dataset_v2.csv` | training data and the source for replay mode |
| `README.md`, `schema.sql` | full results analysis and database schema |

---

## 11. Open questions to resolve before production

1. **Label rules:** how were `alert_*` and `overall_status` in the v2 dataset generated? They do not follow the simple row-level thresholds in the original notebook (about 25 % of rows have under 5.84 h of sleep, yet isolation RED is only 0.52 %).
2. **Radiation unit and window:** what time window does `radiation_msv` cover in one reading?
3. **Rolling-window definition** for the 18 rolling features, and the four risk-score formulas (model v3 blockers).
4. **Body-system mapping** (section 6.2): who owns Heart & Blood Vessels status, and are Muscles/Bones allowed to follow `gravity`?
5. **Thresholds:** which mission medical protocol supplies the rule-engine thresholds and the dose budget?
6. **Alert policy** (section 7.1): confirm debounce, hysteresis and escalation with clinicians.
