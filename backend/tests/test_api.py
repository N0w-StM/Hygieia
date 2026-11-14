"""Every endpoint exercised against the real model, on the local store (no network)."""
import json

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import ROOT


def make_client(tmp_path, uri=None, start_day=512):
    s = Settings(model_dir=ROOT / "Model", data_dir=tmp_path, mongodb_uri=uri, autoplay=False,
                 start_day=start_day, reconnect_seconds=3600)
    return TestClient(create_app(s))


@pytest.fixture()
def client(tmp_path):
    with make_client(tmp_path) as c:
        yield c


def jump(c, **body):
    r = c.post("/api/replay/jump", json=body)
    assert r.status_code == 200, r.text
    return r.json()["replay"]


def step(c, n=1):
    for _ in range(n):
        assert c.post("/api/replay/step").status_code == 200


def alerts(c, **params):
    return c.get("/api/alerts", params=params).json()["alerts"]


def test_health_reports_offline_local_store(client):
    h = client.get("/api/health").json()
    assert h["status"] == "ok" and h["sklearn_version"] == "1.7.1" and h["data_mode"] == "replay"
    assert h["storage"] == {"mode": "local", "offline": True, "reason": "not_configured", "pending_sync": 0}
    assert h["disclaimer"] == "For monitoring and research purposes, not a medical diagnosis."


def test_crew_is_seeded_from_dataset(client):
    body = client.get("/api/crew").json()
    assert [c["astronaut_id"] for c in body["crew"]] == [f"ASTRO_00{i}" for i in range(1, 7)]
    first = body["crew"][0]
    assert first["baseline"]["baseline_hr"] == 67.88 and first["latest"]["overall"]["ui_label"] == "Normal"
    assert len(first["latest"]["systems"]) == 6 and "anomaly" in first["latest"]


def test_astronaut_view_hides_clinical_detail(client):
    jump(client, mission_day=401, sample_id=3)
    for url in ("/api/telemetry/ASTRO_001", "/api/hazards/ASTRO_001", "/api/crew"):
        text = client.get(url, params={"view": "astronaut"}).text
        for banned in ("anomaly", "unusual_signals", "model_overall", "diagnostics", "countermeasures",
                       "dataset_flags", "proba", "confidence"):
            assert banned not in text, (url, banned)
    latest = client.get("/api/telemetry/ASTRO_001", params={"view": "astronaut"}).json()["latest"]
    assert latest["astronaut_summary"]["title"] == "Critical: Environment"
    assert isinstance(latest["astronaut_summary"]["next_action"]["text"], str)  # exactly one action
    doc = client.get("/api/telemetry/ASTRO_001").json()["latest"]
    assert len(doc["countermeasures"]) == 3 and "score" in doc["anomaly"]


def test_telemetry_ranges(client):
    jump(client, mission_day=100, sample_id=3)
    for rng, n in (("24h", 4), ("7d", 28), ("30d", 120), ("mission", 100)):
        b = client.get("/api/telemetry/ASTRO_002", params={"range": rng}).json()
        assert len(b["series"]) == n, rng
        assert b["series"][-1]["mission_day"] == 100
    assert client.get("/api/telemetry/NOPE").status_code == 404


def test_five_hazards(client):
    jump(client, mission_day=401, sample_id=3)
    b = client.get("/api/hazards/ASTRO_001").json()
    assert [h["name"] for h in b["hazards"]] == [
        "Space Radiation", "Isolation and Confinement", "Distance from Earth", "Gravity Fields",
        "Hostile/Closed Environments"]
    env = b["hazards"][4]
    assert env["ui_label"] == "Critical" and len(env["countermeasures"]) == 3 and env["caveat"]
    assert len(env["history"]) == 28 and {s["key"] for s in env["signals"]} == {"co2_mmhg", "spo2", "fluid_intake_ml"}
    assert b["overall"]["level"] == 2


def test_replay_controls(client):
    st = client.get("/api/replay").json()
    assert st["replay"]["mission_day"] == 512 and st["replay"]["playing"] is False
    assert {s["id"] for s in st["scenarios"]} >= {"nominal", "radiation_watch", "environment_critical"}
    step(client)
    assert client.get("/api/replay").json()["replay"]["slot"] == st["replay"]["slot"] + 1
    assert client.post("/api/replay/speed", json={"seconds_per_slot": 2}).json()["replay"]["seconds_per_slot"] == 2
    assert client.post("/api/replay/speed", json={}).status_code == 422
    assert client.post("/api/replay/play").json()["replay"]["playing"] is True
    assert client.post("/api/replay/pause").json()["replay"]["playing"] is False
    r = jump(client, scenario="environment_critical")
    assert (r["mission_day"], r["sample_id"], r["scenario"], r["met"]) == (400, 2, "environment_critical", "399:12:00")
    assert client.post("/api/replay/jump", json={"scenario": "nope"}).status_code == 404
    assert client.post("/api/replay/jump", json={"mission_day": 5000}).status_code == 422
    assert client.post("/api/replay/rewind").status_code == 422
    last = jump(client, mission_day=1095, sample_id=3)
    step(client)
    assert client.get("/api/replay").json()["replay"]["slot"] == last["slot"]  # clamps at the end


