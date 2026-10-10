"""Item memory: find everyday things (keys, wallet, glasses...) in a node's still photo.

Standard detectors (COCO, MediaPipe) have no "keys" or "wallet" class, so this uses OWLv2,
an open-vocabulary detector: you describe the object in words and it finds it. It runs on the
AMD GPU; on a CPU it takes a few seconds per photo, which is fine at one photo every few seconds.

Only a small crop around each found item is kept (as the evidence photo). The full frame is
dropped right after detection.
"""
import base64
import io
import logging
import os

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


class ItemFinder:
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

                device = 0 if torch.cuda.is_available() else -1
                self._pipe = pipeline("zero-shot-object-detection", model=MODEL_ID, device=device)
                log.info("OWLv2 loaded on %s", "GPU" if device == 0 else "CPU")
            except Exception as e:
                self._failed = True
                log.warning("Item finder off (%s). 'Where are my keys' will only know seeded memory.", e)
        return self._pipe

    def find(self, image) -> list[dict]:
        """Best hit per item above its threshold: [{"item", "confidence", "thumb"}]."""
        pipe = self._load()
        if pipe is None:
            return []
        prompts = {p: name for name, (p, _) in ITEMS.items()}
        best: dict[str, dict] = {}
        for hit in pipe(image, candidate_labels=list(prompts)):
            name = prompts[hit["label"]]
            if hit["score"] >= ITEMS[name][1] and hit["score"] > best.get(name, {}).get("score", 0):
                best[name] = hit
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
