"""Turns the generated daily files into one SQL file you can paste into the Databricks SQL editor.

One readable table, home_timeline: when, who, what happened, where. No upload or pipeline needed.

    python3 databricks/make_timeline_sql.py > databricks/dummy_data.sql
"""
import json
import random
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/New_York")
PEOPLE = {1: "Ana (daughter)", 2: "Dr. Patel's office", 3: "Neighbor", 4: "Leo (grandson)", 5: "Rosa (home aide)"}
ROOMS = ["kitchen", "living room", "hallway", "bedroom"]
NAMES = {"smoke_alarm": "Smoke alarm went off", "doorbell": "Doorbell rang", "knock": "Knock at the door",
         "phone_ring": "Phone rang", "name_called": "Someone called Maria's name", "timer": "Oven timer beeped",
         "kettle": "Kettle whistled", "alarm_clock": "Alarm clock rang",
         "dog_bark": "Dog barked outside", "car_alarm": "Car alarm outside", "glass_break": "Glass broke",
         "vehicle": "Car approaching", "reversing": "Vehicle reversing", "car_horn": "Car horn",
         "bike_bell": "Bike coming up", "person_behind": "Person coming up behind"}
ROOM = {"living": "living room"}


def q(s):
    return "NULL" if s is None else "'" + str(s).replace("'", "''") + "'"


def rows(folder: Path):
    rng = random.Random(3)
    events = [json.loads(l) for f in sorted(folder.glob("*.jsonl")) for l in f.read_text().splitlines()]
    alerts = {e["id"]: e for e in events if e["type"] == "alert"}
    meta = {e["ts"]: e for e in events if e["type"] == "caption_meta"}
    acked = {e["id"] for e in events if e["type"] == "ack"}
    for e in events:
        when = datetime.fromtimestamp(e["ts"], TZ).strftime("%Y-%m-%d %H:%M:%S")
        t = e["type"]
        if t == "alert":
            kind = e["kind"]
            yield (when, "sound", "Lumen", NAMES.get(kind, kind), ROOM.get(e["zone"], e["zone"]),
                   e["severity"], round(e["confidence"], 2), None, e["id"] not in acked)
        elif t == "ack":
            a = alerts[e["id"]]
            secs = round(e["ts"] - a["ts"], 1)
            yield (when, "response", "Maria", f"Saw the alert: {NAMES.get(a['kind'], a['kind']).lower()}",
                   ROOM.get(a["zone"], a["zone"]), a["severity"], None, secs, False)
        elif t == "speech":
            m = meta.get(e["ts"], {})
            who = PEOPLE.get(m.get("speaker"), "Unknown")
            to = "to Maria" if m.get("to_you") else "nearby"
            where = e.get("place") or ROOM.get(e.get("zone"), e.get("zone"))
            yield (when, "speech", who, f'Said ({to}): "{e["text"]}"', where, "info", None, None, False)
        elif t == "sighting":
            where = e.get("place") or ROOM.get(e.get("zone"), e.get("zone"))
            yield (when, "item_seen", "Lumen camera", f"Spotted {e['item']}", where,
                   "info", e["confidence"], None, False)
        elif t == "mode":
            label = "Night mode on (bed strobe armed)" if e["mode"] == "night" else "Day mode on"
            yield (when, "mode", "Lumen", label, "whole house", "info", None, None, False)
        elif t == "risk":
            level = e.get("warning") or "none"
            what = (f"{NAMES.get(e['kind'], e['kind'])}: danger {e['danger']:.2f}, "
                    f"limit {e['risk_limit']:.2f}, {level}")
            yield (when, "risk", "Lumen", what, e.get("place") or e.get("zone"), level if level != "none" else "info",
                   e.get("danger"), None, False)
        elif t == "reminder":
            yield (when, "reminder", "Lumen", e.get("what"), e.get("place") or e.get("zone"), "info", None, None, False)
        elif t == "interaction":
            yield (when, "interaction", e.get("by") or "Maria", e.get("action"), e.get("place"), "info", None, None, False)


def main():
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "sample_data"
    out = sorted(rows(folder))
    print(f"""-- Lumen dummy data: {len(out)} events, 2 weeks of one household (Maria, 74, hard of hearing).
-- Made up for the demo. From day 8 on Maria is planted to react slower and miss more alerts.
-- Paste into the Databricks SQL editor and run. Change lumen.home if your catalog/schema differ.

CREATE CATALOG IF NOT EXISTS lumen;
CREATE SCHEMA IF NOT EXISTS lumen.home;

CREATE OR REPLACE TABLE lumen.home.home_timeline (
  event_time        TIMESTAMP COMMENT 'When it happened (Orlando time)',
  event_type        STRING    COMMENT 'sound, response, speech, item_seen, mode',
  who               STRING    COMMENT 'Who said or did it',
  what              STRING    COMMENT 'What happened, in plain words',
  location          STRING    COMMENT 'Room in the house',
  severity          STRING    COMMENT 'critical, warning, info',
  confidence        DOUBLE    COMMENT 'How sure the AI was (0 to 1)',
  seconds_to_notice DOUBLE    COMMENT 'For responses: seconds between the alert and Maria tapping it',
  missed            BOOLEAN   COMMENT 'For sounds: nobody tapped the alert'
) COMMENT 'Everything Lumen noticed in Maria''s home, one row per event.';

INSERT INTO lumen.home.home_timeline VALUES""")
    print(",\n".join(f"  (TIMESTAMP {q(r[0])}, {q(r[1])}, {q(r[2])}, {q(r[3])}, {q(r[4])}, {q(r[5])}, "
                     f"{'NULL' if r[6] is None else r[6]}, {'NULL' if r[7] is None else r[7]}, {str(r[8]).upper()})"
                     for r in out) + ";")
    print("""
-- Try these:
-- Everything on the last day, in order
SELECT event_time, who, what, location FROM lumen.home.home_timeline
WHERE date(event_time) = (SELECT max(date(event_time)) FROM lumen.home.home_timeline)
ORDER BY event_time;

-- Is Maria slower to notice alerts? Per day: typical seconds to notice, and alerts nobody saw
SELECT date(event_time) AS day,
       round(percentile(seconds_to_notice, 0.5) FILTER (WHERE event_type = 'response' AND severity <> 'info'), 1) AS median_seconds,
       count_if(missed AND severity <> 'info') AS missed_alerts
FROM lumen.home.home_timeline GROUP BY ALL ORDER BY day;

-- Who talks to her most?
SELECT who, count(*) AS lines FROM lumen.home.home_timeline WHERE event_type = 'speech' GROUP BY who ORDER BY lines DESC;

-- Where were the keys last seen?
SELECT event_time, location FROM lumen.home.home_timeline WHERE what = 'Spotted keys' ORDER BY event_time DESC LIMIT 1;""")


if __name__ == "__main__":
    main()
