-- Lumen caregiver pipeline (Lakeflow Spark Declarative Pipeline, SQL).
-- Raw daily event files -> Bronze -> Silver -> Gold, same pattern as the earthquake workshop.
-- Pipeline settings: default catalog `lumen`, schema `home`, and configuration
--   spark.sql.session.timeZone = America/New_York   (so "night" means night in Orlando)

-- ============================== BRONZE ==============================
-- Every line from every daily file, untouched. Auto Loader (read_files in a streaming table)
-- only reads files it hasn't seen, so dropping a new day's file processes just that day.
CREATE OR REFRESH STREAMING TABLE bronze_events
COMMENT 'Raw Lumen events, one row per JSON line, exactly as the brain wrote them.'
AS SELECT
  *,
  _metadata.file_path AS source_file,
  current_timestamp() AS ingested_at
FROM STREAM read_files(
  '/Volumes/lumen/home/raw_events/',
  format => 'json',
  -- The vision columns (scene JSON from the cameras) are listed so the vision tables exist before the first photo.
  schemaHints => 'ts DOUBLE, id STRING, speaker INT, to_you BOOLEAN, confidence DOUBLE, node_id STRING, people INT, posture STRING, summary STRING, model STRING, device STRING, inference_ms DOUBLE, total_ms DOUBLE, counts MAP<STRING, INT>, objects ARRAY<STRUCT<label: STRING, score: DOUBLE, box: ARRAY<DOUBLE>, bearing: DOUBLE, dist: DOUBLE>>'
);

-- ============================== SILVER ==============================
-- One clean table per kind of event. Expectations drop rows that can't be right.
CREATE OR REFRESH STREAMING TABLE silver_alerts (
  CONSTRAINT has_kind EXPECT (kind IS NOT NULL) ON VIOLATION DROP ROW,
  CONSTRAINT real_time EXPECT (alert_time > '2024-01-01') ON VIOLATION DROP ROW,
  CONSTRAINT known_severity EXPECT (severity IN ('critical', 'warning', 'info')),
  -- the app's test buttons send source 'fake'; those never count as real alerts
  CONSTRAINT not_a_test_button EXPECT (coalesce(source, '') <> 'fake') ON VIOLATION DROP ROW
)
COMMENT 'One row per alert Lumen raised (smoke alarm, doorbell, name called, ...).'
AS SELECT
  household, id AS alert_id, kind, zone, severity, source, confidence,
  timestamp_seconds(ts) AS alert_time
FROM STREAM bronze_events WHERE type = 'alert';

CREATE OR REFRESH STREAMING TABLE silver_acks (
  CONSTRAINT has_alert EXPECT (alert_id IS NOT NULL) ON VIOLATION DROP ROW
)
COMMENT 'One row per time someone tapped an alert as seen.'
AS SELECT household, id AS alert_id, `by` AS acked_by, timestamp_seconds(ts) AS ack_time
FROM STREAM bronze_events WHERE type = 'ack';

CREATE OR REFRESH STREAMING TABLE silver_speech
COMMENT 'What was said near the wearer. Speaker and to_you come from lip-movement matching.'
AS SELECT household, zone, text, timestamp_seconds(ts) AS said_at, ts AS speech_ts
FROM STREAM bronze_events WHERE type = 'speech' AND length(trim(text)) > 0;

CREATE OR REFRESH STREAMING TABLE silver_speakers
COMMENT 'Who said each line (person number) and whether they were facing the wearer.'
AS SELECT household, ts AS speech_ts, speaker, to_you
FROM STREAM bronze_events WHERE type = 'caption_meta';

CREATE OR REFRESH STREAMING TABLE silver_sightings (
  CONSTRAINT confident EXPECT (confidence >= 0.3) ON VIOLATION DROP ROW
)
COMMENT 'Where the camera last saw everyday items (keys, glasses, wallet).'
AS SELECT household, item, zone, confidence, timestamp_seconds(ts) AS seen_at
FROM STREAM bronze_events WHERE type = 'sighting';

CREATE OR REFRESH STREAMING TABLE silver_vision
COMMENT 'What each camera saw, one row per photo (every 5 s per room phone). No photos, only labels, posture and model speed.'
AS SELECT household, node_id, zone, source, people, posture, summary, counts, objects,
  model, device, inference_ms, total_ms, timestamp_seconds(ts) AS seen_at
FROM STREAM bronze_events WHERE type = 'vision';

CREATE OR REFRESH STREAMING TABLE silver_vision_objects
COMMENT 'One row per object a camera saw (person, stove, keys, ...), for "how often is the stove in view with nobody there" questions.'
AS SELECT household, zone, source, seen_at, o.label, o.score
FROM (
  SELECT household, zone, source, timestamp_seconds(ts) AS seen_at, explode(objects) AS o
  FROM STREAM bronze_events WHERE type = 'vision'
);

-- ============================== GOLD ==============================
-- What a caregiver actually asks about.

