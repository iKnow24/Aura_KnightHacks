"""Optional: write every event to daily JSON-lines files so Databricks can pick them up.

Off by default, so the house still forgets on restart. Turn it on with
EVENT_LOG_DIR=/path/to/folder and the brain appends to <folder>/<YYYY-MM-DD>_<HH>.jsonl, one file per hour:

  {"type": "alert", "id": "...", "kind": "doorbell", "zone": "hallway", "severity": "warning", ...}
  {"type": "ack", "id": "<alert id>", "by": "wearer", "ts": ...}
  {"type": "speech", "zone": "kitchen", "text": "...", "ts": ...}
  {"type": "caption_meta", "ts": <speech ts>, "speaker": 1, "to_you": true}
  {"type": "sighting", "item": "keys", "zone": "living", "confidence": 0.4, "ts": ...}
  {"type": "mode", "mode": "night", "ts": ...}
  {"type": "vision", "zone": "kitchen", "people": 1, "posture": "standing", "objects": [...], "inference_ms": 92.4, ...}

Every line also carries "household" (LUMEN_HOUSEHOLD, default "demo"). Image thumbnails are dropped.
Those files are the Bronze input in databricks/ (same shape as the generated history).
Why hourly: Auto Loader reads each file name once. If we kept appending to one file per day and
uploaded it twice, the second upload's new lines would be skipped. A finished hour never changes,
so upload finished hours and each one is read exactly once.
"""
import hmac
import json
import os
import re
import time
from datetime import datetime
from pathlib import Path

DROP = {"thumb", "routed", "acked"}


def record(event: dict, log_dir: str | None = None):
    log_dir = log_dir or os.environ.get("EVENT_LOG_DIR")
    if not log_dir:
        return
    line = {k: v for k, v in event.items() if k not in DROP}
    line.setdefault("ts", time.time())
    line.setdefault("household", os.environ.get("LUMEN_HOUSEHOLD", "demo"))
    path = Path(log_dir) / f"{datetime.fromtimestamp(line['ts']).strftime('%Y-%m-%d_%H')}.jsonl"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a") as f:
            f.write(json.dumps(line) + "\n")
    except OSError as e:  # a full disk must never stop an alert
        print("event log error:", e)


# ---------------------------------------------------------------- reading the log back out
# scripts/databricks_sync.py on a laptop pulls new lines through GET /api/eventlog and uploads them to
# Databricks (the AMD box's proxy blocks databricks.com, so the box can't upload itself).
# The log holds what people said, and the tunnel URL is public, so this is off unless
# LUMEN_SYNC_KEY is set on the brain and the caller sends the same key.
NAME = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{2}\.jsonl$")


def sync_allowed(key: str | None) -> bool:
    expected = os.environ.get("LUMEN_SYNC_KEY")
    return bool(expected and os.environ.get("EVENT_LOG_DIR") and key and hmac.compare_digest(key, expected))


def list_files() -> list[dict]:
    folder = Path(os.environ["EVENT_LOG_DIR"])
    if not folder.is_dir():
        return []
    return [{"name": f.name, "size": f.stat().st_size} for f in sorted(folder.iterdir()) if NAME.match(f.name)]


def read_from(name: str, offset: int) -> bytes:
    """Bytes of one hourly file from offset, cut at the last full line (a line may be half-written)."""
    if not NAME.match(name):
        raise ValueError("bad file name")
    with (Path(os.environ["EVENT_LOG_DIR"]) / name).open("rb") as f:
        f.seek(max(offset, 0))
        data = f.read()
    return data[: data.rfind(b"\n") + 1]
