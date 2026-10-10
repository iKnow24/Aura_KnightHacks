"""Item memory: find everyday things (keys, wallet, glasses...) in a node's still photo.

Standard detectors (COCO, MediaPipe) have no "keys" or "wallet" class, so this uses OWLv2,
an open-vocabulary detector: you describe the object in words and it finds it. It runs on the
AMD GPU; on a CPU it takes a few seconds per photo, which is fine at one photo every few seconds.

Only a small crop around each found item is kept (as the evidence photo). The full frame is
dropped right after detection.

One pass per photo: the image goes through OWLv2 once and every text query (items plus the
scene words in scene.py) is scored against it. Hugging Face's zero-shot pipeline runs the whole
model again for each word, so 6 items cost 6 full passes; 25 words would cost 25.
"""
import base64
import io
import logging
import os
import time

import numpy as np

log = logging.getLogger(__name__)

MODEL_ID = os.environ.get("ITEMS_MODEL", "google/owlv2-base-patch16-ensemble")

# item name (matches agent.ITEM_WORDS) -> (text prompt, minimum score). OWLv2 scores run low;
# tune these on the real phones with `python -m app.detectors.items photo.jpg`.
ITEMS = {
    "keys": ("a photo of a set of keys", 0.20),
    "wallet": ("a photo of a wallet", 0.25),
    "glasses": ("a photo of eyeglasses", 0.25),
    "phone": ("a photo of a cell phone", 0.30),
    "remote": ("a photo of a tv remote control", 0.25),
    "headphones": ("a photo of headphones", 0.25),
}


def crop_thumb(image, box: dict, size: int = 160) -> str:
    """Square-ish crop around the box with some context, as a data: URL."""
    w, h = image.size
    x0, y0, x1, y1 = box["xmin"], box["ymin"], box["xmax"], box["ymax"]
    pad = max(x1 - x0, y1 - y0)
    crop = image.crop((max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + pad), min(h, y1 + pad)))
    crop.thumbnail((size, size))
    out = io.BytesIO()
    crop.convert("RGB").save(out, format="JPEG", quality=70)
    return "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode()


def decode(jpeg_data_url: str):
    from PIL import Image

    raw = base64.b64decode(jpeg_data_url.split(",", 1)[-1])
    return Image.open(io.BytesIO(raw)).convert("RGB")


def boxes_from_outputs(logits, pred_boxes, width: int, height: int, thresholds: list[float],
                       max_per_query: int = 5, overlap: float = 0.3) -> list[dict]:
    """OWLv2 raw outputs for one image -> [{"query": index, "score", "box": {xmin, ymin, xmax, ymax}}].

    logits: (boxes, queries) before sigmoid. pred_boxes: (boxes, 4) as centre x, centre y, width,
    height from 0 to 1 of the padded square photo (OWLv2 pads the bottom/right to a square).
    Each box counts for its best query only; overlapping boxes of the same query collapse to one.
    """
    scores = 1 / (1 + np.exp(-np.asarray(logits, dtype=np.float32)))
    best_q, best = scores.argmax(1), scores.max(1)
    side = max(width, height)
    cx, cy, bw, bh = (np.asarray(pred_boxes, dtype=np.float32) * side).T
    corners = np.stack([np.clip(cx - bw / 2, 0, width), np.clip(cy - bh / 2, 0, height),
                        np.clip(cx + bw / 2, 0, width), np.clip(cy + bh / 2, 0, height)], 1)
    out = []
    for q, threshold in enumerate(thresholds):
        kept: list[np.ndarray] = []
        real = (corners[:, 2] - corners[:, 0] >= 2) & (corners[:, 3] - corners[:, 1] >= 2)  # no zero-size boxes
        idx = np.flatnonzero((best_q == q) & (best >= threshold) & real)
        for i in idx[np.argsort(-best[idx])]:
            if len(kept) == max_per_query:
                break
            if all(iou(corners[i], k) < overlap for k in kept):
                kept.append(corners[i])
                x0, y0, x1, y1 = (int(round(float(v))) for v in corners[i])
                out.append({"query": q, "score": float(best[i]), "box": {"xmin": x0, "ymin": y0, "xmax": x1, "ymax": y1}})
    return out


def iou(a, b) -> float:
    w = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    h = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = w * h
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return float(inter / union) if union > 0 else 0.0


class ItemFinder:
    def __init__(self):
        self._model = None
        self._processor = None
        self._failed = False
        self.device = "cpu"
        self.device_name = "CPU"

    def available(self) -> bool:
        return self._load() is not None

    def _load(self):
        if self._model is None and not self._failed:
            try:
                import torch
                from transformers import Owlv2ForObjectDetection, Owlv2Processor

                self.device = "cuda" if torch.cuda.is_available() else "cpu"  # ROCm shows up as cuda
                self.device_name = torch.cuda.get_device_name(0) if self.device == "cuda" else "CPU"
                self._processor = Owlv2Processor.from_pretrained(MODEL_ID)
                self._model = Owlv2ForObjectDetection.from_pretrained(MODEL_ID).to(self.device).eval()
                log.info("OWLv2 loaded on %s", self.device_name)
            except Exception as e:
                self._failed = True
                log.warning("Item finder off (%s). 'Where are my keys' will only know seeded memory.", e)
        return self._model

    def detect(self, image, queries: list[str], thresholds: list[float]) -> tuple[list[dict], dict]:
        """Every query in one pass. Returns (hits, timing) where timing is
        {"inference_ms": model only, "total_ms": with resizing and box maths, "device": GPU name}."""
        model = self._load()
        if model is None:
            return [], {}
        import torch

        start = time.perf_counter()
        inputs = self._processor(text=[queries], images=image, return_tensors="pt").to(self.device)
        t0 = time.perf_counter()
        with torch.no_grad():
            outputs = model(**inputs)
        logits, boxes = outputs.logits[0].float().cpu().numpy(), outputs.pred_boxes[0].float().cpu().numpy()
        inference_ms = (time.perf_counter() - t0) * 1000  # .cpu() waits for the GPU, so this is honest
        hits = boxes_from_outputs(logits, boxes, image.width, image.height, thresholds)
        for h in hits:
            h["label"] = queries[h.pop("query")]
        return hits, {"inference_ms": round(inference_ms, 1), "total_ms": round((time.perf_counter() - start) * 1000, 1),
                      "device": self.device_name}

    def find(self, image) -> list[dict]:
        """Best hit per item above its threshold: [{"item", "confidence", "thumb"}]."""
        hits, _ = self.detect(image, [p for p, _ in ITEMS.values()], [t for _, t in ITEMS.values()])
        return items_from_hits(image, hits)


def items_from_hits(image, hits: list[dict]) -> list[dict]:
    """Keep the item hits (best one per item) and crop their evidence photos; ignore scene words."""
    names = {p: name for name, (p, _) in ITEMS.items()}
    best: dict[str, dict] = {}
    for h in hits:
        name = names.get(h["label"])
        if name and h["score"] > best.get(name, {}).get("score", 0):
            best[name] = h
    return [{"item": n, "confidence": round(float(h["score"]), 3), "thumb": crop_thumb(image, h["box"])}
            for n, h in best.items()]


if __name__ == "__main__":
    import sys

    from PIL import Image

    finder = ItemFinder()
    if not finder.available():
        raise SystemExit("Model didn't load; see the warning above.")
    for path in sys.argv[1:]:
        hits = finder.find(Image.open(path).convert("RGB"))
        print(path, [(h["item"], h["confidence"]) for h in hits] or "nothing found")
