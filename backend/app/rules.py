"""Deterministic rule engine and body-system mapping (Model/README.md section 6.2).

The model has no per-body-system output. Heart & Blood Vessels comes from the rules below;
the other tiles follow a hazard level (Muscles/Bones are a labelled proxy of `gravity`).

PROTOCOL thresholds are PLACEHOLDER DEFAULTS for the hackathon demo. They are not a validated
mission medical protocol and must be replaced by one before any real use.
"""
from __future__ import annotations

from .model_service import level_obj

PROTOCOL = {
    "source": "Placeholder demo thresholds, pending mission medical protocol",
    # bpm above preflight resting baseline. Wide margin on purpose: the 12:00 slot in the recorded
    # data averages about +21 bpm (daytime activity), so a tighter rule would fire every day.
    "hr_above_baseline": {"watch": 28.0, "critical": 38.0},
    "hr_absolute": {"watch_high": 100.0, "critical_high": 120.0, "watch_low": 45.0, "critical_low": 40.0},
    "sbp": {"watch_high": 145.0, "critical_high": 160.0, "watch_low": 90.0, "critical_low": 80.0},
    "dbp": {"watch_high": 90.0, "critical_high": 100.0},
    "hrv_fraction_of_baseline": {"watch": 0.45, "critical": 0.35},
    "spo2": {"watch": 95.0, "critical": 94.0},                # design: mission threshold >= 94 %
}

RULE_LABELS = {"heart": "Heart & Blood Vessels", "spo2": "Blood oxygen"}


def heart_rule(v: dict, baseline: dict) -> tuple[int, list[str]]:
    p, level, reasons = PROTOCOL, 0, []

    def hit(lvl: int, text: str):
        nonlocal level
        level = max(level, lvl)
        reasons.append(text)

    hr, d_hr = v["heart_rate"], v["heart_rate"] - baseline["baseline_hr"]
    if hr >= p["hr_absolute"]["critical_high"] or hr <= p["hr_absolute"]["critical_low"] or d_hr >= p["hr_above_baseline"]["critical"]:
        hit(2, f"Heart rate {hr:.0f} bpm ({d_hr:+.0f} vs baseline)")
    elif hr >= p["hr_absolute"]["watch_high"] or hr <= p["hr_absolute"]["watch_low"] or d_hr >= p["hr_above_baseline"]["watch"]:
        hit(1, f"Heart rate {hr:.0f} bpm ({d_hr:+.0f} vs baseline)")

    sbp, dbp = v["sbp"], v["dbp"]
    if sbp >= p["sbp"]["critical_high"] or sbp <= p["sbp"]["critical_low"] or dbp >= p["dbp"]["critical_high"]:
        hit(2, f"Blood pressure {sbp:.0f}/{dbp:.0f} mmHg")
    elif sbp >= p["sbp"]["watch_high"] or sbp <= p["sbp"]["watch_low"] or dbp >= p["dbp"]["watch_high"]:
        hit(1, f"Blood pressure {sbp:.0f}/{dbp:.0f} mmHg")

    frac = v["hrv_rmssd"] / baseline["baseline_hrv_rmssd"] if baseline["baseline_hrv_rmssd"] else 1.0
    if frac <= p["hrv_fraction_of_baseline"]["critical"]:
        hit(2, f"Heart rate variability at {frac:.0%} of baseline")
    elif frac <= p["hrv_fraction_of_baseline"]["watch"]:
        hit(1, f"Heart rate variability at {frac:.0%} of baseline")
    return level, reasons


def spo2_rule(v: dict) -> tuple[int, list[str]]:
    s = v["spo2"]
    if s < PROTOCOL["spo2"]["critical"]:
        return 2, [f"SpO2 {s:.1f}% below mission threshold"]
    if s < PROTOCOL["spo2"]["watch"]:
        return 1, [f"SpO2 {s:.1f}% near mission threshold"]
    return 0, []


def evaluate_rules(vitals: dict, baseline: dict) -> dict:
    h_level, h_reasons = heart_rule(vitals, baseline)
    s_level, s_reasons = spo2_rule(vitals)
    return {
        "heart": {**level_obj(h_level), "reasons": h_reasons},
        "spo2": {**level_obj(s_level), "reasons": s_reasons},
    }


def _hm(hours: float) -> str:
    h = int(hours)
    return f"{h} h {int(round((hours - h) * 60)):02d} min"


def build_systems(record: dict, rules: dict) -> list[dict]:
    """Six body-system tiles. `source` says where each status comes from."""
    hz = {h: o["level"] for h, o in record["hazards"].items()}
    v = record["vitals"]
    exercised = record["context"]["dataset_flags"]["exercise_completed"]

    def tile(key, name, level, source, metric_label, metric_value, proxy=False, note=None):
        return {"key": key, "name": name, **level_obj(level), "source": source, "proxy": proxy,
                "metric": {"label": metric_label, "value": metric_value}, "note": note}

    return [
        tile("brain", "Brain", hz["isolation"], "model:isolation", "Sleep", _hm(v["sleep_hours"])),
        tile("heart", "Heart & Blood Vessels", rules["heart"]["level"], "rule:heart",
             "Heart rate", f"{v['heart_rate']:.0f} bpm"),
        tile("blood", "Blood", max(hz["environment"], rules["spo2"]["level"]), "model:environment+rule:spo2",
             "SpO₂", f"{v['spo2']:.0f}%"),
        tile("muscles", "Muscles", hz["gravity"], "model:gravity", "VO₂max", f"{v['vo2max']:.1f} ml/kg/min",
             proxy=True, note="Follows the Gravity Fields hazard as a proxy. Not a muscle assessment."),
        tile("radiation", "Radiation", hz["radiation"], "model:radiation", "Dose this reading",
             f"{v['radiation_msv']:.2f} mSv"),
        tile("bones", "Bones", hz["gravity"], "model:gravity", "Exercise today", "Done" if exercised else "Not logged",
             proxy=True, note="Follows the Gravity Fields hazard as a proxy. Not a bone assessment."),
    ]
