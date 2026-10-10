# Lumen on Databricks

Live captions and alerts stay on the Lumen brain (they need sub-second speed). Databricks gets the
history: every alert, tap, caption and sighting, cleaned into tables a caregiver can ask questions of.

```
brain (EVENT_LOG_DIR)  ─┐
                        ├─► Volume /Volumes/lumen/home/raw_events/<day>.jsonl
generate_household.py  ─┘            │  Auto Loader
                                     ▼
                         BRONZE  bronze_events (raw lines)
                                     ▼  expectations drop bad rows
                         SILVER  silver_alerts, silver_acks, silver_speech, silver_speakers, silver_sightings
                                     ▼
                         GOLD    gold_alert_response, gold_daily, gold_change_from_normal,
                                 gold_who_talks, gold_item_last_seen
                                     ▼
                         Genie space  +  AI/BI dashboard
```

The headline table is `gold_change_from_normal`: for each day it compares the last 7 days with the
7 before, for the same person. With the generated data, the last day reads **51% slower to notice
alerts, 8 missed vs 2 the week before → flagged**. That decline is planted by the generator; say so.
It's "a change from her normal, worth a call", never a diagnosis.

## 1. Make the data

```bash
python3 databricks/generate_household.py --days 14          # ends yesterday; --end YYYY-MM-DD to pin it
# real events from the brain, same format:
EVENT_LOG_DIR=./event_log LUMEN_HOUSEHOLD=maria ./run.sh
```

`databricks/sample_data/` already holds 14 days ending 2026-10-09.

## Quickest start: one SQL file

`fake_timeline.sql` is the same two weeks as one readable table (`lumen.home.home_timeline`: when, who,
what, where). Paste it into the SQL editor and run it, no upload or pipeline needed. Rebuild it with
`python3 databricks/make_timeline_sql.py > databricks/fake_timeline.sql`.

## 2. Set up Free Edition (SQL editor)

```sql
CREATE CATALOG IF NOT EXISTS lumen;
CREATE SCHEMA IF NOT EXISTS lumen.home;
CREATE VOLUME IF NOT EXISTS lumen.home.raw_events;
```

Catalog → lumen → home → raw_events → **Upload to this volume**. For the workshop-style demo, upload
the first 13 days, run the pipeline, then upload the last day and run again: only the new file is read.

## 3. Create the pipeline

**+ New → ETL pipeline**. Default catalog `lumen`, schema `home`. Add the file
`pipeline/lumen_pipeline.sql` (paste it in, or import this repo as a Git folder). Under
**Settings → Configuration** add `spark.sql.session.timeZone` = `America/New_York`. Run it.

## 4. Genie space

**+ New → Genie space**, add all `gold_*` tables plus `silver_speech`. Paste into **Instructions**:

```
This is one hearing-impaired person's home, watched by Lumen. household = the person.
"Noticed" means she tapped the alert. missed = not tapped within 5 minutes.
Night is 10 PM to 7 AM. Ignore severity 'info' (kettle, timer) when judging how she is doing.
For "is she doing worse" questions, use gold_change_from_normal for the latest day.
Never call anything a diagnosis; say "a change from her usual".
```

Sample questions (also add them as **benchmarks**):
- Is Mom slower to notice things this week than last week?
- How many alerts did she miss at night this week?
- Which kind of alert does she miss most?
- Who talked to her most yesterday?
- Where were her keys last seen?

## 5. Dashboard (one page)

- Line: `gold_daily.median_seconds_to_notice` by `day`
- Bars: `gold_daily.missed_alerts` and `missed_at_night` by `day`
- Counter: latest `gold_change_from_normal.pct_slower`, red when `flagged`
- Table: `gold_alert_response` where `missed`, newest first

## Stretch: Ask Lumen calls Genie

Genie has a Conversation API (`POST /api/2.0/genie/spaces/{space_id}/start-conversation`).
Ask Lumen could send history questions ("this week", "this month") there and keep "what did she
just say" local. Check with the Databricks team whether Free Edition allows it before building.
