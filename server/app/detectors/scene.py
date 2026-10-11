"""Scene JSON: what each room camera sees, as one small JSON line every few seconds.

No video is streamed or stored. Each room phone sends a still photo every 5 s and body
keypoints 10 times a second. For every photo the brain runs OWLv2 once (see items.py) with the
item words AND the scene words below, then throws the photo away and keeps only this:

  {"type": "vision", "node_id": "kitchen-ab12cd", "zone": "kitchen", "ts": 1728540000.1,
   "source": "owlv2", "people": 1, "posture": "standing",
   "objects": [{"label": "person", "score": 0.61, "box": [0.21, 0.08, 0.55, 0.97]},
               {"label": "stove", "score": 0.44, "box": [0.6, 0.4, 0.98, 0.9]}],
   "counts": {"person": 1, "stove": 1}, "summary": "1 person (standing), stove",
   "model": "owlv2-base-patch16-ensemble", "device": "AMD Radeon ...", "inference_ms": 92.4, "total_ms": 131.0}

box is [left, top, right, bottom] as fractions of the photo (0 to 1). posture comes from the pose
keypoints, not the photo, and is null when the pose stream has seen nobody for 2 s.

This is description, not detection: nothing here fires an alert. OWLv2 guessing "fire" or "smoke"
from a photo is too unreliable for that; the smoke alarm detectors (alarm_dsp, AST) own alerts.
No faces are recognised: a person is just "person".
"""
import math
import os

from .fall import L_HIP, L_SHOULDER, R_HIP, R_SHOULDER, _mid, _visible, torso_tilt
from .items import ITEMS, MODEL_ID

# label -> (text prompt, minimum score). Things that matter for safety or for "what's going on".
SCENE = {
    "person": ("a photo of a person", 0.30),
    # The demo wearer: the dashboard camera highlights whoever has the white headset on.
    # Tune on the real headset: python -m app.detectors.scene photo.jpg
    "headset": ("a photo of a white VR headset", 0.20),
    "dog": ("a photo of a dog", 0.30),
    "cat": ("a photo of a cat", 0.30),
    "stove": ("a photo of a kitchen stove", 0.25),
    "pot": ("a photo of a cooking pot or pan", 0.25),
    "knife": ("a photo of a knife", 0.30),
    "fire": ("a photo of fire or flames", 0.35),
    "smoke": ("a photo of smoke", 0.35),
    "door": ("a photo of a door", 0.30),
    "bed": ("a photo of a bed", 0.30),
    "couch": ("a photo of a couch", 0.30),
    "chair": ("a photo of a chair", 0.30),
    "table": ("a photo of a table", 0.30),
    "tv": ("a photo of a television", 0.30),
    "laptop": ("a photo of a laptop", 0.30),
    "cup": ("a photo of a cup or mug", 0.30),
    "bottle": ("a photo of a bottle", 0.30),
    "pill bottle": ("a photo of a pill bottle", 0.30),
    "walker": ("a photo of a walking frame or cane", 0.30),
    "wheelchair": ("a photo of a wheelchair", 0.30),
}

L_KNEE, R_KNEE = 25, 26
EVERY_S = float(os.environ.get("SCENE_LOG_EVERY_S", "5"))  # phone scene messages: log at most this often


def queries() -> tuple[list[str], list[float], dict[str, str]]:
    """All OWLv2 text queries (items first, then scene words), their thresholds, and prompt -> label."""
    table = {**{f"item:{k}": v for k, v in ITEMS.items()}, **SCENE}
    prompts = [p for p, _ in table.values()]
    labels = {p: k.removeprefix("item:") for k, (p, _) in table.items()}
    return prompts, [t for _, t in table.values()], labels


def posture(landmarks) -> str | None:
    """lying / sitting / standing from 33 MediaPipe keypoints, or None when the body isn't clear."""
    if not landmarks or len(landmarks) < 27 or not _visible(landmarks, L_SHOULDER, R_SHOULDER, L_HIP, R_HIP):
        return None
    if torso_tilt(landmarks) > 60:
        return "lying"
    if not _visible(landmarks, L_KNEE, R_KNEE):
        return "upright"  # knees out of frame: can't tell sitting from standing
    sh, hip, knee = _mid(landmarks[L_SHOULDER], landmarks[R_SHOULDER]), _mid(landmarks[L_HIP], landmarks[R_HIP]), \
        _mid(landmarks[L_KNEE], landmarks[R_KNEE])
    torso = math.dist(sh, hip) or 1e-6
    # Thighs about level (knees hardly lower than hips) means sitting.
    return "sitting" if (knee[1] - hip[1]) < 0.45 * torso else "standing"