def test_model_alert_pipeline_orange_debounce_then_red(client):
    """Environment scenario, ASTRO_001: ORANGE x3 (401.0-401.2), RED x3, then GREEN."""
    jump(client, scenario="environment_critical")
    step(client, 2)   # 401.0 = first ORANGE
    assert alerts(client, astronaut_id="ASTRO_001") == []
    step(client)      # 401.1 = second consecutive ORANGE -> Watch alert
    a = alerts(client, astronaut_id="ASTRO_001")
    assert [(x["source"], x["hazard"], x["level"], x["status"]) for x in a] == [("model", "environment", "ORANGE", "active")]
    assert a[0]["audience"] == ["doctor", "astronaut"] and "flagged for review" in a[0]["message"].lower()
    assert a[0]["reading_timestamp"] == "2031-02-05T06:00:00Z" and a[0]["acknowledged_at"] is None
    step(client, 2)   # 401.3 = RED -> immediate Critical alert, Watch superseded
    a = alerts(client, astronaut_id="ASTRO_001")
    assert [(x["level"], x["status"], x["cleared_reason"]) for x in sorted(a, key=lambda x: x["level"])] == [
        ("ORANGE", "cleared", "escalated"), ("RED", "active", None)]
    assert len(alerts(client, status="active", source="model")) == 6  # whole crew
    step(client, 3)   # 402.2 = first GREEN: still active
    assert len(alerts(client, astronaut_id="ASTRO_001", status="active")) == 1
    step(client)      # 402.3 = second GREEN -> cleared
    assert alerts(client, astronaut_id="ASTRO_001", status="active") == []


def test_no_alert_from_anomaly_score_or_model_overall(client, model):
    """Find a slot where everything is GREEN per hazard but anomaly < 0 and model_overall is ORANGE."""
    res = model.res
    hz = res[[c for c in res.columns if c.startswith("level_")]].max(axis=1)
    rows = model.df.loc[(hz == 0) & (res.anomaly_score < 0) & (res.model_overall >= 1) &
                        (model.df.astronaut_id == "ASTRO_001")]
    assert len(rows) > 0
    r = rows.iloc[0]
    jump(client, mission_day=int(r.mission_day), sample_id=int(r.sample_id))
    rec = client.get("/api/telemetry/ASTRO_001").json()["latest"]
    assert rec["anomaly"]["score"] < 0 and rec["diagnostics"]["model_overall_level"] >= 1
    assert rec["overall"]["level"] == 0
    assert alerts(client, astronaut_id="ASTRO_001", source="model") == []


def test_send_alert_ack_and_routing(client):
    r = client.post("/api/alerts", json={"astronaut_id": "ASTRO_003", "message": "I feel dizzy"})
    assert r.status_code == 201
    a = r.json()
    assert (a["source"], a["audience"], a["level"], a["status"]) == ("astronaut", ["doctor"], None, "active")
    assert [x["alert_id"] for x in alerts(client, audience="doctor")] == [a["alert_id"]]
    assert alerts(client, audience="astronaut") == []          # astronauts are not notified of Send Alert
    before = client.get("/api/telemetry/ASTRO_003").json()["latest"]
    ack = client.post(f"/api/alerts/{a['alert_id']}/ack", json={"acknowledged_by": "Dr. Lena Ortiz"}).json()
    assert ack["acknowledged_by"] == "Dr. Lena Ortiz" and ack["acknowledged_at"]
    assert ack["status"] == "active"                             # acknowledging never changes state
    after = client.get("/api/telemetry/ASTRO_003").json()["latest"]
    assert before["overall"] == after["overall"] and before["hazards"] == after["hazards"]
    again = client.post(f"/api/alerts/{a['alert_id']}/ack", json={"acknowledged_by": "Someone else"}).json()
    assert again["acknowledged_by"] == "Dr. Lena Ortiz" and again["acknowledged_at"] == ack["acknowledged_at"]
    assert alerts(client, unacknowledged=True) == []
    assert client.post("/api/alerts/ALT-000-NOPE/ack", json={"acknowledged_by": "x"}).status_code == 404
    assert client.post("/api/alerts", json={"astronaut_id": "NOPE"}).status_code == 404
    assert client.post("/api/alerts", json={"astronaut_id": "ASTRO_001", "hazard": "lava"}).status_code == 422


