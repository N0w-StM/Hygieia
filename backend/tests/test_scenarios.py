"""Scenario labels must describe what the model actually outputs in each recorded window."""
from app.model_service import HAZARDS
from app.replay import SCENARIOS


def test_scenarios_match_model_output(model):
    assert len({s["id"] for s in SCENARIOS}) == len(SCENARIOS)
    for sc in SCENARIOS:
        start = model.slot_of(**sc["start"])
        w = model.window(sc["focus_astronaut"], start, start + sc["span_slots"] - 1)
        peaks = {h: int(w[f"level_{h}"].max()) for h in HAZARDS if w[f"level_{h}"].max() > 0}
        assert peaks == sc["expect"], (sc["id"], peaks)
        first = model.window(sc["focus_astronaut"], start, start)
        assert int(first["overall_level"].iloc[0]) == 0, f"{sc['id']} should start from a calm reading"


def test_radiation_watch_scenario_never_claims_critical(model):
    sc = next(s for s in SCENARIOS if s["id"] == "radiation_watch")
    start = model.slot_of(**sc["start"])
    for a in model.astronauts:
        w = model.window(a, start, start + sc["span_slots"] - 1)
        assert int(w["level_radiation"].max()) == 1
    assert "Critical" not in sc["label"] and "Solar" not in sc["label"]


def test_nominal_is_calm_for_whole_crew(model):
    sc = next(s for s in SCENARIOS if s["id"] == "nominal")
    start = model.slot_of(**sc["start"])
    for a in model.astronauts:
        assert int(model.window(a, start, start + sc["span_slots"] - 1)["overall_level"].max()) == 0
