-- Lumen caregiver dashboard: one dataset per block below.
-- In the dashboard editor: Data tab -> + Create from SQL -> paste ONE block -> rename the dataset to the name shown.
-- All read the Gold tables the pipeline (pipeline/lumen_pipeline.sql) builds in lumen.home.

-- Dataset: status   (the big "how is Mom doing" counters on top)
SELECT
  day AS latest_day,
  median_seconds_this_week,
  median_seconds_week_before,
  pct_slower,
  missed_this_week,
  missed_week_before,
  CASE WHEN flagged THEN 'Worth a call: slower than her usual' ELSE 'Normal for her' END AS status
FROM lumen.home.gold_change_from_normal
WHERE household = 'maria'
ORDER BY day DESC
LIMIT 1;

-- Dataset: daily   (the two trend charts)
SELECT day, median_seconds_to_notice, missed_alerts, missed_at_night, alerts
FROM lumen.home.gold_daily
WHERE household = 'maria'
ORDER BY day;

-- Dataset: missed   (table of alerts nobody saw, newest first)
SELECT alert_time, kind, zone, severity, at_night
FROM lumen.home.gold_alert_response
WHERE household = 'maria' AND missed AND severity <> 'info'
ORDER BY alert_time DESC;

-- Dataset: by_kind   (which sounds she misses most)
SELECT kind,
       count(*) AS alerts,
       count_if(missed) AS missed,
       round(100 * count_if(missed) / count(*), 0) AS missed_pct
FROM lumen.home.gold_alert_response
WHERE household = 'maria' AND severity <> 'info'
GROUP BY kind
ORDER BY missed_pct DESC;

-- Dataset: people   (who talks to her)
SELECT speaker, sum(lines) AS lines, sum(lines_to_her) AS lines_to_her
FROM lumen.home.gold_who_talks
WHERE household = 'maria'
GROUP BY speaker
ORDER BY lines DESC;
