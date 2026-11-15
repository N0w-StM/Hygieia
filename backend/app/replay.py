"""Replay engine: one mission clock for the whole crew, stepping the recorded dataset one
6-hour slot at a time. Each step builds the scored record for every astronaut, persists it,
runs the rule engine and feeds the alert policy.

All inference is the real v2 model on recorded mission data. Nothing here perturbs readings.
"""
from __future__ import annotations

import asyncio
import threading
import time
import uuid
from datetime import datetime, timezone

from .alert_policy import AlertPolicy
from .events import EventBus
from .model_service import HAZARDS, LABEL, UI_LABEL, ModelService, met_string
from .repository import Repository
from .rules import RULE_LABELS, build_systems, evaluate_rules
from .ui_copy import HAZARD_LABELS, astronaut_summary

MIN_SECONDS, MAX_SECONDS = 0.25, 120.0

# Demo scenarios = real dataset windows, named by what the model actually outputs there.
# `expect` is the peak level per hazard for the focus astronaut within `span_slots`
# (verified by tests/test_scenarios.py).
SCENARIOS = [
    {
        "id": "nominal", "label": "Nominal", "focus_astronaut": "ASTRO_001",
        "description": "Calm period: every crew member Normal on all five hazards.",
        "start": {"mission_day": 512, "sample_id": 0}, "span_slots": 40, "expect": {},
    },
    {
        "id": "radiation_watch", "label": "Radiation: Watch (whole crew)", "focus_astronaut": "ASTRO_001",
        "description": "Recorded dose rise. The model flags Space Radiation at Watch for all six crew; "
                       "it does not reach Critical in this window.",
        "start": {"mission_day": 69, "sample_id": 2}, "span_slots": 14, "expect": {"radiation": 1},
    },
    {
        "id": "radiation_critical", "label": "Radiation: Critical (one crew member at a time)", "focus_astronaut": "ASTRO_001",
        "description": "The model flags Space Radiation at Critical for four consecutive readings for one crew member; "
                       "a second crew member follows a few readings later.",
        "start": {"mission_day": 601, "sample_id": 0}, "span_slots": 10, "expect": {"radiation": 2},
    },
    {
        "id": "environment_critical", "label": "Cabin environment: Watch, then Critical (whole crew)",
        "focus_astronaut": "ASTRO_001",
        "description": "Recorded cabin CO₂ rise. Hostile/Closed Environments goes Watch for three readings, "
                       "then Critical, then clears.",
        "start": {"mission_day": 400, "sample_id": 2}, "span_slots": 14, "expect": {"environment": 2},
    },
    {
        "id": "isolation_escalation", "label": "Isolation: Watch, then Critical (one crew member)",
        "focus_astronaut": "ASTRO_005",
        "description": "Recorded run of short sleep. Isolation and Confinement holds Watch for three days, "
                       "then Critical.",
        "start": {"mission_day": 163, "sample_id": 2}, "span_slots": 30, "expect": {"isolation": 2},
    },
    {
        "id": "multi_hazard", "label": "Multiple hazards: Distance and Isolation Critical, Gravity Watch",
        "focus_astronaut": "ASTRO_004",
        "description": "Recorded illness period for one crew member. Three hazards are flagged together.",
        "start": {"mission_day": 438, "sample_id": 1}, "span_slots": 24,
        "expect": {"distance": 2, "isolation": 2, "gravity": 1},
    },
]


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class ReplayEngine:
    def __init__(self, model: ModelService, repo: Repository, bus: EventBus,
                 start_day: int = 79, seconds_per_slot: float = 5.0, autoplay: bool = True):
        self.model, self.repo, self.bus = model, repo, bus
        self.slot = model.slot_of(start_day, 0)
        self.playing = autoplay
        self.seconds_per_slot = float(min(MAX_SECONDS, max(MIN_SECONDS, seconds_per_slot)))
        self.scenario: str | None = None
        self.policy = AlertPolicy()
        self.latest: dict[str, dict] = {}
        self._lock = threading.RLock()
        self._baselines = {a: model.baseline(a) for a in model.astronauts}

    # ---- state ------------------------------------------------------------------------
    def state(self) -> dict:
        return {
            "mode": "replay",
            "label": "Replay of recorded mission data",
            "playing": self.playing,
            "seconds_per_slot": self.seconds_per_slot,
            "slot": self.slot,
            "last_slot": self.model.n_slots - 1,
            "mission_day": self.slot // 4 + 1,
            "sample_id": self.slot % 4,
            "met": met_string(self.slot),
            "scenario": self.scenario,
            "at_end": self.slot >= self.model.n_slots - 1,
        }

    # ---- records ----------------------------------------------------------------------
    def build_record(self, astronaut_id: str, slot: int) -> dict:
        rec = self.model.record_for(astronaut_id, slot)
        rules = evaluate_rules(rec["vitals"], self._baselines[astronaut_id])
        rec["rules"] = rules
        rec["systems"] = build_systems(rec, rules)
        rec["astronaut_summary"] = astronaut_summary(rec, rules)
        rec["met"] = met_string(slot)
        return rec

    def start(self):
        """Close alerts left active by an earlier run (policy state starts fresh), emit current slot."""
        with self._lock:
            self._close_active("replay_restart")
            self._process()

    def _process(self):
        slot, now = self.slot, utcnow()
        records = []
        for a in self.model.astronauts:
            rec = self.build_record(a, slot)
            rec["scored_at"] = now
            self.latest[a] = rec
            self.repo.upsert("records", f"{a}|{rec['reading_timestamp']}", rec)
            records.append(rec)
            for h in HAZARDS:  # model alerts: per-hazard levels only
                self._apply(a, "model", h, rec["hazards"][h]["level"], rec)
            for key in RULE_LABELS:  # rule alerts share the same pipeline
                self._apply(a, "rule", key, rec["rules"][key]["level"], rec)
        self.bus.publish("tick", {"replay": self.state(), "records": records})

    def _apply(self, astronaut_id: str, source: str, key: str, level: int, rec: dict):
        for ev in self.policy.observe(astronaut_id, f"{source}:{key}", level):
            if ev["type"] == "raise":
                self._raise(astronaut_id, source, key, ev["level"], ev["reason"], rec)
            else:
                self._clear(astronaut_id, source, key, ev["level"], ev["reason"], rec)

    # ---- alerts -----------------------------------------------------------------------
    def _raise(self, astronaut_id, source, key, level, reason, rec):
        name = HAZARD_LABELS.get(key) or RULE_LABELS.get(key, key)
        how = {
            "red_immediate": "Flagged for review now.",
            "orange_2_consecutive": "Flagged for review after 2 consecutive readings.",
            "deescalated_to_watch": "Lowered from Critical after 2 consecutive lower readings. Still flagged for review.",
        }[reason]
        detail = "; ".join(rec["rules"][key]["reasons"]) if source == "rule" else ""
        self.create_alert(
            astronaut_id=astronaut_id, source=source, hazard=key, level=level,
            message=f"{name}: {UI_LABEL[level]}. {how}" + (f" ({detail})" if detail else ""),
            reading_timestamp=rec["reading_timestamp"], mission_day=rec["mission_day"],
            audience=["doctor", "astronaut"],
        )

    def create_alert(self, *, astronaut_id, source, hazard, level, message, reading_timestamp,
                     mission_day, audience) -> dict:
        alert = {
            "alert_id": f"ALT-{mission_day:03d}-{uuid.uuid4().hex[:8].upper()}",
            "astronaut_id": astronaut_id,
            "source": source,                       # "model" | "rule" | "astronaut"
            "hazard": hazard,
            "level": LABEL[level] if level is not None else None,
            "ui_level": UI_LABEL[level] if level is not None else None,
            "message": message,
            "triggered_at": utcnow(),
            "reading_timestamp": reading_timestamp,
            "mission_day": mission_day,
            "audience": audience,
            "status": "active",                     # clinical state; acknowledging never changes it
            "cleared_at": None,
            "cleared_reason": None,
            "acknowledged_by": None,
            "acknowledged_at": None,
        }
        self.repo.upsert("alerts", alert["alert_id"], alert)
        self.bus.publish("alert", alert)
        return alert

    def _clear(self, astronaut_id, source, key, level, reason, rec):
        for a in self.repo.find("alerts", lambda d: d["status"] == "active" and d["astronaut_id"] == astronaut_id
                                and d["source"] == source and d["hazard"] == key and d["level"] == LABEL[level]):
            self._close(a, reason)

    def _close(self, alert: dict, reason: str):
        alert.update(status="cleared", cleared_at=utcnow(), cleared_reason=reason)
        self.repo.upsert("alerts", alert["alert_id"], alert)
        self.bus.publish("alert_cleared", alert)

    def _close_active(self, reason: str):
        for a in self.repo.find("alerts", lambda d: d["status"] == "active" and d["source"] in ("model", "rule")):
            self._close(a, reason)

    # ---- controls ---------------------------------------------------------------------
    def step(self) -> bool:
        with self._lock:
            if self.slot >= self.model.n_slots - 1:
                self.playing = False
                self.bus.publish("replay", self.state())
                return False
            self.slot += 1
            self._process()
            return True

    def jump(self, slot: int, scenario: str | None = None):
        """Move the mission clock. Debounce state restarts, so open model/rule alerts are closed."""
        with self._lock:
            self.slot = max(0, min(self.model.n_slots - 1, int(slot)))
            self.scenario = scenario
            self.policy.reset()
            self._close_active("replay_jump")
            self._process()

    def set_playing(self, playing: bool):
        self.playing = bool(playing) and self.slot < self.model.n_slots - 1
        self.bus.publish("replay", self.state())

    def set_speed(self, seconds_per_slot: float):
        self.seconds_per_slot = float(min(MAX_SECONDS, max(MIN_SECONDS, seconds_per_slot)))
        self.bus.publish("replay", self.state())

    async def run(self):
        due = time.monotonic() + self.seconds_per_slot
        last_flush = time.monotonic()
        while True:
            await asyncio.sleep(0.1)
            now = time.monotonic()
            if not self.playing:
                due = now + self.seconds_per_slot
            elif now >= min(due, now + self.seconds_per_slot):
                await asyncio.to_thread(self.step)
                due = time.monotonic() + self.seconds_per_slot
            if now - last_flush > 5:
                await asyncio.to_thread(self.repo.flush)
                last_flush = now
