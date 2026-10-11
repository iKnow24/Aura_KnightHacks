"""Modes are config, not code. Switching mode only changes which detectors run,
how sensitive they are, and where alerts go.

`sound_kinds` limits which AI sound alerts a mode cares about (None = all of them).
A car horn matters on the street and is noise in a lecture; a kettle matters at home.
"""

HOME_SOUNDS = ["smoke_alarm", "doorbell", "glass_break", "baby_cry", "timer", "kettle", "phone_ring",
               "knock", "alarm_clock", "water_running", "dog_bark", "car_alarm"]
STREET_SOUNDS = ["car_horn", "siren", "vehicle", "bike_bell", "reversing", "dog_bark", "smoke_alarm"]

MODES = {
    "watch": {
        "label": "Watch (caregiver)",
        "detectors": ["alarm_dsp", "ast_sound", "fall", "spill", "rear_vision"],
        "sound_kinds": HOME_SOUNDS,
        "fall_stillness_s": 8,
        "routes": {"critical": ["dashboard", "hud"], "warning": ["dashboard", "hud"], "info": ["dashboard"]},
    },
    "wearer": {
        "label": "Home",
        "detectors": ["alarm_dsp", "ast_sound", "name_call", "fall", "spill", "rear_vision"],
        "sound_kinds": HOME_SOUNDS,
        "fall_stillness_s": 8,
        "routes": {"critical": ["hud", "dashboard"], "warning": ["hud", "dashboard"], "info": ["hud"]},
    },
    # Captions are the point. Only things worth interrupting a class for get through.
    "lecture": {
        "label": "Lecture",
        "detectors": ["alarm_dsp", "ast_sound", "name_call"],
        "sound_kinds": ["smoke_alarm", "phone_ring"],
        "routes": {"critical": ["hud", "dashboard"], "warning": ["hud"], "info": []},
    },
    # Walking outside: street sounds plus a rear-facing phone that watches behind you.
    "outside": {
        "label": "Outside",
        "detectors": ["ast_sound", "name_call", "rear_vision"],
        "sound_kinds": STREET_SOUNDS,
        "routes": {"critical": ["hud", "dashboard"], "warning": ["hud", "dashboard"], "info": ["hud"]},
    },
    "night": {
        "label": "Night",
        "detectors": ["alarm_dsp", "ast_sound"],
        "sound_kinds": HOME_SOUNDS,
        "routes": {"critical": ["strobe", "dashboard"], "warning": ["dashboard"], "info": []},
    },
}

DEFAULT_MODE = "night"


# ---- "Add a new mode" by voice -------------------------------------------------------------
# Words in the wearer's description -> sounds that mode should listen for.
HINTS = {
    ("cook", "kitchen", "dinner", "bake", "oven", "food"): ["timer", "kettle", "smoke_alarm"],
    ("door", "guest", "visitor", "delivery", "package"): ["doorbell", "knock"],
    ("baby", "kid", "child", "nap"): ["baby_cry"],
    ("phone", "call", "work", "office", "meeting"): ["phone_ring"],
    ("walk", "street", "outside", "run", "jog", "bike", "road", "park"): STREET_SOUNDS,
    ("dog", "pet", "cat"): ["dog_bark"],
    ("shower", "bath", "sink", "garden", "water"): ["water_running"],
    ("sleep", "bed", "nap", "night"): ["smoke_alarm", "alarm_clock"],
}
ALL_KINDS = sorted(set(HOME_SOUNDS + STREET_SOUNDS))
QUIET_WORDS = ("quiet", "focus", "study", "read", "movie", "church", "lecture", "class")


def mode_rules(description: str) -> dict:
    d = description.lower()
    kinds: list[str] = []
    for words, ks in HINTS.items():
        if any(w in d for w in words):
            kinds += [k for k in ks if k not in kinds]
    if "smoke_alarm" not in kinds:
        kinds.append("smoke_alarm")  # every mode hears a fire alarm, no exceptions
    quiet = any(w in d for w in QUIET_WORDS)
    sleepy = any(w in d for w in ("sleep", "bed", "night"))
    skip = {"mode", "for", "when", "and", "the", "i'm", "im", "my", "with", "this", "that", "new", "make", "want"}
    words = [w.strip(".,!?'\"").lower() for w in description.split()]
    label = next((w for w in words if len(w) > 2 and w not in skip), "custom").title()
    return {"label": label, "sound_kinds": kinds, "quiet": quiet, "night": sleepy}


def make_mode(description: str) -> tuple[str, dict]:
    from . import llm  # late import: modes.py stays plain config for everything else

    plan = mode_rules(description)
    data, _ = llm.chat_json(
        "You set up a mode for a hearing-impaired person's sound alert app. Reply with JSON only: "
        '{"label": str (1-2 words), "sound_kinds": [str] (only from this list: ' + ", ".join(ALL_KINDS) + "), "
        '"quiet": bool (only alarms should interrupt), "night": bool (they will be asleep)}',
        f"The mode they described: {description}", max_tokens=200)
    if data and isinstance(data.get("sound_kinds"), list):
        kinds = [k for k in data["sound_kinds"] if k in ALL_KINDS]
        if kinds:
            plan = {"label": str(data.get("label") or plan["label"])[:24], "sound_kinds": kinds,
                    "quiet": bool(data.get("quiet")), "night": bool(data.get("night"))}
    if "smoke_alarm" not in plan["sound_kinds"]:
        plan["sound_kinds"].append("smoke_alarm")
    if plan["night"]:
        routes = MODES["night"]["routes"]
    elif plan["quiet"]:
        routes = MODES["lecture"]["routes"]
    else:
        routes = MODES["wearer"]["routes"]
    key = "custom-" + "".join(c for c in plan["label"].lower().replace(" ", "-") if c.isalnum() or c == "-")
    return key, {"label": plan["label"], "detectors": ["alarm_dsp", "ast_sound", "name_call"],
                 "sound_kinds": plan["sound_kinds"], "routes": routes, "description": description, "custom": True}
