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
