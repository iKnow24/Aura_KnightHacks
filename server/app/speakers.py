"""Several mics, one conversation.

Give each person their own phone (the /mic page, named after them). Every phone hears everyone,
so the same sentence gets transcribed two or three times. We keep it once, labeled with the phone
that heard it loudest: the person holding that phone is almost certainly the one talking.
That's speaker labels without a diarization model, which isn't real time anyway.
"""
import difflib
import time

WINDOW_S = 4.0
SIMILAR = 0.6


def similar(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a.lower(), b.lower()).ratio()


class CrossTalk:
    def __init__(self):
        self.recent: list[dict] = []

    def check(self, zone: str, text: str, rms: float, ts: float | None = None) -> tuple[bool, dict | None]:
        """Returns (keep this line?, the earlier line it replaces, if any)."""
        ts = ts or time.time()
        self.recent = [r for r in self.recent if ts - r["ts"] < WINDOW_S]
        for r in self.recent:
            if r["zone"] != zone and similar(r["text"], text) >= SIMILAR:
                if rms <= r["rms"]:
                    return False, None
                self.recent.remove(r)
                self.recent.append({"zone": zone, "text": text, "rms": rms, "ts": ts})
                return True, r
        self.recent.append({"zone": zone, "text": text, "rms": rms, "ts": ts})
        return True, None
