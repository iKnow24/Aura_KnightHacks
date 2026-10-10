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
    return {"type": "vision", "node_id": node_id, "zone": zone, "ts": ts, "source": "owlv2",
            "people": people, "posture": pose_posture, "objects": objects, "counts": counts,
            "summary": summary(counts, people, pose_posture), "model": MODEL_ID.split("/")[-1], **timing}


def from_phone(node_id: str, zone: str, ts: float, objects: list) -> dict:
    """The rear/outside phone already detects objects itself (EfficientDet in the browser) and sends
    [{kind, bearing, dist}]. Same JSON shape, no photo ever reaches the brain."""
    objs = [{"label": str(o.get("kind")), "bearing": o.get("bearing"), "dist": o.get("dist")}
            for o in objects[:20] if isinstance(o, dict) and o.get("kind")]
    counts: dict[str, int] = {}
    for o in objs:
        counts[o["label"]] = counts.get(o["label"], 0) + 1
    people = counts.get("person", 0)
    return {"type": "vision", "node_id": node_id, "zone": zone, "ts": ts, "source": "phone",
            "people": people, "posture": None, "objects": objs, "counts": counts,
            "summary": summary(counts, people, None), "model": "efficientdet-lite0 (on phone)"}


def summary(counts: dict[str, int], people: int, pose_posture: str | None) -> str:
    parts = []
    if people:
        parts.append(f"{people} {'person' if people == 1 else 'people'}" + (f" ({pose_posture})" if pose_posture else ""))
    parts += [f"{n} {label}s" if n > 1 else label for label, n in counts.items() if label != "person"]
    return ", ".join(parts) or "nothing recognised"


if __name__ == "__main__":
    # Speed test + sample JSON on the AMD box: python -m app.detectors.scene [photo.jpg] [runs]
    import json
    import statistics
    import sys

    from PIL import Image

    from .items import ItemFinder

    finder = ItemFinder()
    if not finder.available():
        raise SystemExit("Model didn't load; see the warning above.")
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