def build(node_id: str, zone: str, ts: float, hits: list[dict], labels: dict[str, str], width: int, height: int,
          timing: dict, pose_posture: str | None, pose_person: bool) -> dict:
    """OWLv2 hits (pixels) + pose -> the vision JSON line above."""
    objects = sorted(({"label": labels.get(h["label"], h["label"]), "score": round(h["score"], 2),
                       "box": [round(h["box"]["xmin"] / width, 3), round(h["box"]["ymin"] / height, 3),
                               round(h["box"]["xmax"] / width, 3), round(h["box"]["ymax"] / height, 3)]}
                      for h in hits), key=lambda o: -o["score"])[:20]
    counts: dict[str, int] = {}
    for o in objects:
        counts[o["label"]] = counts.get(o["label"], 0) + 1
    people = max(counts.get("person", 0), 1 if pose_person else 0)
    event = {"type": "vision", "node_id": node_id, "zone": zone, "ts": ts, "source": "owlv2",
             "people": people, "posture": pose_posture, "objects": objects, "counts": counts,
             "summary": summary(counts, people, pose_posture), "model": MODEL_ID.split("/")[-1], **timing}
    event["risk"] = rate(event)
    return event


def from_phone(node_id: str, zone: str, ts: float, objects: list) -> dict:
    """The rear/outside phone already detects objects itself (EfficientDet in the browser) and sends
    [{kind, bearing, dist}]. Same JSON shape, no photo ever reaches the brain."""
    objs = [{"label": str(o.get("kind")), "bearing": o.get("bearing"), "dist": o.get("dist")}
            for o in objects[:20] if isinstance(o, dict) and o.get("kind")]
    counts: dict[str, int] = {}
    for o in objs:
        counts[o["label"]] = counts.get(o["label"], 0) + 1
    people = counts.get("person", 0)
    event = {"type": "vision", "node_id": node_id, "zone": zone, "ts": ts, "source": "phone",
             "people": people, "posture": None, "objects": objs, "counts": counts,
             "summary": summary(counts, people, None), "model": "efficientdet-lite0 (on phone)"}
    event["risk"] = rate(event)
    return event


def from_boxes(node_id: str, zone: str, ts: float, objects: list) -> dict:
    """Boxes measured on this computer (the laptop camera) when the big vision model is off.
    Same JSON shape. The photo never arrives."""
    objs = []
    for raw in objects[:20]:
        if not isinstance(raw, dict) or not raw.get("label"):
            continue
        item = {"label": str(raw["label"])[:40], "score": round(float(raw.get("score") or 0), 2)}
        box = raw.get("box")
        if isinstance(box, list) and len(box) == 4:
            item["box"] = [round(float(n), 3) for n in box]
        objs.append(item)
    counts: dict[str, int] = {}
    for obj in objs:
        counts[obj["label"]] = counts.get(obj["label"], 0) + 1
    people = counts.get("person", 0)
    event = {"type": "vision", "node_id": node_id, "zone": zone, "ts": ts, "source": "phone",
             "people": people, "posture": None, "objects": objs, "counts": counts,
             "summary": summary(counts, people, None), "model": "efficientdet-lite0 (on this Mac)"}
    event["risk"] = rate(event)
    return event


# Things a person asks about, or that a spill would move. People walking through are not a "difference".
WATCHED = ("cup", "bottle", "pill bottle", "keys", "glasses", "wallet", "phone", "remote")


def watched_counts(event: dict | None) -> dict[str, int]:
    counts = (event or {}).get("counts") or {}
    return {label: int(counts.get(label, 0)) for label in WATCHED if counts.get(label)}


def _centers(event: dict | None, label: str) -> list[tuple[float, float]]:
    out = []
    for obj in (event or {}).get("objects") or []:
        box = obj.get("box") if isinstance(obj, dict) else None
        if obj.get("label") == label and isinstance(box, list) and len(box) == 4:
            out.append(((box[0] + box[2]) / 2, (box[1] + box[3]) / 2))
    return out


# People and laptops are not "lost" just because a frame missed them. A real shift still gets a line.
MOVE = WATCHED + ("person", "laptop", "knife")


def moved_labels(before: dict | None, after: dict) -> list[str]:
    """Something important that is still in frame, but its box moved across the picture."""
    moved = []
    for label in MOVE:
        prev, now = _centers(before, label), _centers(after, label)
        need = 0.18 if label == "person" else 0.12
        if len(prev) == 1 and len(now) == 1 and math.dist(prev[0], now[0]) >= need:
            moved.append(label)
    return moved


