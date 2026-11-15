"""Hygieia backend (FastAPI). Run from the repo root:

    backend/.venv/bin/uvicorn app.main:app --app-dir backend --port 8000
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import chat as chat_ai
from .config import Settings
from .events import EventBus
from .model_service import HAZARDS, UI_LABEL, get_model_service, iso_ts, level_obj
from .replay import SCENARIOS, ReplayEngine, utcnow
from .repository import LocalStore, Repository
from .rules import PROTOCOL
from .ui_copy import (DISCLAIMER, HAZARD_ABOUT, HAZARD_CAVEATS, HAZARD_LABELS, HAZARD_SHORT,
                      HAZARD_SIGNALS, SIGNAL_LABELS, plain_action)

log = logging.getLogger("hygieia")

# Sample crew profiles: the dataset only has IDs and baselines. Names/roles are illustrative.
CREW_PROFILES = {
    "ASTRO_001": ("Alex Morgan", "Flight engineer"),
    "ASTRO_002": ("Sam Rivera", "Commander"),
    "ASTRO_003": ("Priya Nair", "Mission specialist"),
    "ASTRO_004": ("Kenji Sato", "Pilot"),
    "ASTRO_005": ("Amina Diallo", "Science officer"),
    "ASTRO_006": ("Lukas Berg", "Systems engineer"),
}
DOCTOR = {"name": "Dr. Lena Ortiz", "role": "Crew medical officer"}
RANGES = {"24h": 4, "7d": 28, "30d": 120}
SERIES_FIELDS = ["heart_rate", "hrv_rmssd", "sbp", "dbp", "core_temp", "spo2", "sleep_hours", "mood_score",
                 "pvt_reaction_ms", "fluid_intake_ml", "co2_mmhg", "radiation_msv", "sans_trt_um", "vo2max"]
View = Literal["doctor", "astronaut"]


def for_astronaut(rec: dict) -> dict:
    """Astronaut View payload: one next action, no clinical/model detail (README 6.3)."""
    keep = ("astronaut_id", "reading_timestamp", "mission_day", "sample_id", "slot", "phase", "met",
            "scored_at", "overall", "hazards", "vitals", "astronaut_summary")
    out = {k: rec[k] for k in keep if k in rec}
    out["systems"] = [{k: s[k] for k in ("key", "name", "level", "label", "ui_label", "proxy", "metric", "note")}
                      for s in rec["systems"]]
    out["rules"] = {k: level_obj(v["level"]) for k, v in rec["rules"].items()}
    return out


class ReplayBody(BaseModel):
    seconds_per_slot: float | None = Field(None, gt=0)
    mission_day: int | None = Field(None, ge=1)
    sample_id: int | None = Field(None, ge=0, le=3)
    scenario: str | None = None


class AlertBody(BaseModel):
    astronaut_id: str
    message: str = Field("", max_length=500)
    hazard: str | None = None


class AckBody(BaseModel):
    acknowledged_by: str = Field(..., min_length=1, max_length=80)


class MessageBody(BaseModel):
    astronaut_id: str
    sender: Literal["astronaut", "doctor"]
    text: str = Field(..., min_length=1, max_length=2000)


class ChatTurn(BaseModel):
    role: Literal["user", "model"]
    text: str = Field(..., min_length=1, max_length=2000)


class ChatBody(BaseModel):
    astronaut_id: str
    message: str = Field(..., min_length=1, max_length=1000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=12)


class CheckinBody(BaseModel):
    astronaut_id: str
    sleep_hours: float | None = Field(None, ge=0, le=24)
    mood: int | None = Field(None, ge=1, le=5)
    stress: int | None = Field(None, ge=1, le=5)
    hydration_ml: float | None = Field(None, ge=0, le=10000)
    exercise_done: bool | None = None
    note: str = Field("", max_length=1000)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    bus = EventBus()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        loop = asyncio.get_running_loop()
        bus.attach(loop)
        model = await asyncio.to_thread(get_model_service, str(settings.model_dir))
        repo = Repository(LocalStore(settings.data_dir / "local"), settings.mongodb_uri, settings.mongodb_db)
        await asyncio.to_thread(repo.connect)
        repo.on_mode_change = lambda status: bus.publish("storage", status)
        for a in model.astronauts:  # idempotent crew seed from the dataset
            name, role = CREW_PROFILES.get(a, (a, "Crew member"))
            doc = {"astronaut_id": a, "name": name, "role": role, "baseline": model.baseline(a),
                   "sample_profile": True}
            if repo.get("crew", a) != doc:
                await asyncio.to_thread(repo.upsert, "crew", a, doc)
        engine = ReplayEngine(model, repo, bus, settings.start_day, settings.seconds_per_slot, settings.autoplay)
        await asyncio.to_thread(engine.start)
        app.state.model, app.state.repo, app.state.engine = model, repo, engine

        async def reconnect():
            while True:
                await asyncio.sleep(settings.reconnect_seconds)
                if repo.mode != "mongo" and settings.mongodb_uri:
                    await asyncio.to_thread(repo.connect)

        tasks = [asyncio.create_task(engine.run()), asyncio.create_task(reconnect())]
        log.info("Hygieia backend ready. Storage: %s", repo.mode)
        try:
            yield
        finally:
            for t in tasks:
                t.cancel()
            await asyncio.to_thread(repo.close)

    app = FastAPI(title="Hygieia API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                       allow_methods=["*"], allow_headers=["*"])

    def ctx(request: Request):
        s = request.app.state
        return s.model, s.repo, s.engine

    def need_astronaut(model, astronaut_id: str):
        if astronaut_id not in model.astronauts:
            raise HTTPException(404, f"Unknown astronaut_id: {astronaut_id}")

    def shape(rec: dict, view: View) -> dict:
        return for_astronaut(rec) if view == "astronaut" else rec

    # ---- meta -------------------------------------------------------------------------
    @app.get("/api/health")
    def health(request: Request):
        model, repo, engine = ctx(request)
        return {"status": "ok", "storage": repo.status(), "model_version": "v2",
                "sklearn_version": model.sklearn_version, "data_mode": "replay",
                "replay": engine.state(), "disclaimer": DISCLAIMER, "server_time": utcnow()}

    # ---- crew -------------------------------------------------------------------------
    @app.get("/api/crew")
    def crew(request: Request, view: View = "doctor", astronaut_id: str | None = None):
        """Doctor: every crew record. Astronaut: only their own record in full; for the others just
        the id, name and role (the "signed in as" picker and the contact tab need no more)."""
        model, repo, engine = ctx(request)
        if view == "astronaut":
            if not astronaut_id:
                raise HTTPException(422, "astronaut_id is required for view=astronaut")
            need_astronaut(model, astronaut_id)
        active = repo.find("alerts", lambda d: d["status"] == "active" or
                           (d["source"] == "astronaut" and not d["acknowledged_at"]))
        out = []
        for doc in sorted(repo.find("crew"), key=lambda d: d["astronaut_id"]):
            a = doc["astronaut_id"]
            if view == "astronaut" and a != astronaut_id:
                out.append({"astronaut_id": a, "name": doc["name"], "role": doc["role"]})
                continue
            rec = engine.latest.get(a)
            mine = [x for x in active if x["astronaut_id"] == a]
            doc["latest"] = shape(rec, view) if rec else None
            doc["open_alerts"] = len(mine)
            doc["unacknowledged_alerts"] = sum(1 for x in mine if not x["acknowledged_at"])
            out.append(doc)
        return {"crew": out, "doctor": DOCTOR, "replay": engine.state(), "storage": repo.status(),
                "disclaimer": DISCLAIMER}

    # ---- telemetry --------------------------------------------------------------------
    @app.get("/api/telemetry/{astronaut_id}")
    def telemetry(request: Request, astronaut_id: str, view: View = "doctor",
                  range: Literal["24h", "7d", "30d", "mission"] = "7d"):
        model, repo, engine = ctx(request)
        need_astronaut(model, astronaut_id)
        slot = engine.slot
        first = 0 if range == "mission" else slot - RANGES[range] + 1
        w = model.window(astronaut_id, first, slot)
        level_cols = [f"level_{h}" for h in HAZARDS] + ["overall_level"]
        cols = SERIES_FIELDS + level_cols + (["anomaly_score"] if view == "doctor" else [])
        if range == "mission":  # one point per mission day: mean of readings, worst level of the day
            g = w.groupby("mission_day")
            agg = g[SERIES_FIELDS + (["anomaly_score"] if view == "doctor" else [])].mean()
            agg[level_cols] = g[level_cols].max()
            agg["timestamp"] = g["timestamp"].first()
            agg["mission_day"] = agg.index
            rows = agg.reset_index(drop=True)
            resolution = "daily"
        else:
            rows = w[["timestamp", "mission_day", "sample_id"] + cols]
            resolution = "6h"
        series = []
        for r in rows.to_dict("records"):
            p = {"timestamp": iso_ts(r["timestamp"]), "mission_day": int(r["mission_day"])}
            if "sample_id" in r:
                p["sample_id"] = int(r["sample_id"])
            for k in SERIES_FIELDS:
                p[k] = round(float(r[k]), 3)
            for k in level_cols:
                p[k] = int(r[k])
            if view == "doctor":
                p["anomaly_score"] = round(float(r["anomaly_score"]), 4)
            series.append(p)
        rec = engine.latest.get(astronaut_id)
        return {"astronaut": repo.get("crew", astronaut_id), "latest": shape(rec, view) if rec else None,
                "range": range, "resolution": resolution, "series": series,
                "signals": {k: {"label": v[0], "unit": v[1]} for k, v in SIGNAL_LABELS.items()},
                "protocol": PROTOCOL if view == "doctor" else None,
                "replay": engine.state(), "disclaimer": DISCLAIMER}

    # ---- five hazards -----------------------------------------------------------------
    @app.get("/api/hazards/{astronaut_id}")
    def hazards(request: Request, astronaut_id: str, view: View = "doctor"):
        model, repo, engine = ctx(request)
        need_astronaut(model, astronaut_id)
        rec = engine.latest[astronaut_id]
        hist = model.window(astronaut_id, engine.slot - 27, engine.slot)
        items = []
        for h in ["radiation", "isolation", "distance", "gravity", "environment"]:  # TODO.txt order
            lvl = rec["hazards"][h]
            actions = [c for c in rec["countermeasures"] if c["hazard"] == h]
            item = {
                "key": h, "name": HAZARD_LABELS[h], "short": HAZARD_SHORT[h], "about": HAZARD_ABOUT[h], **lvl,
                "status_copy": {0: "No action needed.", 1: "Flagged for review. One protective action.",
                                2: "Flagged for review. Act now and contact your flight surgeon."}[lvl["level"]],
                "signals": [{"key": s, "label": SIGNAL_LABELS[s][0], "unit": SIGNAL_LABELS[s][1],
                             "value": rec["vitals"][s]} for s in HAZARD_SIGNALS[h]],
                "history": [{"timestamp": iso_ts(t), "level": int(l)}
                            for t, l in zip(hist["timestamp"], hist[f"level_{h}"])],
                "next_action": plain_action(actions[0]["action"]) if actions else None,
            }
            if view == "doctor":
                item["countermeasures"] = [c["action"] for c in actions]
                item["caveat"] = HAZARD_CAVEATS[h]
            items.append(item)
        out = {"astronaut_id": astronaut_id, "reading_timestamp": rec["reading_timestamp"],
               "mission_day": rec["mission_day"], "met": rec["met"], "phase": rec["phase"],
               "scored_at": rec["scored_at"], "overall": rec["overall"], "hazards": items,
               "replay": engine.state(), "disclaimer": DISCLAIMER}
        if view == "doctor":
            out.update(anomaly=rec["anomaly"], unusual_signals=rec["unusual_signals"],
                       diagnostics=rec["diagnostics"], model_version=rec["model_version"])
        return out

    # ---- replay -----------------------------------------------------------------------
    @app.get("/api/replay")
    def replay_state(request: Request):
        _, _, engine = ctx(request)
        return {"replay": engine.state(), "scenarios": SCENARIOS}

    @app.post("/api/replay/{control}")
    def replay_control(request: Request, control: Literal["play", "pause", "speed", "jump", "step"],
                       body: ReplayBody | None = None):
        model, _, engine = ctx(request)
        body = body or ReplayBody()
        if control == "play":
            engine.set_playing(True)
        elif control == "pause":
            engine.set_playing(False)
        elif control == "step":
            engine.step()
        elif control == "speed":
            if body.seconds_per_slot is None:
                raise HTTPException(422, "seconds_per_slot is required")
            engine.set_speed(body.seconds_per_slot)
        elif control == "jump":
            if body.scenario:
                sc = next((s for s in SCENARIOS if s["id"] == body.scenario), None)
                if not sc:
                    raise HTTPException(404, f"Unknown scenario: {body.scenario}")
                engine.jump(model.slot_of(**sc["start"]), scenario=sc["id"])
            elif body.mission_day is not None:
                if body.mission_day > model.n_slots // 4:
                    raise HTTPException(422, f"mission_day must be <= {model.n_slots // 4}")
                engine.jump(model.slot_of(body.mission_day, body.sample_id or 0))
            else:
                raise HTTPException(422, "scenario or mission_day is required")
        return {"replay": engine.state()}

    # ---- alerts -----------------------------------------------------------------------
    @app.get("/api/alerts")
    def list_alerts(request: Request, audience: View | None = None, astronaut_id: str | None = None,
                    status: Literal["active", "cleared"] | None = None,
                    source: Literal["model", "rule", "astronaut"] | None = None,
                    unacknowledged: bool = False, limit: int = Query(100, ge=1, le=500)):
        _, repo, _ = ctx(request)

        def pred(d):
            return ((audience is None or audience in d["audience"])
                    and (astronaut_id is None or d["astronaut_id"] == astronaut_id)
                    and (status is None or d["status"] == status)
                    and (source is None or d["source"] == source)
                    and (not unacknowledged or not d["acknowledged_at"]))

        items = sorted(repo.find("alerts", pred), key=lambda d: d["triggered_at"], reverse=True)
        return {"alerts": items[:limit], "total": len(items)}

    @app.post("/api/alerts", status_code=201)
    def send_alert(request: Request, body: AlertBody):
        """Astronaut "Send Alert": goes to the Doctor View only."""
        model, _, engine = ctx(request)
        need_astronaut(model, body.astronaut_id)
        if body.hazard is not None and body.hazard not in HAZARDS:
            raise HTTPException(422, f"hazard must be one of {HAZARDS}")
        rec = engine.latest[body.astronaut_id]
        return engine.create_alert(
            astronaut_id=body.astronaut_id, source="astronaut", hazard=body.hazard, level=None,
            message=body.message.strip() or "Astronaut requested help.",
            reading_timestamp=rec["reading_timestamp"], mission_day=rec["mission_day"], audience=["doctor"])

    @app.post("/api/alerts/{alert_id}/ack")
    def ack_alert(request: Request, alert_id: str, body: AckBody):
        """Acknowledge = "seen by". It never changes status, level or any clinical state."""
        _, repo, engine = ctx(request)
        alert = repo.get("alerts", alert_id)
        if not alert:
            raise HTTPException(404, "Alert not found")
        if not alert["acknowledged_at"]:
            alert.update(acknowledged_by=body.acknowledged_by.strip(), acknowledged_at=utcnow())
            repo.upsert("alerts", alert_id, alert)
            engine.bus.publish("alert_ack", alert)
        return alert

    # ---- messages (contact tabs) ------------------------------------------------------
    @app.get("/api/messages")
    def list_messages(request: Request, astronaut_id: str | None = None, limit: int = Query(200, ge=1, le=1000)):
        _, repo, _ = ctx(request)
        items = sorted(repo.find("messages", lambda d: astronaut_id is None or d["astronaut_id"] == astronaut_id),
                       key=lambda d: d["sent_at"])
        return {"messages": items[-limit:], "doctor": DOCTOR}

    @app.post("/api/messages", status_code=201)
    def post_message(request: Request, body: MessageBody):
        model, repo, engine = ctx(request)
        need_astronaut(model, body.astronaut_id)
        msg = {"message_id": uuid.uuid4().hex, "astronaut_id": body.astronaut_id, "sender": body.sender,
               "text": body.text.strip(), "sent_at": utcnow(), "met": engine.state()["met"]}
        repo.upsert("messages", msg["message_id"], msg)
        engine.bus.publish("message", msg)
        return msg

    # ---- AI chat ----------------------------------------------------------------------
    @app.post("/api/chat")
    def ai_chat(request: Request, body: ChatBody):
        """Live answer from Gemini about the asking astronaut's own data, or mode=offline so the page
        uses its offline demo answers. Never returns the key, the prompt or the raw context."""
        model, _, engine = ctx(request)
        need_astronaut(model, body.astronaut_id)
        offline = lambda reason: {"mode": "offline", "label": "Offline demo answers", "reason": reason}  # noqa: E731
        rec = engine.latest.get(body.astronaut_id)
        if not rec:
            return offline("no_reading")
        context = chat_ai.build_health_context(
            rec, model.baseline(body.astronaut_id), model.window(body.astronaut_id, engine.slot - 27, engine.slot))
        try:
            text = chat_ai.ask_gemini(settings.gemini_api_key, settings.gemini_model, settings.gemini_timeout, context,
                                      body.message.strip(), [t.model_dump() for t in body.history])
        except chat_ai.ChatUnavailable as e:
            log.warning("AI chat: live model unavailable (%s); using offline demo answers", e.reason)
            return offline(e.reason)
        return {"mode": "live", "label": "Live AI (Gemini)", "model": settings.gemini_model, "answer": text}

    # ---- check-ins --------------------------------------------------------------------
    @app.get("/api/checkin")
    def list_checkins(request: Request, astronaut_id: str | None = None, limit: int = Query(50, ge=1, le=500)):
        _, repo, _ = ctx(request)
        items = sorted(repo.find("checkins", lambda d: astronaut_id is None or d["astronaut_id"] == astronaut_id),
                       key=lambda d: d["submitted_at"], reverse=True)
        return {"checkins": items[:limit]}

    @app.post("/api/checkin", status_code=201)
    def post_checkin(request: Request, body: CheckinBody):
        """Self-reported check-in. Stored and shown to the doctor; it is not a model input."""
        model, repo, engine = ctx(request)
        need_astronaut(model, body.astronaut_id)
        doc = {"checkin_id": uuid.uuid4().hex, **body.model_dump(), "note": body.note.strip(),
               "submitted_at": utcnow(), "mission_day": engine.state()["mission_day"], "met": engine.state()["met"]}
        repo.upsert("checkins", doc["checkin_id"], doc)
        engine.bus.publish("checkin", doc)
        return doc

    # ---- SSE --------------------------------------------------------------------------
    @app.get("/api/stream")
    async def stream(request: Request, view: View = "doctor", astronaut_id: str | None = None):
        model, repo, engine = ctx(request)
        if view == "astronaut":
            if not astronaut_id:
                raise HTTPException(422, "astronaut_id is required for view=astronaut")
            need_astronaut(model, astronaut_id)

        def visible(ev: dict) -> dict | None:
            t, d = ev["type"], ev["data"]
            if view == "doctor":
                return ev
            if t == "tick":
                recs = [for_astronaut(r) for r in d["records"] if r["astronaut_id"] == astronaut_id]
                return {"type": t, "data": {"replay": d["replay"], "records": recs}}
            if t in ("alert", "alert_cleared", "alert_ack"):
                # astronauts are notified of model/rule alerts about themselves, plus the fate of their own
                return ev if d["astronaut_id"] == astronaut_id and ("astronaut" in d["audience"] or d["source"] == "astronaut") else None
            if t == "message":
                return ev if d["astronaut_id"] == astronaut_id else None
            if t == "checkin":
                return None
            return ev

        async def gen():
            q = bus.subscribe()
            try:
                hello = {"replay": engine.state(), "storage": repo.status(), "server_time": utcnow()}
                yield f"event: hello\ndata: {json.dumps(hello)}\n\n"
                while True:
                    try:
                        ev = await asyncio.wait_for(q.get(), timeout=10)
                    except asyncio.TimeoutError:
                        # A real event, not an SSE comment: the page uses it as a heartbeat to
                        # detect a dead stream (comments never reach EventSource listeners).
                        yield f"event: ping\ndata: {json.dumps({'server_time': utcnow()})}\n\n"
                        continue
                    ev = visible(ev)
                    if ev:
                        yield f"event: {ev['type']}\ndata: {json.dumps(ev['data'])}\n\n"
            finally:
                bus.unsubscribe(q)

        return StreamingResponse(gen(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    return app


app = create_app()
