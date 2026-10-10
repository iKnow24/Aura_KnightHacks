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
Progress is kept in ~/.lumen_databricks_sync.json, so stopping and restarting never uploads twice.
"""
import argparse
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

STATE = Path.home() / ".lumen_databricks_sync.json"


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

    def run_job(self, job_id):
        """Start the pipeline job unless it's already running (a running one picks the files up next time)."""
        q = urllib.parse.urlencode({"job_id": job_id, "active_only": "true"})
        active = json.loads(call(f"{self.host}/api/2.1/jobs/runs/list?{q}", headers=self.auth)).get("runs")
        if active:
            return False
        call(f"{self.host}/api/2.1/jobs/run-now", "POST", json.dumps({"job_id": int(job_id)}).encode(),
             {**self.auth, "Content-Type": "application/json"})
        return True


def sync_once(lumen, key, db, volume, state):
    """Upload every new line. Returns how many bytes went up."""
    hdr = {"X-Lumen-Sync-Key": key}
    files = json.loads(call(f"{lumen}/api/eventlog", headers=hdr))["files"]
    sent = 0
    for f in files:
        name, size = f["name"], f["size"]
        offset = state.get(name, 0)
        if size <= offset:
            continue
        chunk = call(f"{lumen}/api/eventlog/{name}?offset={offset}", headers=hdr)
        if not chunk:
            continue  # only a half-written line so far
        piece = f"{name[:-len('.jsonl')]}-{offset:06d}.jsonl"
        try:
            db.upload(f"{volume}/{piece}", chunk)
        except urllib.error.HTTPError as e:
            if e.code != 409:  # 409 = already there from a run that crashed before saving progress
                raise
        state[name] = offset + len(chunk)
        STATE.write_text(json.dumps(state))
        sent += len(chunk)
        events = chunk.count(b"\n")
        print(f"{time.strftime('%H:%M:%S')}  uploaded {piece} ({events} events)")
    return sent


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--once", action="store_true", help="upload what's new and stop")
    p.add_argument("--every", type=int, default=30, help="seconds between rounds (default 30)")
    p.add_argument("--volume", default="/Volumes/lumen/home/raw_events")
    args = p.parse_args()

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
            if sync_once(lumen, os.environ["LUMEN_SYNC_KEY"], db, args.volume, state) and job:
                if db.run_job(job):
                    print(f"{time.strftime('%H:%M:%S')}  started the pipeline job")
        except urllib.error.HTTPError as e:
            hint = {401: "Databricks token is wrong or expired", 403: "LUMEN_SYNC_KEY doesn't match the brain's, "
                    "or the brain wasn't started with EVENT_LOG_DIR and LUMEN_SYNC_KEY (or the token can't write the volume)",
                    404: "the volume doesn't exist yet: run the CREATE VOLUME line in databricks/README.md"}.get(e.code, "")
            print(f"{time.strftime('%H:%M:%S')}  {e.code} from {e.url.split('?')[0]}  {hint}")
        except (urllib.error.URLError, OSError) as e:
            print(f"{time.strftime('%H:%M:%S')}  can't reach {lumen} or Databricks ({e}); is the bridge running?")
        if args.once:
            return
        time.sleep(args.every)


if __name__ == "__main__":
    main()
