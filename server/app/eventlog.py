"""Optional: write every event to daily JSON-lines files so Databricks can pick them up.

Off by default, so the house still forgets on restart. Turn it on with
EVENT_LOG_DIR=/path/to/folder and the brain appends to <folder>/<YYYY-MM-DD>_<HH>.jsonl, one file per hour:

  {"type": "alert", "id": "...", "kind": "doorbell", "zone": "hallway", "severity": "warning", ...}
  {"type": "ack", "id": "<alert id>", "by": "wearer", "ts": ...}
  {"type": "speech", "zone": "kitchen", "text": "...", "ts": ...}
  {"type": "caption_meta", "ts": <speech ts>, "speaker": 1, "to_you": true}
  {"type": "sighting", "item": "keys", "zone": "living", "confidence": 0.4, "ts": ...}
  {"type": "mode", "mode": "night", "ts": ...}

Every line also carries "household" (LUMEN_HOUSEHOLD, default "demo"). Image thumbnails are dropped.
Those files are the Bronze input in databricks/ (same shape as the generated history).
Why hourly: Auto Loader reads each file name once. If we kept appending to one file per day and
uploaded it twice, the second upload's new lines would be skipped. A finished hour never changes,
so upload finished hours and each one is read exactly once.
"""
import json
import os
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
