"""AI Chat: Google Gemini (generateContent) with the offline demo answers as automatic fallback.

Privacy and safety rules for this module:
- HEALTH_CONTEXT is built only from the asking astronaut's own current record. No other crew, no
  probabilities, no anomaly or model scores.
- The system prompt (backend/prompts/health_assistant.md) is sent as the system instruction. The
  health context goes in its own content part, delimited by <health_context> tags, never mixed with
  the astronaut's text.
- The API key travels only in the x-goog-api-key header. It is never logged or returned.
- Any failure (no key, no internet, timeout, rate limit, blocked or empty answer) raises
  ChatUnavailable; the endpoint then tells the page to use the offline demo answers.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import httpx
import pandas as pd

from .model_service import UI_LABEL
from .rules import PROTOCOL

log = logging.getLogger("hygieia.chat")

PROMPT_PATH = Path(__file__).resolve().parents[1] / "prompts" / "health_assistant.md"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
TEMPERATURE = 0.3
MAX_OUTPUT_TOKENS = 300
HISTORY_TURNS = 6

HAZARD_NAMES = {"radiation": "Space Radiation", "gravity": "Gravity Fields", "isolation": "Isolation & Confinement",
                "distance": "Distance from Earth", "environment": "Hostile/Closed Environments"}
# Placeholder demo thresholds from rules.PROTOCOL; the prompt tells the model they are not mission limits.
P = PROTOCOL
RANGES = {
    "heart_rate": f"{P['hr_absolute']['watch_low']:.0f}-{P['hr_absolute']['watch_high']:.0f} (demonstration range)",
    "sbp": f"{P['sbp']['watch_low']:.0f}-{P['sbp']['watch_high']:.0f} (demonstration range)",
    "dbp": f"below {P['dbp']['watch_high']:.0f} (demonstration range)",
    "spo2": f"{P['spo2']['watch']:.0f} or higher (demonstration range)",
}
# (record vitals key, metric name, unit, decimals) per body system, in the order of the six tiles.
SYSTEM_METRICS = {
    "brain": [("sleep_hours", "Sleep last period", "h", 1), ("mood_score", "Mood rating (self-reported)", "", 1),
              ("pvt_reaction_ms", "Reaction time (PVT)", "ms", 0)],
    "heart": [("heart_rate", "Heart rate", "bpm", 0), ("hrv_rmssd", "Heart rate variability (RMSSD)", "ms", 0),
              ("sbp", "Systolic blood pressure", "mmHg", 0), ("dbp", "Diastolic blood pressure", "mmHg", 0)],
    "blood": [("spo2", "Blood oxygen (SpO2)", "%", 0), ("co2_mmhg", "Cabin CO2", "mmHg", 1),
              ("fluid_intake_ml", "Fluid intake", "ml", 0)],
    "muscles": [("vo2max", "VO2max", "ml/kg/min", 1)],
    "radiation": [("radiation_msv", "Dose this reading", "mSv", 2)],
    "bones": [],  # exercise flag added below
}
BASELINE_OF = {"heart_rate": "baseline_hr", "hrv_rmssd": "baseline_hrv_rmssd", "sbp": "baseline_sbp", "dbp": "baseline_dbp",
               "spo2": "baseline_spo2"}


class ChatUnavailable(Exception):
    """Live AI could not answer; `reason` is a short code safe to show and log."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def system_instruction() -> str:
    """The prompt file as written, with the context placeholder pointing at the separate context part."""
    return PROMPT_PATH.read_text(encoding="utf-8").replace(
        "{{HEALTH_CONTEXT}}", "(provided separately, in the <health_context> part that comes before the astronaut's latest message)")


def _trend(current: float, history: pd.Series) -> str:
    h = history.dropna()
    if len(h) < 4:
        return "not enough history"
    mean = float(h.mean())
    if mean == 0 or abs(current - mean) / abs(mean) < 0.05:
        return "stable vs 7-day average"
    return ("higher" if current > mean else "lower") + " than 7-day average"


