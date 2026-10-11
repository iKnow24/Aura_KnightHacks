"""Send this home's real Lumen events to Databricks, every 30 seconds. Runs on your Mac.

The AMD box can't reach databricks.com (its proxy blocks it), but your Mac can reach both:

    Lumen brain (writes EVENT_LOG_DIR) --GET /api/eventlog, through the bridge--> this script
        --Databricks Files API--> /Volumes/lumen/home/raw_events/ --Auto Loader--> Bronze/Silver/Gold

Each round it uploads only the lines added since last time, as a new small file
(2026-10-10_14-000123.jsonl = hour 14, starting at byte 123). Auto Loader reads every file name
once, so each event lands in Bronze exactly once, within about a minute instead of after the hour ends.

On the box, start the brain with:   EVENT_LOG_DIR=$HOME/lumen_events LUMEN_HOUSEHOLD=home LUMEN_SYNC_KEY=<any password>
On your Mac, sign in once (a browser opens; there is no token to copy):
    databricks auth login --host https://<your-workspace>.cloud.databricks.com --profile lumen
Then, with the same password the brain was started with:
    export LUMEN_SYNC_KEY=<the same password>
    python3 scripts/databricks_sync.py
The script uses that saved login (WorkspaceClient profile "lumen"). It uploads to
/Volumes/lumen/home/raw_events/ and starts job 1103380381835252 after each upload.
Set DATABRICKS_JOB_ID only if the job was recreated and the id changed.

LUMEN_URL defaults to http://localhost:5173 (the Jupyter bridge, or a laptop brain).
Progress is kept in ~/.lumen_databricks_sync.json, so stopping and restarting never uploads twice.
"""
import argparse
import io
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

try:
    import truststore  # same certificates Safari trusts (python.org's Python ships with none)

    SSL = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
except ImportError:
    SSL = ssl.create_default_context()

STATE = Path.home() / ".lumen_databricks_sync.json"
PROFILE = "lumen"
# Jobs & Pipelines side panel. Override with DATABRICKS_JOB_ID if the job is recreated.
DEFAULT_JOB_ID = "1103380381835252"


def call(url, method="GET", data=None, headers=None):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    # Plain http (the local bridge) needs no TLS context; Databricks does.
    ctx = SSL if url.startswith("https") else None
    with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
        return r.read()


class Databricks:
    """Signed-in Databricks user. The lumen profile lives in ~/.databrickscfg; no token is read."""

    def __init__(self, profile=PROFILE):
        from databricks.sdk import WorkspaceClient

        self.profile = profile
        self.w = WorkspaceClient(profile=profile)
        self.host = (self.w.config.host or "").rstrip("/")

    def upload(self, volume_path, data: bytes):
        # overwrite=False: Auto Loader reads each file name once, so a name is never reused.
        self.w.files.upload(volume_path, io.BytesIO(data), overwrite=False)

    def run_job(self, job_id):
        """Start the pipeline job unless it's already running (a running one picks the files up next time)."""
        active = list(self.w.jobs.list_runs(job_id=int(job_id), active_only=True, limit=1))
        if active:
            return False
        # run_now returns a waiter. Don't wait: the next 30 s round only needs the run to exist.
        self.w.jobs.run_now(job_id=int(job_id))
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
        except Exception as e:
            # 409 = already there from a run that crashed before saving progress
            code = getattr(e, "status_code", None) or getattr(e, "code", None)
            if code != 409 and "already exists" not in str(e).lower():
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

    if not os.environ.get("LUMEN_SYNC_KEY"):
        sys.exit("Set LUMEN_SYNC_KEY to the same password the brain was started with (see the top of this file).")
    lumen = os.environ.get("LUMEN_URL", "http://localhost:5173").rstrip("/")
    db = Databricks()
    job = os.environ.get("DATABRICKS_JOB_ID") or DEFAULT_JOB_ID
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    print(f"Syncing {lumen} -> {db.host}{args.volume} as profile {db.profile}, then job {job}")

    while True:
        try:
            if sync_once(lumen, os.environ["LUMEN_SYNC_KEY"], db, args.volume, state):
                if db.run_job(job):
                    print(f"{time.strftime('%H:%M:%S')}  started the pipeline job")
        except urllib.error.HTTPError as e:
            hint = {403: "LUMEN_SYNC_KEY doesn't match the brain's, or the brain wasn't started with "
                    "EVENT_LOG_DIR and LUMEN_SYNC_KEY",
                    404: "the volume doesn't exist yet: run the CREATE VOLUME line in databricks/README.md"}.get(e.code, "")
            print(f"{time.strftime('%H:%M:%S')}  {e.code} from {e.url.split('?')[0]}  {hint}")
        except (urllib.error.URLError, OSError) as e:
            print(f"{time.strftime('%H:%M:%S')}  can't reach {lumen} or Databricks ({e}); is the bridge running?")
        except Exception as e:
            code = getattr(e, "status_code", None)
            hint = {401: "the lumen login expired. Run databricks auth login again (step 2).",
                    403: "this account can't write the volume or run the job. It needs the GRANTs and Can manage run.",
                    404: "the volume or job wasn't found"}.get(code, "")
            print(f"{time.strftime('%H:%M:%S')}  {type(e).__name__}: {e}  {hint}")
        if args.once:
            return
        time.sleep(args.every)


if __name__ == "__main__":
    main()
