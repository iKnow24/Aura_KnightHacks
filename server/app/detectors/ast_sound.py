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
LABEL_MAP = {
    "Smoke detector, smoke alarm": ("smoke_alarm", 0.30, "critical"),
    "Fire alarm": ("smoke_alarm", 0.30, "critical"),
    "Doorbell": ("doorbell", 0.30, "warning"),
    "Ding-dong": ("doorbell", 0.30, "warning"),
    "Glass": ("glass_break", 0.35, "warning"),
    "Shatter": ("glass_break", 0.35, "warning"),
    "Baby cry, infant cry": ("baby_cry", 0.30, "warning"),
}


def to_alerts(scores: list[tuple[str, float]]) -> list[dict]:
    """Turn model scores into at most one alert per kind (the most confident one)."""
    best: dict[str, dict] = {}
    for label, score in scores:
        if label in LABEL_MAP:
            kind, threshold, severity = LABEL_MAP[label]
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
