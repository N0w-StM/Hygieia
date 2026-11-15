"""Alert policy (Model/README.md section 7.1). Pure logic, no I/O.

- RED raises an alert immediately, no debounce.
- ORANGE raises a Watch alert only after 2 consecutive scoring slots.
- An active alert clears / de-escalates after 2 consecutive lower readings.
- Inputs are per-hazard levels only: anomaly score and model_overall never reach this code.
"""
from __future__ import annotations

from dataclasses import dataclass

ORANGE_SLOTS = 2
LOWER_SLOTS = 2


@dataclass
class _State:
    active: int = 0          # level of the currently active alert (0 = none)
    nongreen_streak: int = 0  # consecutive readings with level >= 1
    lower_streak: int = 0     # consecutive readings below the active level


class AlertPolicy:
    """One state machine per (subject, key). `key` is a hazard or a rule name."""

    def __init__(self):
        self._states: dict[tuple[str, str], _State] = {}

    def reset(self):
        self._states.clear()

    def active_level(self, subject: str, key: str) -> int:
        return self._states.get((subject, key), _State()).active

    def observe(self, subject: str, key: str, level: int) -> list[dict]:
        """Feed one scoring slot. Returns events: {"type": "raise"|"clear", "level": int, "reason": str}."""
        level = int(level)
        st = self._states.setdefault((subject, key), _State())
        st.nongreen_streak = st.nongreen_streak + 1 if level >= 1 else 0
        events: list[dict] = []

        if level >= st.active:
            st.lower_streak = 0
            if level == 2 and st.active < 2:
                if st.active == 1:
                    events.append({"type": "clear", "level": 1, "reason": "escalated"})
                st.active = 2
                events.append({"type": "raise", "level": 2, "reason": "red_immediate"})
            elif level == 1 and st.active == 0 and st.nongreen_streak >= ORANGE_SLOTS:
                st.active = 1
                events.append({"type": "raise", "level": 1, "reason": "orange_2_consecutive"})
            return events

        # level < active
        st.lower_streak += 1
        if st.lower_streak >= LOWER_SLOTS:
            old = st.active
            # RED -> Watch only if ORANGE itself has held for the required consecutive slots.
            st.active = 1 if (level == 1 and st.nongreen_streak >= ORANGE_SLOTS) else 0
            st.lower_streak = 0
            events.append({"type": "clear", "level": old,
                           "reason": "deescalated" if st.active else "two_lower_readings"})
            if st.active:
                events.append({"type": "raise", "level": 1, "reason": "deescalated_to_watch"})
        return events
