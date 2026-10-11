"""Two weeks of one household's Lumen events, one JSON-lines file per day.

Same shape as what the brain writes with EVENT_LOG_DIR set (server/app/eventlog.py), so the
pipeline can't tell generated days from real ones. Like the earthquake workshop's daily file
drop: upload one day at a time and watch the pipeline pick up only the new file.

The data is made up, and the decline in week 2 is planted on purpose: from day 8 on, Maria
takes longer to notice alerts and misses more of them, worst at night. Say so in the demo.
Pass --steady for days that should stay at her normal pace (history before that two-week window).

    python3 databricks/generate_household.py --days 14 --out databricks/sample_data
    python3 databricks/generate_household.py --days 30 --end 2026-09-25 --steady
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
NIGHT_ALERTS = [  # kind, zone, severity, chance per night
    ("phone_ring", "bedroom", "warning", 0.5),
    ("doorbell", "hallway", "warning", 0.3),
    ("knock", "hallway", "warning", 0.3),
    ("dog_bark", "outside", "warning", 0.5),
    ("car_alarm", "outside", "warning", 0.3),
    ("glass_break", "kitchen", "critical", 0.08),
]
SPEAKERS = {1: "Ana (daughter)", 2: "Dr. Patel's office", 3: "neighbor", 4: "Leo (grandson)", 5: "Rosa (home aide)"}
# speaker, room, spot in that room, what they said. The spot is what the house map draws.
LINES = [
    (1, "hallway", "Front door", "Mom, I'm heading out, back around six."),
    (1, "kitchen", "Table", "Did you take the blue pill this morning?"),
    (1, "kitchen", "Table", "Can you grab milk if you go out?"),
    (1, "kitchen", "Stove", "Dinner's ready, come eat!"),
    (1, "bedroom", "Bed", "Call me when you wake up."),
    (1, "bedroom", "Nightstand", "I put your glasses on the nightstand."),
    (1, "hallway", "Front door", "The plumber is coming Tuesday at ten."),
    (1, "hallway", "Porch", "Don't forget your sweater, it's cold out."),
    (2, "living", "Sofa", "Your appointment moved to Thursday at 2."),
    (2, "living", "Sofa", "Please bring your medication list to the visit."),
    (2, "living", "Coffee table", "Your blood test results came back normal."),
    (3, "hallway", "Porch", "Your package is on the porch."),
    (3, "kitchen", "Sink", "I'm making soup, want some?"),
    (3, "living", "TV", "The power might go out tonight, there's a storm coming."),
    (4, "living", "Sofa", "Grandma, can I use the laptop?"),
    (4, "living", "TV", "I fixed the TV remote."),
    (4, "living", "TV", "Grandma, look at this video!"),
    (4, "hallway", "Front door", "I'm going to soccer practice, bye!"),
    (5, "hallway", "Porch", "Time for your walk, Maria."),
    (5, "bedroom", "Bed", "Let's check your blood pressure."),
    (5, "kitchen", "Table", "Lunch is soup and a sandwich today."),
    (5, "kitchen", "Table", "I refilled your pill organizer for the week."),
    (5, "bedroom", "Nightstand", "Did you sleep okay last night?"),
    (5, "hallway", "Front door", "I'll be back tomorrow at nine."),
]
ITEMS = [("keys", ["hallway", "living", "kitchen"]), ("glasses", ["bedroom", "living"]), ("wallet", ["kitchen", "hallway"])]


def decline(day_index: int, steady: bool = False) -> float:
    """0 for the first week, then rising to 1 by the last day. --steady stays at 0 the whole time."""
    if steady:
        return 0.0
    return max(0.0, (day_index - 6) / 7)


def alert_events(rng, when, kind, zone, severity, d, night):
    ts = when.timestamp()
    alert = {"type": "alert", "id": f"{ts:.3f}", "kind": kind, "zone": zone, "severity": severity,
             "source": "ast", "confidence": round(rng.uniform(0.7, 0.99), 2), "ts": ts}
    out = [alert]
    # Baseline: noticed in ~6 s (warnings) or ~12 s (info). Week 2 gets up to 70% slower.
    median = (6 if severity != "info" else 12) * (1 + 0.7 * d) * (1.8 if night else 1)
    miss = 0.03 * (1.5 if night else 1) + 0.12 * d * (4 if night else 1)  # the decline hits nights hardest
    if severity == "critical":
        miss /= 3  # the strobe is hard to sleep through
    if rng.random() > miss:
        delay = min(240, rng.lognormvariate(0, 0.45) * median)
        out.append({"type": "ack", "id": alert["id"], "by": "wearer", "ts": ts + delay})
    return out


def day_in_the_life(rng, day: date, at) -> list[dict]:
    """A full day of talk and item checks, with a spot in the house on every line."""
    events = []
    wd = day.weekday()  # Monday 0

    def say(hour, minute, speaker, zone, place, text, to_you=True):
        ts = at(hour, min(59, minute), rng.randint(0, 40)).timestamp()
        events.append({"type": "speech", "zone": zone, "place": place, "text": text, "ts": ts, "speaker": speaker})
        events.append({"type": "caption_meta", "ts": ts, "speaker": speaker, "to_you": to_you})

    def see(hour, minute, item, zone, place):
        events.append({
            "type": "sighting", "item": item, "zone": zone, "place": place,
            "confidence": round(rng.uniform(0.41, 0.93), 2),
            "ts": at(hour, minute, rng.randint(5, 50)).timestamp(),
        })

    say(7, 12, 5, "hallway", "Porch", "Good morning, Maria. It's Rosa.")
    say(7, 14, 5, "hallway", "Front door", "Shoes are by the door. Short walk first, then breakfast.")
    say(7, 41, 5, "kitchen", "Table", "Sit here. I set out the blue pill and a glass of water.")
    say(7, 43, 5, "kitchen", "Table", "Did you take the blue pill this morning?")
    say(8, 6, 5, "kitchen", "Stove", "Oatmeal is ready. The kettle just clicked off.")
    say(8, 22, 5, "living", "Sofa", "Blood pressure is the usual. I'll write it in the book.")
    say(8, 48, 1, "living", "Sofa", "Mom, I'm heading out, back around six.")
    say(8, 49, 1, "hallway", "Front door", "Call me if you need anything. Rosa has my number.")

    say(9, 16, 5, "bedroom", "Nightstand", "Glasses are on the nightstand, not the bed.")
    say(9, 18, 5, "bedroom", "Bed", "Did you sleep okay last night?")
    say(10, 5, 5, "kitchen", "Sink", "I'm washing the breakfast pan. Stay clear of the wet floor.")
    say(10, 33, 3, "hallway", "Porch", "Your package is on the porch.")
    say(10, 35, 5, "hallway", "Front door", "I'll bring the package in so it doesn't sit in the sun.")

    if wd == 1:
        say(11, 5, 1, "living", "Sofa", "The plumber is coming Tuesday at ten.")
        say(11, 7, 5, "hallway", "Front door", "I'll wait by the door so you don't have to get up.")
    if wd == 3:
        say(11, 20, 2, "living", "Sofa", "Your appointment moved to Thursday at 2.")
        say(11, 22, 2, "living", "Coffee table", "Please bring your medication list to the visit.")
        say(11, 24, 5, "kitchen", "Table", "I'll put the medication list next to your wallet.")
    if wd in (0, 2, 4):
        say(11, 40, 2, "living", "Sofa", "Your blood test results came back normal.")
        say(11, 42, 5, "living", "Sofa", "That's good news. I'll leave the paper on the coffee table.")

    say(12, 10, 5, "kitchen", "Table", "Lunch is soup and a sandwich today.")
    say(12, 28, 5, "kitchen", "Stove", "Soup is hot. Give it a minute.")
    say(12, 46, 5, "kitchen", "Sink", "Dishes can wait. You eat first.")

    if wd in (0, 2, 4):
        say(15, 5, 4, "hallway", "Front door", "Grandma, I'm home from school.")
        say(15, 8, 4, "living", "TV", "I fixed the TV remote.")
        say(15, 12, 4, "living", "Sofa", "Grandma, can I use the laptop?")
        say(15, 30, 4, "living", "TV", "Grandma, look at this video!")
        say(16, 2, 5, "hallway", "Porch", "Leo, shoes off. Grandma's rug is clean.")
    if wd == 5:
        say(14, 10, 4, "hallway", "Front door", "I'm going to soccer practice, bye!")
        say(14, 12, 1, "hallway", "Porch", "Don't forget your sweater, it's cold out.")
    if wd == 6:
        say(13, 15, 1, "kitchen", "Table", "Sunday lunch is chicken. Leo is coming over.")
        say(13, 40, 4, "living", "Sofa", "Grandma, I saved you a seat.")
        say(14, 5, 3, "kitchen", "Sink", "I'm making soup, want some?")

    say(9, 55, 5, "kitchen", "Table", "Grocery list is on the table: milk, bread, bananas, and the blue pill refill.")
    say(10, 12, 5, "living", "Coffee table", "Mail is here. One letter from the clinic, the rest can wait.")
    say(10, 50, 3, "hallway", "Porch", "Maria, the sprinkler on my side is off. Yours looked fine this morning.")
    say(11, 55, 5, "kitchen", "Sink", "Windows are open a crack. Tell me if it gets too warm.")
    say(13, 5, 5, "living", "Sofa", "News is on low. I'll turn it up if you want the weather.")
    say(13, 8, 5, "living", "TV", "Afternoon storms again. We'll stay in if the thunder starts.")
    say(13, 22, 1, "living", "Sofa", "Mom, I paid the electric bill. The confirmation is in your email.")
    say(14, 40, 5, "kitchen", "Table", "Snack is cheese and crackers. Water is the glass on your right.")
    say(15, 45, 5, "hallway", "Front door", "Walker is by the door, brakes on.")
    say(16, 5, 5, "bedroom", "Bed", "I changed the sheets. The light blanket is at the foot of the bed.")
    say(16, 20, 5, "bedroom", "Nightstand", "I refilled your pill organizer for the week.")
    say(16, 36, 5, "living", "Coffee table", "Remote is on the coffee table, keys are by the door.")
    say(17, 5, 5, "hallway", "Front door", "I'll be back tomorrow at nine.")
    say(17, 8, 1, "hallway", "Porch", "Thanks, Rosa. I've got her from here.")

    say(18, 2, 1, "kitchen", "Stove", "Rice is on. You can sit at the table.")
    say(18, 6, 1, "kitchen", "Table", "Fork is on the left. The soup is the front bowl.")
    say(18, 16, 1, "kitchen", "Table", "Can you grab milk if you go out tomorrow?")
    say(18, 22, 1, "kitchen", "Sink", "I wiped the counter. The stove is off.")
    say(18, 34, 1, "kitchen", "Stove", "Dinner's ready, come eat!")
    say(18, 48, 1, "kitchen", "Table", "How was the soup? Too salty, or fine?")
    say(18, 51, 1, "living", "Sofa", "Want the news, or quiet?")
    say(19, 5, 1, "living", "TV", "Volume is at 18. Tell me if you want it louder.")
    say(19, 30, 1, "living", "Coffee table", "Water is on the coaster. I'll refill it before bed.")
    say(20, 2, 1, "bedroom", "Bed", "Bathroom light is on, so the hall isn't dark.")
    say(20, 10, 1, "bedroom", "Bed", "Call me when you wake up.")
    say(20, 14, 1, "bedroom", "Nightstand", "I put your glasses on the nightstand.")
    say(20, 22, 1, "bedroom", "Nightstand", "Phone is charging. The big button calls me.")
    say(20, 40, 1, "hallway", "Front door", "Door is locked. Night mode is on, so the bedroom phone will flash if the alarm goes.")
    say(21, 5, 1, "hallway", "Porch", "Porch light is on. I'm heading out, back in the morning.")

    if rng.random() < 0.5:
        say(19, 12, 3, "living", "TV", "The power might go out tonight, there's a storm coming.", to_you=False)
    if rng.random() < 0.4:
        speaker, zone, place, text = rng.choice(LINES)
        say(rng.randint(9, 19), rng.randint(1, 50), speaker, zone, place, text, to_you=rng.random() < 0.7)

    # Street warnings use one risk limit. Danger at or above it is a warning; well above it is critical.
    # Under the limit is written down, but it does not warn her.
    RISK_LIMIT = 0.55

    def risk(hour, minute, kind, zone, place, danger):
        danger = round(danger, 2)
        if danger >= RISK_LIMIT + 0.25:
            level = "critical"
        elif danger >= RISK_LIMIT:
            level = "warning"
        else:
            level = "none"
        ts = at(hour, min(59, minute), rng.randint(0, 40)).timestamp()
        rid = f"risk-{ts:.0f}"
        events.append({
            "type": "risk", "id": rid, "kind": kind, "zone": zone, "place": place,
            "danger": danger, "risk_limit": RISK_LIMIT, "warning": level,
            "over_limit": danger >= RISK_LIMIT, "ts": ts,
        })
        return rid

    def reminder(hour, minute, what, zone, place):
        ts = at(hour, min(59, minute), rng.randint(0, 20)).timestamp()
        rid = f"rem-{ts:.0f}"
        events.append({
            "type": "reminder", "id": rid, "what": what, "zone": zone, "place": place, "ts": ts,
        })
        return rid

    def did(hour, minute, action, by, **links):
        events.append({
            "type": "interaction", "action": action, "by": by,
            "ts": at(hour, min(59, minute), rng.randint(0, 40)).timestamp(), **links,
        })

    def street(hour, who):
        spots = [
            ("vehicle", "behind", "Oak Street", rng.uniform(0.70, 0.97)),
            ("reversing", "behind", "Driveway", rng.uniform(0.58, 0.92)),
            ("car_horn", "behind", "Intersection", rng.uniform(0.40, 0.86)),
            ("bike_bell", "behind", "Sidewalk", rng.uniform(0.15, 0.64)),
            ("person_behind", "behind", "Sidewalk", rng.uniform(0.30, 0.78)),
        ]
        for n, (kind, zone, place, danger) in enumerate(spots):
            if rng.random() < 0.35:
                continue
            rid = risk(hour, 8 + n * 3, kind, zone, place, danger)
            if danger >= 0.80:
                did(hour, 9 + n * 3, "stepped onto the curb and waited", who, risk_id=rid)
            elif danger >= RISK_LIMIT:
                did(hour, 9 + n * 3, "stopped walking until it passed", who, risk_id=rid)
            else:
                did(hour, 9 + n * 3, "kept walking, under the risk limit", who, risk_id=rid)

    street(7, "Rosa")
    if wd in (1, 3, 5):
        street(16, "Ana")

    pill = reminder(7, 40, "Take the blue pill", "kitchen", "Table")
    did(7, 44, "took the blue pill", "Maria", reminder_id=pill)
    lunch = reminder(12, 0, "Eat lunch", "kitchen", "Table")
    did(12, 12, "sat down for lunch", "Maria", reminder_id=lunch)
    organizer = reminder(16, 18, "Check the pill organizer", "bedroom", "Nightstand")
    did(16, 24, "checked the organizer with Rosa", "Maria", reminder_id=organizer)
    lock = reminder(20, 35, "Lock the front door", "hallway", "Front door")
    did(20, 41, "locked the door", "Ana", reminder_id=lock)
    reminder(21, 10, "Call Ana in the morning", "bedroom", "Nightstand")
    if rng.random() < 0.7:
        did(7, 50, "called Ana, like last night's reminder", "Maria")
    if wd == 1:
        plumber = reminder(9, 50, "Plumber arrives at ten", "hallway", "Front door")
        did(10, 2, "opened the door for the plumber", "Rosa", reminder_id=plumber)

    see(7, 20, "glasses", "bedroom", "Nightstand")
    see(7, 48, "pills", "kitchen", "Table")
    see(8, 15, "keys", "hallway", "Front door")
    see(8, 55, "wallet", "kitchen", "Table")
    see(10, 40, "keys", "hallway", "Front door")
    see(12, 5, "glasses", "kitchen", "Table")
    see(15, 20, "remote", "living", "Coffee table")
    see(16, 15, "pills", "bedroom", "Nightstand")
    see(18, 10, "wallet", "living", "Sofa")
    see(20, 18, "glasses", "bedroom", "Nightstand")
    see(20, 45, "keys", "hallway", "Front door")
    if wd % 2 == 0:
        see(11, 30, "phone", "living", "Sofa")
        see(19, 5, "phone", "bedroom", "Nightstand")
    return events


def day_events(rng, day: date, index: int, household: str = HOUSEHOLD, steady: bool = False) -> list[dict]:
    d = decline(index, steady)
    at = lambda h, m=0, s=0: datetime(day.year, day.month, day.day, h, m, s, tzinfo=TZ)
    events = [{"type": "mode", "mode": "watch", "ts": at(7).timestamp()},
              {"type": "mode", "mode": "night", "ts": at(22, 30).timestamp()}]
    for kind, zone, severity, (h0, h1), (n0, n1) in DAILY_ALERTS:
        for _ in range(rng.randint(n0, n1)):
            events += alert_events(rng, at(rng.randint(h0, h1), rng.randint(0, 59), rng.randint(0, 59)),
                                   kind, zone, severity, d, night=False)
    # Night (Night mode is the hero): every night has something, from a dog barking outside to a
    # kitchen smoke alarm at 2 AM. Smoke alarms on four nights, two in each week.
    if index in (1, 4, 9, 12):
        events += alert_events(rng, at(rng.choice([1, 2, 3]), rng.randint(0, 59)), "smoke_alarm", "kitchen",
                               "critical", d, night=True)
    for kind, zone, severity, chance in NIGHT_ALERTS:
        if rng.random() < chance:
            hour = rng.choice([22, 23, 0, 1, 2, 3, 4, 5])
            hour = 23 if hour == 22 else hour  # night mode starts 22:30
            events += alert_events(rng, at(hour, rng.randint(0, 59)), kind, zone, severity, d, night=True)
    # Alerts above use `rng` and must stay in that order: week 2's slowdown is planted there.
    # The day-in-the-life below uses its own dice so a judge can read a real morning and evening.
    events += day_in_the_life(random.Random(index * 17 + 3), day, at)
    for e in events:
        e["household"] = household
    return sorted(events, key=lambda e: e["ts"])


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--days", type=int, default=14)
    p.add_argument("--end", default=None, help="last day, YYYY-MM-DD (default: yesterday)")
    p.add_argument("--out", default=str(Path(__file__).parent / "sample_data"))
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--household", default=HOUSEHOLD, help="household id written on every line (default: maria)")
    p.add_argument("--steady", action="store_true",
                   help="no planted slowdown; use for days before the 2026-09-26 demo window")
    args = p.parse_args()
    if args.household == "home":
        raise SystemExit("refusing household 'home': that name is the real house, not generated data")
    rng = random.Random(args.seed)
    end = date.fromisoformat(args.end) if args.end else date.today() - timedelta(days=1)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for i in range(args.days):
        day = end - timedelta(days=args.days - 1 - i)
        events = day_events(rng, day, i, args.household, args.steady)
        path = out / f"{day.isoformat()}.jsonl"
        if path.exists():
            raise SystemExit(f"refusing to overwrite {path.name}; pick an --end that does not overlap")
        path.write_text("".join(json.dumps(e) + "\n" for e in events))
        print(day, len(events), "events", args.household, "steady" if args.steady else "decline")


if __name__ == "__main__":
    main()
