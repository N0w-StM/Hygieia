"""Model service: loads the v2 pickles once and scores dataset rows (replay mode).

score_readings / top_unusual_signals / to_record follow Model/README.md section 5.2 exactly.
Live single-reading scoring is intentionally absent (blocked until model v3).
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn

HAZARDS = ["radiation", "gravity", "isolation", "distance", "environment"]
LABEL = {0: "GREEN", 1: "ORANGE", 2: "RED"}
UI_LABEL = {0: "Normal", 1: "Watch", 2: "Critical"}
SLOTS_PER_DAY = 4

VITAL_FIELDS = [
    "heart_rate", "hrv_rmssd", "sbp", "dbp", "core_temp", "spo2", "sleep_hours", "mood_score",
    "pvt_reaction_ms", "fluid_intake_ml", "co2_mmhg", "radiation_msv", "sans_trt_um", "vo2max",
]
BASELINE_FIELDS = ["baseline_hr", "baseline_hrv_rmssd", "baseline_sbp", "baseline_dbp", "baseline_spo2"]
# Dataset annotations (simulation ground truth). Context only, never a model output.
FLAG_FIELDS = ["spe_event", "illness_flag", "sleep_deprived", "co2_spike", "exercise_completed"]


def level_obj(level: int) -> dict:
    return {"level": int(level), "label": LABEL[int(level)], "ui_label": UI_LABEL[int(level)]}


class ModelService:
    def __init__(self, model_dir: Path):
        art = Path(model_dir) / "outputs"
        self.iso_forest = joblib.load(art / "isolation_forest_model_v2.pkl")
        self.gb_model = joblib.load(art / "gradient_boosting_model_v2.pkl")
        self.hazard_models = joblib.load(art / "hazard_models_v2.pkl")
        self.scaler = joblib.load(art / "feature_scaler_v2.pkl")
        self.feature_cols = list(joblib.load(art / "feature_columns_v2.pkl"))
        with open(art / "countermeasures_v2.json") as f:
            self.countermeasures = json.load(f)
        with open(art / "model_metadata_v2.json") as f:
            self.metadata = json.load(f)
        self.sklearn_version = sklearn.__version__
        if set(self.hazard_models) != set(HAZARDS):
            raise RuntimeError(f"Unexpected hazard keys: {sorted(self.hazard_models)}")

        # Replay source: every row already holds all model features, so scoring is exact.
        df = pd.read_csv(Path(model_dir) / "astronaut_health_dataset_v2.csv")
        df = df.sort_values(["astronaut_id", "mission_day", "sample_id"]).reset_index(drop=True)
        for f in FLAG_FIELDS:
            df[f] = df[f].astype(str).str.lower().eq("true")
        df["slot"] = (df["mission_day"] - 1) * SLOTS_PER_DAY + df["sample_id"]
        self.df = df
        self.astronauts = sorted(df["astronaut_id"].unique())
        self.n_slots = int(df["slot"].max()) + 1
        self.res, self.Z = self.score_readings(df)
        # Sum of per-reading dose values so far. The reading window is unconfirmed (README open
        # question 2), so this is shown as recorded context only, with no limit rule attached.
        self.cum_dose = df.groupby("astronaut_id")["radiation_msv"].cumsum().to_numpy()
        self._pos = {}
        for a, g in df.groupby("astronaut_id"):
            if len(g) != self.n_slots or not (g["slot"].to_numpy() == np.arange(self.n_slots)).all():
                raise RuntimeError(f"Dataset is not a complete 6-hourly grid for {a}")
            self._pos[a] = g.index.to_numpy()

    # ---- README 5.2 -------------------------------------------------------------------
    def score_readings(self, df: pd.DataFrame, include_overall_model: bool = False):
        """Score rows that already contain every column in feature_cols.
        Returns (results DataFrame, standardised feature matrix)."""
        missing = [c for c in self.feature_cols if c not in df.columns]
        if missing:
            raise ValueError(f"Missing feature columns: {missing}")
        X = (df[self.feature_cols].apply(pd.to_numeric, errors="coerce")
             .replace([np.inf, -np.inf], np.nan).fillna(0).astype(float))
        Xs = self.scaler.transform(X)
        anomaly = self.iso_forest.decision_function(Xs)
        Xe = np.column_stack([Xs, anomaly])

        out = pd.DataFrame(index=df.index)
        for h in HAZARDS:
            out[f"level_{h}"] = self.hazard_models[h].predict(Xe).astype(int)
        out["model_overall"] = self.gb_model.predict(Xe).astype(int)
        cols = [f"level_{h}" for h in HAZARDS] + (["model_overall"] if include_overall_model else [])
        out["overall_level"] = out[cols].max(axis=1)
        out["anomaly_score"] = anomaly
        return out, Xs

    def top_unusual_signals(self, z_row, k: int = 3):
        """Features furthest from the training distribution (doctor view only; not causal)."""
        idx = np.argsort(-np.abs(z_row))[:k]
        return [{"feature": self.feature_cols[i], "z": round(float(z_row[i]), 2)} for i in idx]

    def to_record(self, row, z_row, meta: dict) -> dict:
        """meta = {astronaut_id, reading_timestamp, mission_day}"""
        levels = {h: int(row[f"level_{h}"]) for h in HAZARDS}
        overall = int(row["overall_level"])
        actions = []
        for h in sorted(HAZARDS, key=lambda x: -levels[x]):  # worst hazard first
            if levels[h] >= 1:
                for a in self.countermeasures[h][LABEL[levels[h]]]:  # catalog order = priority order
                    actions.append({"hazard": h, "level": LABEL[levels[h]], "action": a})
        return {
            **meta,
            "model_version": "v2",
            "overall": level_obj(overall),
            "hazards": {h: level_obj(l) for h, l in levels.items()},
            "primary_action": actions[0] if actions else None,
            "countermeasures": actions,
            "anomaly": {"score": round(float(row["anomaly_score"]), 4)},
            "unusual_signals": self.top_unusual_signals(z_row),
            "diagnostics": {"model_overall_level": int(row["model_overall"])},
        }

    # ---- replay helpers ---------------------------------------------------------------
    def slot_of(self, mission_day: int, sample_id: int = 0) -> int:
        return max(0, min(self.n_slots - 1, (int(mission_day) - 1) * SLOTS_PER_DAY + int(sample_id)))

    def row_index(self, astronaut_id: str, slot: int) -> int:
        return int(self._pos[astronaut_id][slot])

    def raw_row(self, astronaut_id: str, slot: int) -> pd.Series:
        return self.df.iloc[self.row_index(astronaut_id, slot)]

    def baseline(self, astronaut_id: str) -> dict:
        r = self.raw_row(astronaut_id, 0)
        return {k: round(float(r[k]), 2) for k in BASELINE_FIELDS}

    def record_for(self, astronaut_id: str, slot: int) -> dict:
        """README 4.3 record plus display context taken from the same dataset row."""
        i = self.row_index(astronaut_id, slot)
        raw = self.df.iloc[i]
        rec = self.to_record(self.res.iloc[i], self.Z[i], {
            "astronaut_id": astronaut_id,
            "reading_timestamp": iso_ts(raw["timestamp"]),
            "mission_day": int(raw["mission_day"]),
        })
        rec["sample_id"] = int(raw["sample_id"])
        rec["slot"] = int(slot)
        rec["phase"] = str(raw["phase"])
        rec["vitals"] = {k: round(float(raw[k]), 3) for k in VITAL_FIELDS}
        rec["context"] = {
            "dataset_flags": {k: bool(raw[k]) for k in FLAG_FIELDS},
            "cumulative_dose_msv": round(float(self.cum_dose[i]), 2),
        }
        return rec

    def window(self, astronaut_id: str, first_slot: int, last_slot: int) -> pd.DataFrame:
        """Raw rows joined with scored results for slots [first_slot, last_slot]."""
        first_slot = max(0, first_slot)
        idx = self._pos[astronaut_id][first_slot:last_slot + 1]
        return pd.concat([self.df.iloc[idx], self.res.iloc[idx]], axis=1)


def iso_ts(ts) -> str:
    return pd.Timestamp(ts).strftime("%Y-%m-%dT%H:%M:%SZ")


def met_string(slot: int) -> str:
    """Mission elapsed time DDD:HH:MM for the start of a slot (mission day = MET days + 1)."""
    return f"{slot // SLOTS_PER_DAY:03d}:{(slot % SLOTS_PER_DAY) * 6:02d}:00"


@lru_cache(maxsize=2)
def get_model_service(model_dir: str) -> ModelService:
    return ModelService(Path(model_dir))
