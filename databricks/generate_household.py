"""Two weeks of one household's Lumen events, one JSON-lines file per day.

Same shape as what the brain writes with EVENT_LOG_DIR set (server/app/eventlog.py), so the
pipeline can't tell generated days from real ones. Like the earthquake workshop's daily file
drop: upload one day at a time and watch the pipeline pick up only the new file.

The data is made up, and the decline in week 2 is planted on purpose: from day 8 on, Maria
takes longer to notice alerts and misses more of them, worst at night. Say so in the demo.

    python3 databricks/generate_household.py --days 14 --out databricks/sample_data
"""
import argparse
import json
import random
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

HOUSEHOLD = "maria"
TZ = ZoneInfo("America/New_York")  # Orlando; the pipeline reads times in the same zone
# kind, zone, severity, (earliest hour, latest hour), how many per day (min, max)
DAILY_ALERTS = [
    ("doorbell", "hallway", "warning", (9, 19), (1, 3)),
    ("knock", "hallway", "warning", (10, 18), (0, 1)),
    ("phone_ring", "living", "warning", (9, 21), (1, 3)),
    ("name_called", "kitchen", "warning", (8, 21), (3, 6)),
    ("timer", "kitchen", "info", (11, 19), (1, 2)),
    ("kettle", "kitchen", "info", (7, 17), (1, 3)),
    ("alarm_clock", "bedroom", "warning", (7, 7), (1, 1)),
]
SPEAKERS = {1: "Ana (daughter)", 2: "Dr. Patel's office", 3: "neighbor", 4: "Leo (grandson)", 5: "Rosa (home aide)"}
LINES = [
    (1, "Mom, I'm heading out, back around six."),
    (1, "Did you take the blue pill this morning?"),
    (1, "Can you grab milk if you go out?"),
    (1, "Dinner's ready, come eat!"),
    (1, "Call me when you wake up."),
    (1, "I put your glasses on the nightstand."),
    (1, "The plumber is coming Tuesday at ten."),
    (1, "Don't forget your sweater, it's cold out."),
    (2, "Your appointment moved to Thursday at 2."),
    (2, "Please bring your medication list to the visit."),
    (2, "Your blood test results came back normal."),
    (3, "Your package is on the porch."),
    (3, "I'm making soup, want some?"),
    (3, "The power might go out tonight, there's a storm coming."),
    (4, "Grandma, can I use the laptop?"),
    (4, "I fixed the TV remote."),
    (4, "Grandma, look at this video!"),
    (4, "I'm going to soccer practice, bye!"),
    (5, "Time for your walk, Maria."),
    (5, "Let's check your blood pressure."),
    (5, "Lunch is soup and a sandwich today."),
    (5, "I refilled your pill organizer for the week."),
    (5, "Did you sleep okay last night?"),
    (5, "I'll be back tomorrow at nine."),
]
ITEMS = [("keys", ["hallway", "living", "kitchen"]), ("glasses", ["bedroom", "living"]), ("wallet", ["kitchen", "hallway"])]


def decline(day_index: int) -> float:
    """0 for the first week, then rising to 1 by the last day."""
    return max(0.0, (day_index - 6) / 7)


def alert_events(rng, when, kind, zone, severity, d, night):
    ts = when.timestamp()
    alert = {"type": "alert", "id": f"{ts:.3f}", "kind": kind, "zone": zone, "severity": severity,
             "source": "ast", "confidence": round(rng.uniform(0.7, 0.99), 2), "ts": ts}
    out = [alert]
    # Baseline: noticed in ~6 s (warnings) or ~12 s (info). Week 2 gets up to 70% slower.
    median = (6 if severity != "info" else 12) * (1 + 0.7 * d) * (1.8 if night else 1)
    miss = (0.03 + 0.12 * d) * (2.5 if night else 1)
    if severity == "critical":
        miss /= 3  # the strobe is hard to sleep through
    if rng.random() > miss:
        delay = min(240, rng.lognormvariate(0, 0.45) * median)
        out.append({"type": "ack", "id": alert["id"], "by": "wearer", "ts": ts + delay})
    return out


def day_events(rng, day: date, index: int) -> list[dict]:
    d = decline(index)
    at = lambda h, m=0, s=0: datetime(day.year, day.month, day.day, h, m, s, tzinfo=TZ)
    events = [{"type": "mode", "mode": "watch", "ts": at(7).timestamp()},
              {"type": "mode", "mode": "night", "ts": at(22, 30).timestamp()}]
    for kind, zone, severity, (h0, h1), (n0, n1) in DAILY_ALERTS:
        for _ in range(rng.randint(n0, n1)):
            events += alert_events(rng, at(rng.randint(h0, h1), rng.randint(0, 59), rng.randint(0, 59)),
                                   kind, zone, severity, d, night=False)
    # Night: a smoke alarm on two nights (one each week), and the odd doorbell or phone call.
    if index in (3, 11):
        events += alert_events(rng, at(2, 13), "smoke_alarm", "kitchen", "critical", d, night=True)
    for kind, zone in (("phone_ring", "bedroom"), ("doorbell", "hallway")):
        if rng.random() < 0.35:
            events += alert_events(rng, at(23, rng.randint(0, 59)), kind, zone, "warning", d, night=True)
    for _ in range(rng.randint(8, 14)):
        speaker, text = rng.choice(LINES)
        ts = at(rng.randint(8, 21), rng.randint(0, 59), rng.randint(0, 59)).timestamp()
        events.append({"type": "speech", "zone": "wearer", "text": text, "ts": ts})
        events.append({"type": "caption_meta", "ts": ts, "speaker": speaker, "to_you": rng.random() < 0.8})
    for item, zones in ITEMS:
        for _ in range(rng.randint(1, 3)):
            events.append({"type": "sighting", "item": item, "zone": rng.choice(zones),
                           "confidence": round(rng.uniform(0.3, 0.6), 2),
                           "ts": at(rng.randint(8, 21), rng.randint(0, 59)).timestamp()})
    for e in events:
        e["household"] = HOUSEHOLD
    return sorted(events, key=lambda e: e["ts"])


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--days", type=int, default=14)
    p.add_argument("--end", default=None, help="last day, YYYY-MM-DD (default: yesterday)")
    p.add_argument("--out", default=str(Path(__file__).parent / "sample_data"))
    p.add_argument("--seed", type=int, default=7)
    args = p.parse_args()
    rng = random.Random(args.seed)
    end = date.fromisoformat(args.end) if args.end else date.today() - timedelta(days=1)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for i in range(args.days):
        day = end - timedelta(days=args.days - 1 - i)
        events = day_events(rng, day, i)
        (out / f"{day.isoformat()}.jsonl").write_text("".join(json.dumps(e) + "\n" for e in events))
        print(day, len(events), "events")


if __name__ == "__main__":
    main()
