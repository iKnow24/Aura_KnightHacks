-- Near-real-time view: reads the uploaded event files directly, so it skips the pipeline.
-- An alert shows up here as soon as databricks_sync.py uploads it (about 5 seconds), instead of
-- after the pipeline job runs. The Bronze/Silver/Gold tables stay the source for history and trends.
-- Run once in the SQL editor, then add lumen.home.live_alerts_now to the Genie space.
-- It re-reads every file on each query: fine for a demo day of files, slow after weeks of them.

CREATE OR REPLACE VIEW lumen.home.live_alerts_now
COMMENT 'Real alerts from this home, seconds old. status: seen (tapped within 5 minutes), waiting (under 5 minutes old, not tapped yet), missed.'
AS
WITH raw AS (
  SELECT * FROM read_files(
    '/Volumes/lumen/home/raw_events/',
    format => 'json',
    schemaHints => 'ts DOUBLE, id STRING, type STRING, kind STRING, zone STRING, severity STRING, source STRING, household STRING'
  )
),
alerts AS (
  SELECT household, id AS alert_id, kind, zone, severity, ts AS alert_ts
  FROM raw
  WHERE type = 'alert' AND coalesce(source, '') <> 'fake'  -- test buttons never count, same as silver_alerts
),
acks AS (
  SELECT id AS alert_id, min(ts) AS ack_ts FROM raw WHERE type = 'ack' GROUP BY id
)
SELECT
  a.household, a.alert_id, a.kind, a.zone, a.severity,
  timestamp_seconds(a.alert_ts) AS alert_time,
  round(k.ack_ts - a.alert_ts, 1) AS seconds_to_notice,
  CASE
    WHEN k.ack_ts IS NOT NULL AND k.ack_ts - a.alert_ts <= 300 THEN 'seen'
    WHEN unix_timestamp(current_timestamp()) - a.alert_ts < 300 THEN 'waiting'
    ELSE 'missed'
  END AS status
FROM alerts a LEFT JOIN acks k USING (alert_id);
