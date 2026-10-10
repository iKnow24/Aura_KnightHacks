"""Send this home's real Lumen events to Databricks, every 30 seconds. Runs on your Mac.

The AMD box can't reach databricks.com (its proxy blocks it), but your Mac can reach both:

    Lumen brain (writes EVENT_LOG_DIR) --GET /api/eventlog, through the bridge--> this script
        --Databricks Files API--> /Volumes/lumen/home/raw_events/ --Auto Loader--> Bronze/Silver/Gold

Each round it uploads only the lines added since last time, as a new small file
(2026-10-10_14-000123.jsonl = hour 14, starting at byte 123). Auto Loader reads every file name
once, so each event lands in Bronze exactly once, within about a minute instead of after the hour ends.

On the box, start the brain with:   EVENT_LOG_DIR=$HOME/lumen_events LUMEN_HOUSEHOLD=home LUMEN_SYNC_KEY=<any password>
On your Mac (same password):
    export DATABRICKS_HOST=https://<your-workspace>.cloud.databricks.com
    export DATABRICKS_TOKEN=<Settings > Developer > Access tokens>   (never paste it in chat)
    export LUMEN_SYNC_KEY=<the same password>
    export DATABRICKS_JOB_ID=<optional: the job that runs the pipeline; we start it after each upload>
    python3 scripts/databricks_sync.py

LUMEN_URL defaults to http://localhost:5173 (the Jupyter bridge, or a laptop brain).
Progress and an immutable pending batch are kept in .lumen-sync/state.json.
Keep this file when restarting; do not run multiple uploaders against the same state file.
"""
import argparse
import base64
import hashlib
import tempfile
import uuid
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

try:
    import truststore  # same certificates Safari trusts (python.org's Python ships with none)

    SSL = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
except ImportError:
    SSL = ssl.create_default_context()

STATE = Path(__file__).resolve().parents[1] / ".lumen-sync" / "state.json"


def call(url, method="GET", data=None, headers=None):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    # Plain http (the local bridge) needs no TLS context; Databricks does.
    ctx = SSL if url.startswith("https") else None
    with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
        return r.read()


class Databricks:
    def __init__(self, host, token):
        self.host = host.rstrip("/") if host.startswith("http") else "https://" + host.rstrip("/")
        self.auth = {"Authorization": f"Bearer {token}"}

    def upload(self, volume_path, data: bytes):
        url = f"{self.host}/api/2.0/fs/files{urllib.parse.quote(volume_path)}?overwrite=false"
        call(url, "PUT", data, {**self.auth, "Content-Type": "application/octet-stream"})

    def download(self, volume_path):
        return call(f"{self.host}/api/2.0/fs/files{urllib.parse.quote(volume_path)}", headers=self.auth)

    def run_job(self, job_id):
        """Start the pipeline job unless it's already running (a running one picks the files up next time)."""
        q = urllib.parse.urlencode({"job_id": job_id, "active_only": "true"})
        active = json.loads(call(f"{self.host}/api/2.1/jobs/runs/list?{q}", headers=self.auth)).get("runs")
        if active:
            return False
        call(f"{self.host}/api/2.1/jobs/run-now", "POST", json.dumps({"job_id": int(job_id)}).encode(),
             {**self.auth, "Content-Type": "application/json"})
        return True


def save_state(state):
    """Replace the checkpoint atomically; a failed write never leaves half a JSON file."""
    STATE.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=STATE.parent, prefix=".checkpoint-")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(state, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, STATE)
    finally:
        Path(name).unlink(missing_ok=True)


def prepare_state(state, lumen, db, volume):
    scope = {"lumen": lumen, "host": db.host, "volume": volume}
    if state and state.get("version") != 2:
        raise ValueError("Old checkpoint format. Keep it and use --state with a new path for a reviewed replay.")
    if state and state["scope"] != scope:
        raise ValueError("Checkpoint belongs to another source or destination. Use a separate --state path.")
    if not state:
        state.update(version=2, scope=scope, stream_id=uuid.uuid4().hex,
                     offsets={}, pending=None, pipeline_due=False)
        save_state(state)


def upload_pending(db, state):
    pending = state.get("pending")
    if not pending:
        return 0
    chunk = base64.b64decode(pending["data"])
    try:
        db.upload(pending["path"], chunk)
    except urllib.error.HTTPError as e:
        # Never assume a conflict means our data arrived: verify the remote bytes.
        if e.code != 409:
            raise
        if db.download(pending["path"]) != chunk:
            raise ValueError("Remote batch differs from the saved batch; checkpoint was not advanced.") from e
    next_state = {**state, "offsets": {**state["offsets"], pending["name"]: pending["end"]},
                  "pending": None, "pipeline_due": True}
    save_state(next_state)
    state.clear()
    state.update(next_state)
    print(f"{time.strftime('%H:%M:%S')}  uploaded {Path(pending['path']).name} ({chunk.count(bytes([10]))} events)")
    return len(chunk)


