"""UI copy layer: plain-language wording on top of the protocol-style model catalog.

Wording is a demo draft and must be validated by mission clinicians (Model/README.md 4.4).
Language rule: statuses are "flagged for review", never a diagnosis.
"""
from __future__ import annotations

DISCLAIMER = "For monitoring and research purposes, not a medical diagnosis."

HAZARD_LABELS = {
    "radiation": "Space Radiation",
    "isolation": "Isolation and Confinement",
    "distance": "Distance from Earth",
    "gravity": "Gravity Fields",
    "environment": "Hostile/Closed Environments",
}
HAZARD_SHORT = {
    "radiation": "Radiation", "isolation": "Isolation", "distance": "Distance",
    "gravity": "Gravity", "environment": "Environment",
}
HAZARD_SIGNALS = {  # main signals behind each hazard (README 6.1) -> vitals keys shown beside it
    "radiation": ["radiation_msv"],
    "isolation": ["sleep_hours", "mood_score", "pvt_reaction_ms"],
    "distance": [],
    "gravity": ["core_temp", "sans_trt_um", "vo2max"],
    "environment": ["co2_mmhg", "spo2", "fluid_intake_ml"],
}
HAZARD_ABOUT = {
    "radiation": "Dose received outside Earth's magnetic shield, including solar particle events.",
    "isolation": "Sleep, mood and reaction time under long confinement.",
    "distance": "Combined signals that may need care without real-time help from Earth.",
    "gravity": "Body changes in altered gravity: core temperature, eye (SANS) and fitness measures.",
    "environment": "Cabin air and hydration: CO₂, blood oxygen and fluid intake.",
}
# Honest per-hazard caveats from the held-out evaluation (README section 8).
HAZARD_CAVEATS = {
    "radiation": "Not yet validated: the evaluation period had no flagged radiation readings.",
    "isolation": "Limited sensitivity: in evaluation it missed most Watch-level readings.",
    "distance": "Limited sensitivity: in evaluation it did not detect Watch-level readings. Do not rely on it alone.",
    "gravity": "Evaluated at Watch level only. This model never outputs Critical for gravity.",
    "environment": "Not yet validated: the evaluation period had no flagged environment readings.",
}

SIGNAL_LABELS = {
    "heart_rate": ("Heart rate", "bpm"), "hrv_rmssd": ("Heart rate variability", "ms"),
    "sbp": ("Systolic pressure", "mmHg"), "dbp": ("Diastolic pressure", "mmHg"),
    "core_temp": ("Core temperature", "°C"), "spo2": ("SpO₂", "%"),
    "sleep_hours": ("Sleep", "h"), "mood_score": ("Mood score", "/100"),
    "pvt_reaction_ms": ("Reaction time (PVT)", "ms"), "fluid_intake_ml": ("Fluid intake", "mL"),
    "co2_mmhg": ("Cabin CO₂", "mmHg"), "radiation_msv": ("Radiation dose (per reading)", "mSv"),
    "sans_trt_um": ("Eye OCT change (ΔTRT)", "µm"), "vo2max": ("VO₂max", "ml/kg/min"),
}

OVERALL_COPY = {
    0: ("All systems normal", "No action needed. Continue your planned routine."),
    1: ("Watch: {what}", "You need to take one protective action."),
    2: ("Critical: {what}", "Act now. Contact your flight surgeon."),
}

# Protocol text (countermeasures_v2.json) -> plain language for the Astronaut View.
PLAIN_ACTIONS = {
    "Monitor space weather forecasts": "Radiation is higher than usual. Check the space weather update.",
    "Prepare storm shelter access": "Make sure the way to the shielded area is clear.",
    "Review EVA schedule": "Check with the crew before any planned spacewalk.",
    "IMMEDIATE: Enter storm shelter": "Go to the shielded area now and stay there.",
    "Cancel/abort EVA operations": "Stop any spacewalk and come back inside.",
    "Contact SRAG for dose assessment": "Ask the flight surgeon to request a radiation dose review.",
    "Increase ARED exercise sessions": "Add a resistance exercise session today.",
    "Review calcium/vitamin D intake": "Check that you took your calcium and vitamin D.",
    "Schedule OCT vision check": "Book an eye scan with the medical officer.",
    "Medical evaluation required": "See the medical officer for a check-up now.",
    "Restrict physical activity if VO2max critical": "Take it easy on exercise until the medical officer clears you.",
    "Urgent SANS assessment": "Get an eye check with the medical officer now.",
    "Enforce 7+ hour sleep schedule": "Plan at least 7 hours of sleep tonight.",
    "Schedule crew social activity": "Spend some relaxed time with the crew today.",
    "Review workload distribution": "Ask to rebalance your tasks for today.",
    "Mandatory rest period": "Stop work and rest now.",
    "Private psychological consultation": "Ask for a private talk with the medical officer.",
    "Defer safety-critical tasks": "Hand over or postpone safety-critical tasks.",
    "Prepare autonomous medical protocols": "Keep the onboard medical guide ready.",
    "Verify onboard diagnostic equipment": "Check that the medical kit devices are working.",
    "Queue telemetry for ground review": "Your readings will be sent to Earth for review.",
    "Execute EIMO autonomous care": "Follow the onboard medical guide with the medical officer now.",
    "Activate CDSS decision support": "Open the onboard medical guide with the medical officer.",
    "Log all interventions for delayed uplink": "Write down every step taken so Earth can review it.",
    "Check CDRA CO2 scrubber status": "Cabin air needs a check. Tell the crew to check the CO₂ scrubber.",
    "Increase ventilation in sleep quarters": "Open up the airflow in your sleep area.",
    "Monitor SpO2 closely": "Keep your oxygen sensor on and check it often.",
    "Verify dual-bed CDRA operation": "Cabin air is poor. Check the CO₂ scrubber with the crew now.",
    "Administer supplemental O2 if needed": "Use the oxygen mask if the medical officer tells you to.",
    "Emergency ECLSS inspection": "Help the crew inspect the life-support system now.",
}


def plain_action(action: str) -> str:
    return PLAIN_ACTIONS.get(action, action)


def astronaut_summary(record: dict, rules: dict) -> dict:
    """Headline + exactly one next action for the Astronaut View (no clinical detail)."""
    level = max(record["overall"]["level"], rules["heart"]["level"], rules["spo2"]["level"])
    flagged = [HAZARD_SHORT[h] for h, o in record["hazards"].items() if o["level"] == level and level > 0]
    for key, name in (("heart", "Heart"), ("spo2", "Blood oxygen")):
        if level > 0 and rules[key]["level"] == level:
            flagged.append(name)
    title, body = OVERALL_COPY[level]
    pa = record.get("primary_action")
    if pa and record["overall"]["level"] == level:
        action = {"hazard": pa["hazard"], "text": plain_action(pa["action"])}
    elif level > 0:  # raised by a rule, not by the model
        action = {"hazard": None, "text": "Sit down, rest, and repeat the reading. Contact your flight surgeon."
                  if level == 2 else "Rest for a few minutes and repeat the reading."}
    else:
        action = None
    return {
        "level": level,
        "title": title.format(what=", ".join(flagged)),
        "body": body,
        "next_action": action,
    }
