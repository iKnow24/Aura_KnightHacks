import numpy as np

from app.direction import WINDOW, locate


def _click(at: int, amp: float = 0.4) -> np.ndarray:
    x = np.zeros(WINDOW, np.float32)
    x[at:at + 40] = amp
    return x


def test_silence_has_no_side():
    assert locate({"wearer": np.zeros(WINDOW, np.float32), "behind": np.zeros(WINDOW, np.float32)}) is None


def test_the_loud_mic_is_the_side():
    quiet = np.random.default_rng(0).normal(0, 0.01, WINDOW).astype(np.float32)
    found = locate({"wearer": quiet, "behind": _click(200, 0.8)})
    assert found["zone"] == "behind"


def test_headset_hears_it_first_so_the_sound_stays_at_the_center():
    found = locate({"wearer": _click(80), "behind": _click(500)})
    assert found["zone"] == "wearer"


def test_same_bump_keeps_the_mic_that_heard_it_first():
    # Same click, equally loud. The back mic's copy starts earlier, so the sound is behind.
    found = locate({"wearer": _click(500), "behind": _click(120)})
    assert found["zone"] == "behind"
