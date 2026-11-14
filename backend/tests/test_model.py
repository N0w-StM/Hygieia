"""Scoring must reproduce Model/outputs/test_predictions_v2.csv (README 5.2)."""
import numpy as np
import pandas as pd
import sklearn

from app.model_service import HAZARDS
from tests.conftest import ROOT


def test_artifacts(model):
    assert sklearn.__version__ == model.metadata["sklearn_version"] == "1.7.1"
    assert len(model.feature_cols) == 47 == model.metadata["n_features"]
    assert model.feature_cols == model.metadata["feature_columns"]
    assert set(model.hazard_models) == set(HAZARDS)
    assert len(model.astronauts) == 6 and model.n_slots == 1095 * 4


def test_matches_test_predictions(model):
    tp = pd.read_csv(ROOT / "Model" / "outputs" / "test_predictions_v2.csv")
    scored = pd.concat([model.df[["astronaut_id", "mission_day", "sample_id"]], model.res], axis=1)
    j = tp.merge(scored, on=["astronaut_id", "mission_day", "sample_id"], how="left", suffixes=("_file", ""))
    assert len(j) == len(tp) == 5256 and not j["level_radiation"].isna().any()
    for h in HAZARDS:
        assert (j[f"pred_{h}"] == j[f"level_{h}"]).all(), h
    assert (j["pred_overall"] == j["model_overall"]).all()
    assert np.allclose(j["anomaly_score_file"], j["anomaly_score"], atol=1e-9)


def test_slice_scoring_equals_bulk(model):
    """Scoring one slot on its own gives the same answer as the bulk pass."""
    rows = model.df[(model.df.mission_day == 401) & (model.df.sample_id == 3)]
    res, _ = model.score_readings(rows)
    for h in HAZARDS:
        assert (res[f"level_{h}"] == model.res.loc[rows.index, f"level_{h}"]).all()


def test_record_contract(model):
    rec = model.record_for("ASTRO_001", model.slot_of(401, 3))
    assert rec["hazards"]["environment"] == {"level": 2, "label": "RED", "ui_label": "Critical"}
    assert rec["overall"]["level"] == max(v["level"] for v in rec["hazards"].values()) == 2
    assert rec["primary_action"] == rec["countermeasures"][0]
    assert rec["primary_action"]["action"] == model.countermeasures["environment"]["RED"][0]
    assert rec["reading_timestamp"].endswith("Z") and rec["mission_day"] == 401
    assert set(rec) >= {"anomaly", "unusual_signals", "diagnostics", "model_version", "vitals"}
    calm = model.record_for("ASTRO_001", model.slot_of(512, 0))
    assert calm["overall"]["level"] == 0 and calm["primary_action"] is None and calm["countermeasures"] == []


def test_missing_feature_is_an_error(model):
    import pytest
    with pytest.raises(ValueError):
        model.score_readings(model.df.head(2).drop(columns=["spo2"]))
