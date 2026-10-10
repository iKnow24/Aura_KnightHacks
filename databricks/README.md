# Lumen on Databricks

**Real events from a running Lumen, no generated data: see [REAL_DATA.md](REAL_DATA.md).**
Everything below uses the generated "maria" household.

Live captions and alerts stay on the Lumen brain (they need sub-second speed). Databricks gets the
history: every alert, tap, caption and sighting, cleaned into tables a caregiver can ask questions of.

```
brain (EVENT_LOG_DIR)  ─┐
                        ├─► Volume /Volumes/lumen/home/raw_events/*.jsonl  
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
7 before, for the same person. With the generated data, the last day reads **50% slower to notice
alerts, 15 missed vs 5 the week before → flagged** (at night: 7 missed vs 2). That decline is planted by the generator; say so.
It's "a change from her normal, worth a call", never a diagnosis.

## 1. Make the data

```bash
python3 databricks/generate_household.py --days 14          # ends yesterday; --end YYYY-MM-DD to pin it
# real events from the brain, same format:
EVENT_LOG_DIR=./event_log LUMEN_HOUSEHOLD=maria ./run.sh
```

The brain writes one file per hour (`2026-10-10_14.jsonl`). Upload only finished hours: Auto Loader
reads each file name once, so a file that keeps growing after upload would lose its new lines.

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

## 4. Genie agent

Follow `genie_setup.md`: instructions, three example queries, one filter, and benchmarks, all
ready to paste.

## 5. Dashboard (one page)

**+ New → Dashboard**, name it "How is Mom doing?". In the **Data** tab add the five datasets in
`dashboard_datasets.sql` (one block each). Then on the canvas:

| Widget | Dataset | Setup |
|---|---|---|
| Counter: "Slower than usual" | status | value `pct_slower`, title it "% slower than last week" |
| Counter: "Missed this week" | status | value `missed_this_week` |
| Text: status line | status | `status` column |
| Line chart | daily | x `day`, y `median_seconds_to_notice` |
| Bar chart | daily | x `day`, y `missed_alerts` and `missed_at_night` |
| Bar chart | by_kind | x `kind`, y `missed_pct` |
| Table | missed | all columns |
| Bar chart | people | x `speaker`, y `lines` |

Shortcut from the workshop: with nothing selected, open **Genie Code** in the dashboard editor and
paste: *"Build a caregiver page: two counters from status, a line of median_seconds_to_notice by
day and bars of missed_alerts by day from daily, a bar of missed_pct by kind, and the missed
table."* Review what it makes.

Then **Settings → Enable Genie → Link existing Genie agent**, paste your agent's URL, and
**Publish**. The caregiver gets charts on top and an "Ask Genie" box on the same page.

## 6. The live demo: "a new week arrives"

1. Before judging: upload only the **first 7 files** (2026-09-26 to 2026-10-02) to the volume, run
   the pipeline, refresh the dashboard. It reads **"Normal for her."**
2. In front of the judge: upload the **other 7 files** to the volume.
3. Pipeline → **Run** (or a Job: **Create → Job**, task 1 = pipeline, task 2 = Dashboard refresh,
   **Run now**). Auto Loader reads only the 7 new files.
4. Refresh the dashboard: it flips to **"Worth a call: slower than her usual"**, about 50% slower,
   15 missed vs 5 (7 vs 2 at night).
5. Ask Genie on the dashboard: *"Is Mom doing okay this week?"*

## Stretch: Ask Lumen calls Genie

Genie has a Conversation API (`POST /api/2.0/genie/spaces/{space_id}/start-conversation`).
Ask Lumen could send history questions ("this week", "this month") there and keep "what did she
just say" local. Check with the Databricks team whether Free Edition allows it before building.
