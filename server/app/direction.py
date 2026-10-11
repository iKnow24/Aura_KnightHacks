"""Which mic heard a sound, using the headset as the clock in the center.

The headset mic sits on the person. The back cam is behind them, and the
security-camera phone sits on them. Those streams are not on one clock, so each
half-second is slid until the same bump lines up with the headset. A mic that
hears the bump earlier than the headset is the side the sound came from. If the
headset hears it first, the sound is at the center. Quiet rooms return nothing.
This never fires an alert.
"""
import json
from pathlib import Path

import numpy as np

RATE = 16000
WINDOW = RATE // 2  # half a second
MAX_LAG = int(RATE * 0.12)  # a sound crosses a room in well under this
CENTER = "wearer"  # the headset, on the person
# Meters, person facing +z. The phone is on the chest. The back cam is behind the shoulders.
# SAID and PSELDNets publish weights for a different rig: four capsules a few centimeters
# apart, recorded on one clock. Do not feed these three phones into those checkpoints.
MICS = {
    "wearer": np.array([0.0, 0.0, 0.0]),
    "drone": np.array([0.12, -0.20, 0.18]),
    "behind": np.array([0.0, 0.05, -0.28]),
}
SOUND = 343.0
_WEIGHTS = Path(__file__).with_name("direction_weights.json")


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x * x))) if len(x) else 0.0


def _lag(sig: np.ndarray, ref: np.ndarray) -> tuple[int, float]:
    """Samples by which sig is late compared with ref, and how clean the match is."""
    n = len(sig) + len(ref)
    spec = np.fft.rfft(sig, n) * np.conj(np.fft.rfft(ref, n))
    spec /= np.abs(spec) + 1e-8
    cc = np.fft.irfft(spec, n)
    max_lag = min(MAX_LAG, len(cc) // 2 - 1)
    window = np.concatenate((cc[-max_lag:], cc[: max_lag + 1]))
    peak = int(np.argmax(window)) - max_lag
    strength = float(window.max())
    return peak, strength


def features(tails: dict[str, np.ndarray], levels: dict[str, float]) -> np.ndarray:
    """Lag, match strength, and loudness of the back cam and the phone against the headset."""
    ref = tails[CENTER]
    vec = []
    for zone in ("behind", "drone"):
        if zone not in tails:
            vec.extend((0.0, 0.0, 0.0))
            continue
        lag, strength = _lag(tails[zone], ref)
        vec.extend((lag / MAX_LAG, strength, levels[zone]))
    vec.append(levels[CENTER])
    return np.asarray(vec, dtype=np.float64)


def _model():
    if not _WEIGHTS.exists():
        return None
    data = json.loads(_WEIGHTS.read_text())
    return {
        "classes": data["classes"],
        "mean": np.asarray(data["mean"], dtype=np.float64),
        "std": np.asarray(data["std"], dtype=np.float64),
        "W": np.asarray(data["W"], dtype=np.float64),
        "b": np.asarray(data["b"], dtype=np.float64),
    }


def _predict(vec: np.ndarray) -> tuple[str, float] | None:
    model = _model()
    if model is None:
        return None
    x = (vec - model["mean"]) / model["std"]
    scores = x @ model["W"] + model["b"]
    scores -= scores.max()
    prob = np.exp(scores)
    prob /= prob.sum()
    pick = int(np.argmax(prob))
    return model["classes"][pick], float(prob[pick])


def locate(streams: dict[str, np.ndarray], floor: float = 0.02) -> dict | None:
    """streams maps a zone name to mono float32. Returns {zone, level} or None."""
    tails = {}
    for zone, audio in streams.items():
        if audio is None or len(audio) < WINDOW // 2:
            continue
        tails[zone] = np.asarray(audio[-WINDOW:], dtype=np.float32)
    if not tails:
        return None
    levels = {zone: _rms(audio) for zone, audio in tails.items()}
    ranked = sorted(levels, key=levels.get, reverse=True)
    best = levels[ranked[0]]
    if best < floor:
        return None
    if len(ranked) == 1:
        return {"zone": ranked[0], "level": round(best, 4)}
    if CENTER in tails:
        guessed = _predict(features(tails, levels))
        if guessed and guessed[1] >= 0.55:
            return {"zone": guessed[0], "level": round(levels.get(guessed[0], best), 4)}
        return _against_headset(tails, levels, floor)
    second = levels[ranked[1]]
    # One mic much louder: the sound is next to that phone.
    if best >= second * 1.45:
        return {"zone": ranked[0], "level": round(best, 4)}
    # Similar loudness: line the waveforms up and keep the mic that heard it first.
    ref = tails[ranked[0]]
    earliest, earliest_lag = ranked[0], 0
    matched = False
    for zone in ranked[1:]:
        if levels[zone] < best * 0.55:
            continue
        lag, strength = _lag(tails[zone], ref)
        if strength < 0.15:
            continue
        matched = True
        if lag < earliest_lag:
            earliest, earliest_lag = zone, lag
    if matched:
        return {"zone": earliest, "level": round(levels[earliest], 4)}
    return None


def _against_headset(tails: dict[str, np.ndarray], levels: dict[str, float], floor: float) -> dict | None:
    """Compare every other mic with the headset. Earlier than the headset means that side."""
    ref = tails[CENTER]
    ref_level = levels[CENTER]
    winner = None
    lead = 0
    for zone, audio in tails.items():
        if zone == CENTER or levels[zone] < floor * 0.5:
            continue
        if levels[zone] >= max(ref_level, floor) * 1.45:
            score = 10_000 + levels[zone]
        else:
            lag, strength = _lag(audio, ref)
            # A negative lag means this mic's copy of the bump starts before the headset's.
            if strength < 0.15 or lag > -8:
                continue
            score = -lag
        if winner is None or score > lead:
            winner, lead = zone, score
    if winner:
        return {"zone": winner, "level": round(levels[winner], 4)}
    if ref_level >= floor:
        return {"zone": CENTER, "level": round(ref_level, 4)}
    return None