CREATE OR REFRESH MATERIALIZED VIEW gold_alert_response
COMMENT 'Each alert with how long it took to be noticed. missed = nobody tapped it within 5 minutes.'
AS SELECT
  a.household, a.alert_id, a.kind, a.zone, a.severity, a.alert_time,
  to_date(a.alert_time) AS day,
  date_trunc('WEEK', a.alert_time) AS week,
  hour(a.alert_time) >= 22 OR hour(a.alert_time) < 7 AS at_night,
  k.ack_time,
  unix_timestamp(k.ack_time) - unix_timestamp(a.alert_time) AS seconds_to_notice,
  k.ack_time IS NULL OR unix_timestamp(k.ack_time) - unix_timestamp(a.alert_time) > 300 AS missed
FROM silver_alerts a
LEFT JOIN (SELECT household, alert_id, min(ack_time) AS ack_time FROM silver_acks GROUP BY ALL) k
  ON a.household = k.household AND a.alert_id = k.alert_id;

CREATE OR REFRESH MATERIALIZED VIEW gold_daily
COMMENT 'One row per household per day: alerts, misses, and typical time to notice (info alerts left out).'
AS SELECT
  household, day,
  count(*) AS alerts,
  count_if(missed) AS missed_alerts,
  count_if(at_night) AS night_alerts,
  count_if(at_night AND missed) AS missed_at_night,
  round(percentile(seconds_to_notice, 0.5) FILTER (WHERE NOT missed), 1) AS median_seconds_to_notice
FROM gold_alert_response
WHERE severity <> 'info'
GROUP BY household, day;

CREATE OR REFRESH MATERIALIZED VIEW gold_change_from_normal
COMMENT 'For each day: the last 7 days compared with the 7 days before, for the same person. flagged = worth a call, not a diagnosis.'
AS WITH windows AS (
  SELECT
    d.household, d.day,
    r.day > date_sub(d.day, 7) AS this_week,
    r.missed, r.seconds_to_notice
  FROM gold_daily d
  JOIN gold_alert_response r
    ON r.household = d.household AND r.day > date_sub(d.day, 14) AND r.day <= d.day
  WHERE r.severity <> 'info'
), summary AS (
  SELECT
    household, day,
    count_if(this_week) AS alerts_this_week,
    round(percentile(seconds_to_notice, 0.5) FILTER (WHERE this_week AND NOT missed), 1) AS median_seconds_this_week,
    round(percentile(seconds_to_notice, 0.5) FILTER (WHERE NOT this_week AND NOT missed), 1) AS median_seconds_week_before,
    count_if(this_week AND missed) AS missed_this_week,
    count_if(NOT this_week AND missed) AS missed_week_before,
    count_if(NOT this_week) AS alerts_week_before
  FROM windows
  GROUP BY household, day
)
SELECT *,
  round(100 * (median_seconds_this_week - median_seconds_week_before) / median_seconds_week_before, 0) AS pct_slower,
  alerts_week_before >= 20
    AND (median_seconds_this_week > 1.25 * median_seconds_week_before
         OR missed_this_week >= 2 * missed_week_before + 2) AS flagged
FROM summary;

CREATE OR REFRESH MATERIALIZED VIEW gold_who_talks
COMMENT 'Who talks to the wearer, and how often they were facing her.'
AS SELECT
  s.household, to_date(s.said_at) AS day, m.speaker,
  count(*) AS lines, count_if(m.to_you) AS lines_to_her
FROM silver_speech s
JOIN silver_speakers m ON s.household = m.household AND s.speech_ts = m.speech_ts
GROUP BY ALL;

CREATE OR REFRESH MATERIALIZED VIEW gold_item_last_seen
COMMENT 'Where each item was seen most recently.'
AS SELECT household, item, max_by(zone, seen_at) AS zone, max(seen_at) AS last_seen
FROM silver_sightings GROUP BY household, item;

CREATE OR REFRESH MATERIALIZED VIEW gold_vision_speed
COMMENT 'How fast the vision model ran on each machine: the AMD GPU number for the pitch. Real measurements, one per photo.'
AS SELECT household, device, model, to_date(seen_at) AS day,
  count(*) AS photos,
  round(percentile(inference_ms, 0.5), 1) AS median_ms,
  round(percentile(inference_ms, 0.95), 1) AS p95_ms
FROM silver_vision WHERE source = 'owlv2' AND inference_ms IS NOT NULL
GROUP BY ALL;

CREATE OR REFRESH MATERIALIZED VIEW gold_room_activity
COMMENT 'Per room and hour: how many photos had someone in them, and how often they were lying down.'
AS SELECT household, zone, date_trunc('HOUR', seen_at) AS hour,
  count(*) AS photos,
  count_if(people > 0) AS photos_with_someone,
  count_if(posture = 'lying') AS photos_lying_down
FROM silver_vision WHERE source = 'owlv2'
GROUP BY ALL;