def sync_once(lumen, key, db, volume, state):
    """Retry the exact saved bytes before reading any newly appended log lines."""
    prepare_state(state, lumen, db, volume)
    sent = upload_pending(db, state)
    hdr = {"X-Lumen-Sync-Key": key}
    files = json.loads(call(f"{lumen}/api/eventlog", headers=hdr))["files"]
    for f in files:
        name, size = f["name"], f["size"]
        offset = state["offsets"].get(name, 0)
        if size < offset:
            raise ValueError("Source log was truncated. Keep the checkpoint and review before replaying.")
        if size == offset:
            continue
        chunk = call(f"{lumen}/api/eventlog/{name}?offset={offset}", headers=hdr)
        if not chunk:
            continue
        digest = hashlib.sha256(chunk).hexdigest()[:16]
        piece = f"{state['stream_id']}-{name[:-6]}-{offset:06d}-{digest}.jsonl"
        next_state = {**state, "pending": {"name": name, "end": offset + len(chunk),
                      "path": f"{volume}/{piece}", "data": base64.b64encode(chunk).decode()}}
        # Save BEFORE upload, so a timeout/restart cannot change this batch's boundaries.
        save_state(next_state)
        state.clear()
        state.update(next_state)
        sent += upload_pending(db, state)
    return sent


def start_pending_job(db, job, state):
    """A busy warehouse or failed request must not forget the outstanding refresh."""
    if not job or not state.get("pipeline_due"):
        return False
    if not db.run_job(job):
        return False
    next_state = {**state, "pipeline_due": False}
    save_state(next_state)
    state.clear()
    state.update(next_state)
    print(f"{time.strftime('%H:%M:%S')}  started the pipeline job")
    return True


def main():
    global STATE
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--once", action="store_true", help="upload what's new and stop")
    p.add_argument("--every", type=int, default=30, help="seconds between rounds (default 30)")
    p.add_argument("--volume", default="/Volumes/lumen/home/raw_events")
    p.add_argument("--state", type=Path, default=STATE, help="checkpoint path; keep it across restarts")
    args = p.parse_args()
    STATE = args.state
    if args.every < 1:
        p.error("--every must be at least 1 second")

    missing = [k for k in ("DATABRICKS_HOST", "DATABRICKS_TOKEN", "LUMEN_SYNC_KEY") if not os.environ.get(k)]
    if missing:
        sys.exit("Set these first (see the top of this file): " + ", ".join(missing))
    lumen = os.environ.get("LUMEN_URL", "http://localhost:5173").rstrip("/")
    db = Databricks(os.environ["DATABRICKS_HOST"], os.environ["DATABRICKS_TOKEN"])
    job = os.environ.get("DATABRICKS_JOB_ID")
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    print(f"Syncing {lumen} -> {db.host}{args.volume}" + (f", then job {job}" if job else ""))

    while True:
        try:
            sync_once(lumen, os.environ["LUMEN_SYNC_KEY"], db, args.volume, state)
            start_pending_job(db, job, state)
        except ValueError as e:
            sys.exit(str(e))
        except urllib.error.HTTPError as e:
            if args.once:
                sys.exit(f"Sync failed: HTTP {e.code}; checkpoint retained.")
            hint = {401: "Databricks token is wrong or expired", 403: "LUMEN_SYNC_KEY doesn't match the brain's, "
                    "or the brain wasn't started with EVENT_LOG_DIR and LUMEN_SYNC_KEY (or the token can't write the volume)",
                    404: "the volume doesn't exist yet: run the CREATE VOLUME line in databricks/README.md"}.get(e.code, "")
            print(f"{time.strftime('%H:%M:%S')}  {e.code} from {e.url.split('?')[0]}  {hint}")
        except (urllib.error.URLError, OSError) as e:
            if args.once:
                sys.exit("Sync failed: connection or disk error; checkpoint retained.")
            print(f"{time.strftime('%H:%M:%S')}  can't reach {lumen} or Databricks ({e}); is the bridge running?")
        if args.once:
            if job and state.get("pipeline_due"):
                print("Upload saved; pipeline is busy. Rerun sync to start the pending refresh.")
            return
        time.sleep(args.every)


if __name__ == "__main__":
    main()
