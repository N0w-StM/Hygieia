"""Alert policy, README 7.1."""
from app.alert_policy import AlertPolicy


def feed(levels, policy=None):
    p = policy or AlertPolicy()
    return [[(e["type"], e["level"]) for e in p.observe("A", "model:radiation", l)] for l in levels]


def test_red_is_immediate():
    assert feed([0, 2]) == [[], [("raise", 2)]]


def test_single_orange_does_not_alert():
    assert feed([0, 1, 0, 1, 0]) == [[], [], [], [], []]


def test_orange_needs_two_consecutive_slots():
    assert feed([1, 1, 1]) == [[], [("raise", 1)], []]  # raised once, not repeated


def test_clear_after_two_consecutive_lower_readings():
    assert feed([1, 1, 0, 0]) == [[], [("raise", 1)], [], [("clear", 1)]]
    # one lower reading is not enough; the streak restarts when the level comes back
    assert feed([1, 1, 0, 1, 0, 0]) == [[], [("raise", 1)], [], [], [], [("clear", 1)]]


def test_watch_escalates_to_red_immediately():
    assert feed([1, 1, 2]) == [[], [("raise", 1)], [("clear", 1), ("raise", 2)]]


def test_red_deescalates_to_watch_after_two_orange():
    assert feed([2, 1, 1]) == [[("raise", 2)], [], [("clear", 2), ("raise", 1)]]


def test_red_clears_after_two_green():
    assert feed([2, 2, 0, 0, 0]) == [[("raise", 2)], [], [], [("clear", 2)], []]


def test_red_then_green_orange_clears_without_new_watch():
    # GREEN, ORANGE = two lower readings, but ORANGE has not held for two slots
    assert feed([2, 0, 1, 1]) == [[("raise", 2)], [], [("clear", 2)], [("raise", 1)]]


def test_keys_and_subjects_are_independent():
    p = AlertPolicy()
    assert p.observe("A", "model:radiation", 1) == []
    assert p.observe("B", "model:radiation", 1) == []
    assert p.observe("A", "model:gravity", 1) == []
    assert [e["type"] for e in p.observe("A", "model:radiation", 1)] == ["raise"]


def test_reset():
    p = AlertPolicy()
    feed([1], p)
    p.reset()
    assert feed([1], p) == [[]]