def build_health_context(rec: dict, baseline: dict, window: pd.DataFrame) -> dict:
    """HEALTH_CONTEXT for one astronaut. `rec` is that astronaut's own full record; only display
    values, statuses and the plain next action are copied. Nothing about other crew is passed in."""
    v = rec["vitals"]
    systems = []
    for s in rec["systems"]:
        metrics = []
        for key, name, unit, nd in SYSTEM_METRICS[s["key"]]:
            if key not in v or v[key] is None:
                continue
            m = {"name": name, "value": round(float(v[key]), nd) if nd else int(round(float(v[key]))), "unit": unit,
                 "trend": _trend(float(v[key]), window[key]) if key in window else "unknown"}
            if key in RANGES:
                m["range"] = RANGES[key]
            elif key in BASELINE_OF and BASELINE_OF[key] in baseline:
                m["range"] = f"personal preflight baseline {baseline[BASELINE_OF[key]]}"
            metrics.append(m)
        if s["key"] == "bones":
            metrics.append({"name": "Exercise today", "value": s["metric"]["value"], "unit": "", "trend": "not tracked"})
        item = {"name": s["name"], "status": UI_LABEL[s["level"]], "metrics": metrics}
        if s.get("proxy"):
            item["note"] = "Status follows the Gravity hazard as a proxy; not a measurement of this system."
        systems.append(item)
    nxt = (rec.get("astronaut_summary") or {}).get("next_action")
    return {
        "updated_at": rec.get("scored_at"),
        "reading_time": rec.get("reading_timestamp"),
        "mission_elapsed": rec.get("met"),
        "mission_day": rec.get("mission_day"),
        "data_source": "replay of a recorded, simulated mission dataset",
        "hazards": {HAZARD_NAMES[h]: {"status": UI_LABEL[o["level"]]} for h, o in rec["hazards"].items()},
        "systems": systems,
        "next_action": nxt["text"] if nxt else None,
    }


def build_request(context: dict, message: str, history: list[dict]) -> dict:
    contents = [{"role": t["role"], "parts": [{"text": t["text"]}]} for t in history[-HISTORY_TURNS:]]
    contents.append({"role": "user", "parts": [
        {"text": "<health_context>\n" + json.dumps(context, ensure_ascii=False, indent=1) + "\n</health_context>"},
        {"text": message},
    ]})
    return {
        "systemInstruction": {"parts": [{"text": system_instruction()}]},
        "contents": contents,
        "generationConfig": {"temperature": TEMPERATURE, "maxOutputTokens": MAX_OUTPUT_TOKENS},
    }


def _post(url: str, headers: dict, body: dict, timeout: float) -> httpx.Response:
    """The single network call (tests replace this)."""
    return httpx.post(url, headers=headers, json=body, timeout=timeout)


def ask_gemini(api_key: str | None, model: str, timeout: float, context: dict, message: str, history: list[dict]) -> str:
    if not api_key:
        raise ChatUnavailable("not_configured")
    try:
        r = _post(GEMINI_URL.format(model=model), {"x-goog-api-key": api_key, "Content-Type": "application/json"},
                  build_request(context, message, history), timeout)
    except httpx.TimeoutException:
        raise ChatUnavailable("timeout") from None
    except httpx.HTTPError as e:  # DNS failure, refused connection, no internet...
        raise ChatUnavailable(f"network_{type(e).__name__}") from None
    if r.status_code == 429:
        raise ChatUnavailable("rate_limited")
    if r.status_code != 200:
        raise ChatUnavailable(f"http_{r.status_code}")
    try:
        d = r.json()
    except ValueError:
        raise ChatUnavailable("bad_response") from None
    if (d.get("promptFeedback") or {}).get("blockReason"):
        raise ChatUnavailable("blocked")
    cands = d.get("candidates") or []
    if not cands:
        raise ChatUnavailable("empty")
    if cands[0].get("finishReason") in ("SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"):
        raise ChatUnavailable("blocked")
    text = "".join(p.get("text", "") for p in (cands[0].get("content") or {}).get("parts", []) if not p.get("thought")).strip()
    if not text:
        raise ChatUnavailable("empty")
    return text
