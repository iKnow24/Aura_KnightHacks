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
        "detectors": ["alarm_dsp", "ast_sound", "fall"],
        "sound_kinds": HOME_SOUNDS,
        "fall_stillness_s": 8,
        "routes": {"critical": ["dashboard", "hud"], "warning": ["dashboard", "hud"], "info": ["dashboard"]},
    },
    "wearer": {
        "label": "Home (wearer)",
        "detectors": ["alarm_dsp", "ast_sound", "name_call", "fall"],
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
