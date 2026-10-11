"""Train the body-mic direction model and write server/app/direction_weights.json.

The lessons are calculated, not downloaded. A short burst is placed at the headset,
the chest phone, and the back cam with the delay sound would actually take to reach
each one (distance / 343 m/s). The label is whichever of those three mics is closest
to the source. SAID (huggingface.co/IN03X/SAID) and PSELDNets
(huggingface.co/datasets/Jinbo-HU/PSELDNets) are the reference models; their
checkpoints expect four capsules on one puck and are not used here.

    python -m app.direction_train
"""
import json
from pathlib import Path

import numpy as np

from app.direction import MICS, RATE, SOUND, WINDOW, features

CLASSES = ("wearer", "behind", "drone")
OUT = Path(__file__).with_name("direction_weights.json")


def _burst(delay: int, amp: float, rng: np.random.Generator) -> np.ndarray:
    audio = rng.normal(0, 0.008, WINDOW).astype(np.float32)
    start = int(np.clip(180 + delay, 0, WINDOW - 50))
    audio[start:start + 36] += amp
    return audio


def _example(rng: np.random.Generator) -> tuple[dict[str, np.ndarray], str]:
    azimuth = rng.uniform(0, 2 * np.pi)
    dist = rng.uniform(0.15, 2.2)
    source = np.array([np.sin(azimuth) * dist, rng.uniform(-0.3, 0.4), np.cos(azimuth) * dist])
    distances = {name: float(np.linalg.norm(source - pos)) for name, pos in MICS.items()}
    label = min(distances, key=distances.get)
    earliest = min(distances.values())
    streams = {}
    for name, meters in distances.items():
        samples = int(round((meters - earliest) / SOUND * RATE))
        closer = meters < 0.45
        streams[name] = _burst(samples, 0.55 if closer else 0.22, rng)
    return streams, label


def _fit(x: np.ndarray, y: np.ndarray, steps: int = 400, lr: float = 0.35) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(1)
    w = rng.normal(0, 0.01, (x.shape[1], len(CLASSES)))
    b = np.zeros(len(CLASSES))
    eye = np.eye(len(CLASSES))
    for _ in range(steps):
        scores = x @ w + b
        scores -= scores.max(axis=1, keepdims=True)
        prob = np.exp(scores)
        prob /= prob.sum(axis=1, keepdims=True)
        grad = prob - eye[y]
        w -= lr * (x.T @ grad) / len(x)
        b -= lr * grad.mean(axis=0)
    return w, b


def train(seed: int = 7, n: int = 2400) -> dict:
    rng = np.random.default_rng(seed)
    rows, labels = [], []
    for _ in range(n):
        streams, label = _example(rng)
        levels = {zone: float(np.sqrt(np.mean(audio * audio))) for zone, audio in streams.items()}
        rows.append(features(streams, levels))
        labels.append(CLASSES.index(label))
    raw = np.vstack(rows)
    y = np.asarray(labels)
    cut = int(len(raw) * 0.8)
    mean = raw[:cut].mean(axis=0)
    std = raw[:cut].std(axis=0)
    std[std < 1e-6] = 1.0
    x = (raw - mean) / std
    w, b = _fit(x[:cut], y[:cut])
    hold = (x[cut:] @ w + b).argmax(axis=1)
    return {
        "classes": list(CLASSES),
        "mean": mean.round(6).tolist(),
        "std": std.round(6).tolist(),
        "W": w.round(6).tolist(),
        "b": b.round(6).tolist(),
        "holdout_accuracy": round(float((hold == y[cut:]).mean()), 4),
        "mics_m": {name: pos.round(3).tolist() for name, pos in MICS.items()},
        "note": "Trained on calculated delays for the headset, chest phone, and back cam. Not SAID or PSELDNets weights.",
    }


def main():
    data = train()
    OUT.write_text(json.dumps(data, indent=2) + "\n")
    print(f"wrote {OUT.name} holdout accuracy {data['holdout_accuracy']}")


if __name__ == "__main__":
    main()
