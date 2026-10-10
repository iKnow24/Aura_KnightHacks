# Real events into Databricks (no generated data)

```
Lumen brain on the AMD box  --writes-->  ~/lumen_events/2026-10-10_19.jsonl (one file per hour)
      |  the box's proxy blocks databricks.com, so your Mac carries the files:
      v
scripts/databricks_sync.py on your Mac  --every 30 s, only new lines-->  /Volumes/lumen/home/raw_events/
      v  starts the pipeline job
Bronze -> Silver (test-button alerts dropped) -> Gold  -->  dashboard + Genie
```

Live alerts still come from the brain in under a second. Databricks is a couple of minutes behind
(30 s sync + pipeline start-up). That's fine: it's the history, not the alarm.

## What real data can and can't say tonight

Real data starts when you turn this on, so it covers hours, not weeks.

- **Can say:** every real alert, how many seconds it took to be tapped, which were missed, which
  sounds happen most, and Genie answers about today ("what did she miss this afternoon?").
- **Can't say:** "50% slower than last week". There is no last week. The app's History tab shows
  "Learning her normal" until there's a week of real alerts, and the dashboard below uses
  last-24-hours numbers only.
- If you want to show the week-over-week check, show the generated "maria" household **next to**
  the real one and call it simulated out loud. Don't mix them.

## Steps (once)

**1. Databricks (browser).** Sign up for Free Edition. In the SQL editor run the three `CREATE`
lines from `README.md` step 2. Create the pipeline from `README.md` step 3 but don't run it yet (it needs at least one file), and
don't upload the sample files.
Then **Settings → Developer → Access tokens → Generate**. Keep the token on your Mac only, never in chat.

**2. A job that runs the pipeline.** Jobs & Pipelines → **Create → Job** → task type **Pipeline** →
pick the Lumen pipeline → Create. The job id is the number in the page's URL (`/jobs/<id>`).

**3. The box.** Restart the brain with these in front (pick any password for the key):

```bash
EVENT_LOG_DIR=$HOME/lumen_events LUMEN_HOUSEHOLD=home LUMEN_SYNC_KEY=pick-a-password ./run.sh
```

**4. Your Mac**, in the repo folder (`git pull` first), in a new Terminal tab while the Jupyter bridge is running:

```bash
export DATABRICKS_HOST=https://YOUR-WORKSPACE.cloud.databricks.com
export DATABRICKS_TOKEN=PASTE-TOKEN-HERE
export DATABRICKS_JOB_ID=PASTE-JOB-ID-HERE
export LUMEN_SYNC_KEY=pick-a-password
python3 scripts/databricks_sync.py
```

It prints a line each time it uploads (`uploaded 2026-10-10_19-000000.jsonl (12 events)`) and
when it starts the job. Leave it running.

**5. Dashboard.** **+ New → Dashboard**, Data tab: add the four blocks in `live_datasets.sql`.
Counters from `live_status` and `freshness`, a table from `live_alerts`, a bar from `live_by_kind`.

**6. Genie.** As in `genie_setup.md`, but replace the Instructions with:

```
This is a real home using Lumen, household = 'home'. The wearer is hard of hearing.
- "Noticed" means the wearer tapped the alert. "Missed" means nobody tapped it within 5 minutes.
- Leave out severity 'info' when judging how they are doing.
- Data only starts today. If asked about trends or "last week", say there isn't a week of data yet.
- Never call anything a diagnosis. Answer in one or two plain sentences.
```

Questions that work on a few hours of real data: *"What alerts happened in the last hour?"*,
*"Which alert took longest to notice?"*, *"Did she miss anything today?"*

## The 60-second demo

1. Trigger a real sound near a phone (doorbell video on a laptop speaker, knock, or say the
   wearer's name). The HUD glows, tap it.
2. Watch the sync print `uploaded ...` and `started the pipeline job`.
3. When the job finishes, refresh the dashboard: the alert is there with its seconds-to-notice.
4. Ask Genie: *"What was the last alert and how fast was it seen?"*

## If something's off

The script prints the reason. The common ones: **403** means the password doesn't match the box's
`LUMEN_SYNC_KEY` (or the brain was started without it); **404** means the volume wasn't created;
**can't reach localhost:5173** means the Jupyter bridge isn't running.

## Delivery checks and recovery

- Keep **one uploader** running for a source. Its checkpoint and pending event batch live in
  `.lumen-sync/state.json` inside your checkout (ignored by Git). The file contains private event
  data, but no API token. Keep it when restarting; do not upload or share it.
- The uploader saves the exact pending bytes before uploading. If a response is lost, it retries
  those same bytes, even if the hourly log has grown. A conflicting remote file is accepted only
  after its contents have been checked. The checkpoint is replaced atomically.
- If a pipeline job is busy, or starting it fails, the next round retries the pending refresh even
  if no new events arrived. A successful start is **not** proof the job finished: check the job's
  result in Databricks, then check the dashboard's ingestion time. Rerun a failed pipeline job
  after fixing its reported error; the uploaded files remain available.
- For a separate source or destination use `--state /path/to/separate-state.json`. Reusing a
  checkpoint for another source/destination is rejected. Keep the bridge URL stable.
- The original PR #22 uploader used `~/.lumen_databricks_sync.json`. If you already ran that
  version, stop and reconcile its offsets before switching; a fresh checkpoint replays the logs.
  Do not delete checkpoints to troubleshoot a timeout. Starting fresh or running parallel
  uploaders can duplicate rows. Source logs must remain append-only.
- `--once` does one upload/processing attempt; connection and upload failures return an error.
  Use the normal continuous mode when a job is busy so the queued refresh is retried.

## No generated fallback

History uses real sources by default. With neither event logging nor Databricks configured, it
shows an empty "Real history not connected" state. A Databricks outage never substitutes sample
rows. An empty local log remains empty. Generated data is available only through the explicit
`LUMEN_HISTORY_SAMPLE=1` demo setting, with no real source configured. Leave that setting off for
this project’s real-data demonstration.

## What these records can measure

An acknowledgment measures **time until somebody tapped**, not detector accuracy. To evaluate
machine learning, keep a separate labeled test sheet with event type, actual occurrence time,
whether Aura detected it, detection time, and whether the alert was correct. Include quiet
periods and similar-sounding non-events. Missed detections cannot be discovered from emitted
alerts alone. Compare models on the same held-out recordings before changing live thresholds;
do not train a new model on a few hours of unverified predictions.
