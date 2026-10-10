"""Modes are config, not code. Switching mode only changes which detectors run,
how sensitive they are, and where alerts go."""

MODES = {
    "watch": {
        "label": "Watch (caregiver)",
        "detectors": ["alarm_dsp", "ast_sound", "fall"],
        "routes": {"critical": ["dashboard", "hud"], "warning": ["dashboard", "hud"], "info": ["dashboard"]},
    },
    "wearer": {
        "label": "Wearer (headset)",
        "detectors": ["alarm_dsp", "ast_sound", "name_call", "fall"],
        "routes": {"critical": ["hud", "dashboard"], "warning": ["hud", "dashboard"], "info": ["hud"]},
    },
    "night": {
        "label": "Night",
        "detectors": ["alarm_dsp", "ast_sound"],
        "routes": {"critical": ["strobe", "dashboard"], "warning": ["dashboard"], "info": []},
    },
}

DEFAULT_MODE = "night"
