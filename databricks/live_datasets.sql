-- Dashboard datasets for REAL events from this home (household 'home'), last 24 hours.
-- Same steps as dashboard_datasets.sql: Data tab -> + Create from SQL -> paste ONE block -> rename it.
-- Test-button alerts never get here: silver_alerts drops source 'fake' (see the pipeline's data quality tab).

-- Dataset: live_status   (counters: alerts, missed, typical seconds to notice)
SELECT
  count(*) AS alerts,
  count_if(missed) AS missed,
  round(percentile(seconds_to_notice, 0.5) FILTER (WHERE NOT missed), 1) AS median_seconds_to_notice,
  max(alert_time) AS last_alert
FROM lumen.home.gold_alert_response
WHERE household = 'home' AND severity <> 'info' AND alert_time > current_timestamp() - INTERVAL 24 HOURS;

-- Dataset: live_alerts   (table: every real alert and how fast it was seen)
SELECT alert_time, kind, zone, severity, round(seconds_to_notice, 1) AS seconds_to_notice, missed
FROM lumen.home.gold_alert_response
WHERE household = 'home' AND alert_time > current_timestamp() - INTERVAL 24 HOURS
ORDER BY alert_time DESC;

-- Dataset: live_by_kind   (bar: which sounds happen, and which get missed)
SELECT kind, count(*) AS alerts, count_if(missed) AS missed
FROM lumen.home.gold_alert_response
WHERE household = 'home' AND severity <> 'info' AND alert_time > current_timestamp() - INTERVAL 24 HOURS
GROUP BY kind ORDER BY alerts DESC;

-- Dataset: freshness   (counter: proof it's live. Events in Bronze and when the last one landed)
SELECT count(*) AS events_today,
       max(ingested_at) AS last_ingested,
       round((unix_timestamp(current_timestamp()) - max(ts)) / 60, 1) AS minutes_since_last_event
FROM lumen.home.bronze_events
WHERE household = 'home' AND ts > unix_timestamp(current_timestamp()) - 86400;