def change_sentence(zone: str, before: dict | None, after: dict) -> tuple[str, list[str], list[str]] | None:
    """Spot the difference between two scene JSON lines. Returns (sentence, lost labels, still there)."""
    prev, now = watched_counts(before), watched_counts(after)
    lost = [label for label in WATCHED if prev.get(label, 0) > now.get(label, 0)]
    gained = [label for label in WATCHED if now.get(label, 0) > prev.get(label, 0)]
    moved = moved_labels(before, after)
    if not lost and not gained and not moved:
        return None
    bits = [f"the {label} is gone" for label in lost] + [f"a {label} showed up" for label in gained]
    bits += [f"the {label} moved" for label in moved]
    still = [label for label, n in now.items() if n]
    return f"In the {zone}, " + ", ".join(bits) + ".", lost, still


# Fixed scores. A higher number wins. Nothing here decides an alert; the detectors still do that.
RISK_SCORES = {"fire": 95, "smoke": 88, "knife": 72}
DRINKS = ("cup", "bottle")


def rate(event: dict) -> dict:
    """A 0–100 risk rating from one scene JSON line. Lying down and fire outrank a cup on the table."""
    score, why = 0, []
    counts = event.get("counts") or {}
    for label, points in RISK_SCORES.items():
        if counts.get(label) and points > score:
            score, why = points, [label]
    if event.get("posture") == "lying" and 80 > score:
        score, why = 80, ["someone lying down"]
    elif event.get("posture") == "lying" and "someone lying down" not in why:
        why.append("someone lying down")
    level = "critical" if score >= 80 else "warning" if score >= 55 else "low"
    return {"score": score, "level": level, "why": ", ".join(why) if why else "nothing risky"}


def summary(counts: dict[str, int], people: int, pose_posture: str | None) -> str:
    parts = []
    if people:
        parts.append(f"{people} {'person' if people == 1 else 'people'}" + (f" ({pose_posture})" if pose_posture else ""))
    parts += [f"{n} {label}s" if n > 1 else label for label, n in counts.items() if label != "person"]
    return ", ".join(parts) or "nothing recognised"


def convert_images(folder, out_dir, finder) -> int:
    """One JSON file per photo. The photos are not copied. Needs the vision model (the AMD box)."""
    import json
    import time
    from pathlib import Path

    from PIL import Image

    src, dest = Path(folder), Path(out_dir)
    dest.mkdir(parents=True, exist_ok=True)
    photos = [p for p in sorted(src.iterdir()) if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]
    if not photos:
        raise SystemExit(f"No photos in {src}")
    prompts, thresholds, labels = queries()
    for photo in photos:
        image = Image.open(photo).convert("RGB")
        hits, timing = finder.detect(image, prompts, thresholds)
        event = build(photo.stem, "room", time.time(), hits, labels, *image.size, timing, None, False)
        (dest / f"{photo.stem}.json").write_text(json.dumps(event))
        print(photo.name, event["risk"]["level"], event["risk"]["score"], event["summary"])
    return len(photos)


if __name__ == "__main__":
    # One photo, timed:     python -m app.detectors.scene photo.jpg [runs]
    # A whole folder:       python -m app.detectors.scene --json-dir photos json_out
    import json
    import statistics
    import sys

    from PIL import Image

    from .items import ItemFinder

    finder = ItemFinder()
    if not finder.available():
        raise SystemExit("Model didn't load; see the warning above.")
    if len(sys.argv) > 1 and sys.argv[1] == "--json-dir":
        if len(sys.argv) < 4:
            raise SystemExit("Usage: python -m app.detectors.scene --json-dir photos json_out")
        n = convert_images(sys.argv[2], sys.argv[3], finder)
        print(f"Wrote {n} JSON files")
        raise SystemExit(0)
    image = Image.open(sys.argv[1]).convert("RGB") if len(sys.argv) > 1 else Image.new("RGB", (640, 480), "gray")
    runs = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    prompts, thresholds, labels = queries()
    finder.detect(image, prompts, thresholds)  # warm-up: the first pass pays for GPU kernel setup
    times = []
    for _ in range(runs):
        hits, timing = finder.detect(image, prompts, thresholds)
        times.append(timing["inference_ms"])
    print(json.dumps(build("test", "test", 0, hits, labels, *image.size, timing, None, False), indent=1))
    print(f"{len(prompts)} words, one pass, {runs} runs on {finder.device_name}: "
          f"median {statistics.median(times):.0f} ms, slowest {max(times):.0f} ms")
