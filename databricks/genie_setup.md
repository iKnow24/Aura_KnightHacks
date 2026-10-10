# Genie agent for Lumen (copy and paste)

Genie Agents → **+ New** → add tables `lumen.home.gold_change_from_normal`, `gold_daily`,
`gold_alert_response`, `gold_who_talks`, `gold_item_last_seen`. Accept the suggested description.
Then **Configure** (gear) and paste each part below.

## Instructions

```
This is the home of Maria, 74, who is hard of hearing. Lumen listens for sounds and alerts her phone.
- "Noticed" means Maria tapped the alert. "Missed" means nobody tapped it within 5 minutes.
- Night is 10 PM to 7 AM.
- Leave out severity 'info' (kettle, oven timer) when judging how Maria is doing.
- "Is she doing worse / slower / okay?" -> use gold_change_from_normal, latest day.
- speaker numbers: 1 = Ana (daughter), 2 = Dr. Patel's office, 3 = neighbor, 4 = Leo (grandson), 5 = Rosa (home aide).
- Never call anything a diagnosis. Say "a change from her usual" and suggest a check-in call.
- Answer in one or two plain sentences a family member can read on a phone.
```

## Example queries (Configure → Examples → Example query)

Question: **Is Mom slower to notice things than last week?**
```sql
SELECT day, median_seconds_this_week, median_seconds_week_before, pct_slower,
       missed_this_week, missed_week_before, flagged
FROM lumen.home.gold_change_from_normal
WHERE household = 'maria' ORDER BY day DESC LIMIT 1
```

Question: **How many alerts did she miss at night this week?**
```sql
SELECT count(*) AS missed_at_night
FROM lumen.home.gold_alert_response
WHERE household = 'maria' AND missed AND at_night AND severity <> 'info'
  AND day > (SELECT max(day) FROM lumen.home.gold_alert_response) - INTERVAL 7 DAYS
```

Question: **Which sound does she miss most?**
```sql
SELECT kind, count_if(missed) AS missed, count(*) AS alerts
FROM lumen.home.gold_alert_response
WHERE household = 'maria' AND severity <> 'info'
GROUP BY kind ORDER BY missed DESC LIMIT 1
```

## Filter (Configure → Examples → Filter)

Name **real alerts**, condition `severity <> 'info'`.

## Join (Configure → Examples → Join)

Usually not needed; the Gold tables already joined alerts to taps. If you add `silver_alerts` and
`silver_acks`, join on `alert_id` (one alert → zero or one tap).

## Benchmarks (Benchmarks → Add)

Use the three example questions above with their SQL as the correct answer, then **Run benchmarks**.
On the generated data the first one should say about **50% slower, 15 missed vs 5, flagged**.

## Questions to ask live in the demo

- Is Mom doing okay this week?
- How many alerts did she miss at night?
- Which sound does she miss most?
- Who talked to her the most?
- Where are her keys?
