"""AI sound classifier: Audio Spectrogram Transformer fine-tuned on AudioSet (527 sound classes).

Runs on the AMD GPU when available, CPU otherwise. If transformers/torch aren't installed
(e.g. a laptop with only requirements.txt), it switches itself off and the alarm DSP keeps working.

The label names below are AudioSet's. They were written from the AudioSet ontology, not
checked against the downloaded model yet: on first run, `python -m app.detectors.ast_sound`
prints the model's labels so you can confirm them.
"""
import logging

import numpy as np

log = logging.getLogger(__name__)

MODEL_ID = "MIT/ast-finetuned-audioset-10-10-0.4593"
SAMPLE_RATE = 16_000

# AudioSet label -> (our alert kind, minimum score, severity). Kinds match the alert contract.
# The everyday ones are the sounds hard-of-hearing people say they miss most: the timer they
# walked away from, the kettle, the phone, a knock, the tap left running.
LABEL_MAP = {
    "Smoke detector, smoke alarm": ("smoke_alarm", 0.30, "critical"),
    "Fire alarm": ("smoke_alarm", 0.30, "critical"),
    "Doorbell": ("doorbell", 0.30, "warning"),
    "Ding-dong": ("doorbell", 0.30, "warning"),
    "Glass": ("glass_break", 0.35, "warning"),
    "Shatter": ("glass_break", 0.35, "warning"),
    "Baby cry, infant cry": ("baby_cry", 0.30, "warning"),
    # Home, everyday
    "Beep, bleep": ("timer", 0.35, "warning"),
    "Microwave oven": ("timer", 0.35, "warning"),
    "Buzzer": ("timer", 0.35, "warning"),
    "Kettle whistle": ("kettle", 0.30, "warning"),
    "Whistle": ("kettle", 0.40, "warning"),
    "Telephone bell ringing": ("phone_ring", 0.30, "warning"),
    "Ringtone": ("phone_ring", 0.30, "warning"),
    "Knock": ("knock", 0.35, "warning"),
    "Alarm clock": ("alarm_clock", 0.30, "warning"),
    "Water tap, faucet": ("water_running", 0.45, "info"),
    "Bark": ("dog_bark", 0.40, "info"),
    "Car alarm": ("car_alarm", 0.35, "info"),
    # Street
    "Vehicle horn, car horn, honking": ("car_horn", 0.30, "critical"),
    "Siren": ("siren", 0.30, "critical"),
    "Emergency vehicle": ("siren", 0.30, "critical"),
    "Reversing beeps": ("reversing", 0.30, "critical"),
    "Bicycle bell": ("bike_bell", 0.30, "warning"),
    "Motor vehicle (road)": ("vehicle", 0.35, "warning"),
    "Car": ("vehicle", 0.35, "warning"),
}

# Outside there is always a car somewhere, so "vehicle" alone means nothing. It only becomes
# an alert when the sound is getting clearly louder over the 3 s window (about +6 dB): approaching.
NEEDS_RISE = {"vehicle"}
RISE_RATIO = 2.0


def loudness_rise(audio: np.ndarray) -> float:
    """How much louder the last second is than the first (RMS ratio)."""
    third = len(audio) // 3
    if third == 0:
        return 1.0
    first = float(np.sqrt(np.mean(audio[:third] ** 2))) + 1e-6
    last = float(np.sqrt(np.mean(audio[-third:] ** 2))) + 1e-6
    return last / first


def to_alerts(scores: list[tuple[str, float]], kinds: list[str] | None = None, rise: float = 1.0) -> list[dict]:
    """Turn model scores into at most one alert per kind (the most confident one).
    kinds: only these alert kinds (the current mode's list); None means all."""
    best: dict[str, dict] = {}
    for label, score in scores:
        if label in LABEL_MAP:
            kind, threshold, severity = LABEL_MAP[label]
            if kinds is not None and kind not in kinds:
                continue
            if kind in NEEDS_RISE and rise < RISE_RATIO:
                continue
            if score >= threshold and score > best.get(kind, {}).get("confidence", 0):
                best[kind] = {"kind": kind, "severity": severity, "confidence": round(float(score), 3), "label": label}
    return list(best.values())


class SoundClassifier:
    def __init__(self):
        self._pipe = None
        self._failed = False

    def available(self) -> bool:
        return self._load() is not None

    def _load(self):
        if self._pipe is None and not self._failed:
            try:
                import torch
                from transformers import pipeline

                device = 0 if torch.cuda.is_available() else -1  # ROCm shows up as "cuda" in PyTorch
                self._pipe = pipeline("audio-classification", model=MODEL_ID, device=device)
                log.info("AST loaded on %s", "GPU" if device == 0 else "CPU")
            except Exception as e:  # missing packages, no internet for the first download, etc.
                self._failed = True
                log.warning("AST sound model off (%s). Alarm DSP still runs.", e)
        return self._pipe

    def classify(self, audio: np.ndarray, top_k: int = 10) -> list[tuple[str, float]]:
        pipe = self._load()
        if pipe is None:
            return []
        out = pipe({"raw": audio, "sampling_rate": SAMPLE_RATE}, top_k=top_k)
        return [(o["label"], o["score"]) for o in out]


if __name__ == "__main__":
    clf = SoundClassifier()
    if not clf.available():
        raise SystemExit("Model didn't load; see the warning above.")
    labels = set(clf._pipe.model.config.id2label.values())
    for name in LABEL_MAP:
        print(("OK      " if name in labels else "MISSING ") + name)
    silence = np.zeros(SAMPLE_RATE * 3, dtype=np.float32)
    print("Silence top 3:", clf.classify(silence, top_k=3))
