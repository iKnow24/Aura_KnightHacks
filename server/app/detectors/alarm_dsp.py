"""Smoke/CO alarm detector without any AI model.

Real smoke alarms beep at roughly 3 kHz in a T3 pattern (beep-beep-beep, pause).
We measure how much energy sits in the 2.8-3.6 kHz band compared with the whole
signal, then count beeps over the last few seconds. Deterministic and explainable,
so it is the detector we trust for the stage demo. The AI sound model runs next to it.
"""
import numpy as np

SAMPLE_RATE = 16_000
BAND = (2800, 3600)
FRAME = 400  # 25 ms frames


def band_ratio(frame: np.ndarray) -> float:
    spectrum = np.abs(np.fft.rfft(frame * np.hanning(len(frame)))) ** 2
    freqs = np.fft.rfftfreq(len(frame), 1 / SAMPLE_RATE)
    in_band = spectrum[(freqs >= BAND[0]) & (freqs <= BAND[1])].sum()
    return float(in_band / (spectrum.sum() + 1e-9))


def count_beeps(audio: np.ndarray, threshold: float = 0.5) -> int:
    """Number of separate 'on' stretches where the alarm band dominates."""
    frames = audio[: len(audio) // FRAME * FRAME].reshape(-1, FRAME)
    on = np.array([band_ratio(f) > threshold for f in frames])
    rising_edges = np.flatnonzero(on[1:] & ~on[:-1])
    return len(rising_edges) + int(on[0]) if len(on) else 0


def is_alarm(audio: np.ndarray) -> bool:
    """Call with ~3 s of 16 kHz mono float audio. Needs 3 beeps to fire."""
    return count_beeps(audio) >= 3
