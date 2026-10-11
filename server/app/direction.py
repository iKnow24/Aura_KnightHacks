"""Which of the live mics heard a sound, after lining the streams up.

The phones do not share a clock. Each sends its own mono mic. This takes the
latest half-second from each one and slides them until the same bump lines up
(cross-correlation). The mic that heard that bump first, when one mic is clearly
closer, is the side. Quiet rooms return nothing. This never fires an alert.
"""
import numpy as np

RATE = 16000
WINDOW = RATE // 2  # half a second
MAX_LAG = int(RATE * 0.12)  # a sound crosses a room in well under this


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