def test_ack_does_not_clear_model_alert(client):
    jump(client, scenario="radiation_critical")
    step(client)  # 601.1 = RED
    (a,) = alerts(client, astronaut_id="ASTRO_001", source="model")
    assert (a["hazard"], a["level"]) == ("radiation", "RED")
    client.post(f"/api/alerts/{a['alert_id']}/ack", json={"acknowledged_by": "Dr. Lena Ortiz"})
    (a2,) = alerts(client, astronaut_id="ASTRO_001", source="model")
    assert a2["status"] == "active" and a2["acknowledged_at"]
    assert client.get("/api/hazards/ASTRO_001").json()["hazards"][0]["ui_label"] == "Critical"


def test_jump_closes_open_model_alerts(client):
    jump(client, scenario="radiation_critical")
    step(client)
    assert len(alerts(client, status="active", source="model")) >= 1
    jump(client, scenario="nominal")
    assert alerts(client, status="active", source="model") == []
    assert {x["cleared_reason"] for x in alerts(client, source="model")} == {"replay_jump"}


def test_messages(client):
    assert client.get("/api/messages", params={"astronaut_id": "ASTRO_001"}).json()["messages"] == []
    m1 = client.post("/api/messages", json={"astronaut_id": "ASTRO_001", "sender": "astronaut", "text": " Hello doc "})
    m2 = client.post("/api/messages", json={"astronaut_id": "ASTRO_001", "sender": "doctor", "text": "Hi Alex"})
    client.post("/api/messages", json={"astronaut_id": "ASTRO_002", "sender": "doctor", "text": "Other thread"})
    assert m1.status_code == m2.status_code == 201 and m1.json()["text"] == "Hello doc"
    thread = client.get("/api/messages", params={"astronaut_id": "ASTRO_001"}).json()["messages"]
    assert [(m["sender"], m["text"]) for m in thread] == [("astronaut", "Hello doc"), ("doctor", "Hi Alex")]
    assert len(client.get("/api/messages").json()["messages"]) == 3
    assert client.post("/api/messages", json={"astronaut_id": "ASTRO_001", "sender": "robot", "text": "x"}).status_code == 422
    assert client.post("/api/messages", json={"astronaut_id": "ASTRO_001", "sender": "doctor", "text": ""}).status_code == 422


def test_checkin(client):
    r = client.post("/api/checkin", json={"astronaut_id": "ASTRO_004", "sleep_hours": 6.5, "mood": 4, "stress": 2,
                                          "hydration_ml": 2200, "exercise_done": True, "note": "ok"})
    assert r.status_code == 201 and r.json()["mission_day"] == 512
    got = client.get("/api/checkin", params={"astronaut_id": "ASTRO_004"}).json()["checkins"]
    assert len(got) == 1 and got[0]["mood"] == 4
    assert client.post("/api/checkin", json={"astronaut_id": "ASTRO_004", "mood": 9}).status_code == 422


def test_persistence_survives_restart(tmp_path):
    with make_client(tmp_path) as c:
        aid = c.post("/api/alerts", json={"astronaut_id": "ASTRO_001", "message": "persist me"}).json()["alert_id"]
        c.post("/api/messages", json={"astronaut_id": "ASTRO_001", "sender": "astronaut", "text": "still here"})
    stored = json.loads((tmp_path / "local" / "records.json").read_text())
    assert len(stored) == 6 and all(v["model_version"] == "v2" for v in stored.values())
    with make_client(tmp_path) as c:
        assert [a["alert_id"] for a in alerts(c)] == [aid]
        assert c.get("/api/messages").json()["messages"][0]["text"] == "still here"
        assert len(c.get("/api/crew").json()["crew"]) == 6  # seed is idempotent


def test_unreachable_mongo_falls_back_to_local(tmp_path):
    with make_client(tmp_path, uri="mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=500") as c:
        st = c.get("/api/health").json()["storage"]
        assert st["mode"] == "local" and st["offline"] is True and st["reason"].startswith("unreachable:")
        assert c.post("/api/alerts", json={"astronaut_id": "ASTRO_001", "message": "offline"}).status_code == 201
        assert c.get("/api/health").json()["storage"]["pending_sync"] > 0   # queued for when the link returns
        assert len(c.get("/api/crew").json()["crew"]) == 6
