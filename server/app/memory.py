"""The house's memory: a timestamped log of what was said and where things were last seen.

Alerts stay in hub.events (the alert contract). This log holds the two other kinds of entry
the "Ask Lumen" agent needs:

  {"type": "speech",   "ts": 1728540000.1, "zone": "kitchen", "text": "dinner's ready"}
      (lines heard by the headset have zone "wearer", plus "speaker": 1 and "to_you": true
       once the headset works out who said it)
  {"type": "sighting", "ts": 1728540000.1, "zone": "living",  "item": "keys",
   "confidence": 0.41, "thumb": "data:image/jpeg;base64,..."}

It lives in RAM on purpose: restart the brain and the house forgets. That's the privacy story.
"""
import time

from .eventlog import record

MAX_ENTRIES = 2000


class Memory:
    def __init__(self):
        self.entries: list[dict] = []

    def add(self, entry: dict) -> dict:
        entry.setdefault("ts", time.time())
        self.entries.append(entry)
        record(entry)
        del self.entries[:-MAX_ENTRIES]
        return entry

    def add_speech(self, zone: str, text: str, ts: float | None = None) -> dict:
        return self.add({"type": "speech", "zone": zone, "text": text.strip(), "ts": ts or time.time()})

    def add_sighting(self, zone: str, item: str, confidence: float, thumb: str | None = None,
                     ts: float | None = None) -> dict:
        ts = ts or time.time()
        last = self.last_seen(item)
        # Keys sitting on the table get seen every few seconds; refresh one entry instead of piling up.
        if last and last["zone"] == zone and ts - last["ts"] < 120:
            last.update(ts=ts, confidence=confidence, thumb=thumb or last["thumb"])
            return last
        return self.add({"type": "sighting", "zone": zone, "item": item, "confidence": confidence,
                         "thumb": thumb, "ts": ts})

    def tag_speech(self, ts: float, speaker: int | None, to_you: bool) -> dict | None:
        """The headset says who said a line (person number) and whether they faced the wearer."""
        for e in reversed(self.entries):
            if e["type"] == "speech" and abs(e["ts"] - ts) < 0.001:
                e.update(speaker=speaker, to_you=to_you)
                record({"type": "caption_meta", "ts": ts, "speaker": speaker, "to_you": to_you})
                return e
        return None

    def speech(self, zone: str | None = None, since: float = 0, limit: int = 20) -> list[dict]:
        hits = [e for e in self.entries if e["type"] == "speech" and e["ts"] >= since
                and (zone is None or e["zone"] == zone)]
        return hits[-limit:]

    def last_seen(self, item: str) -> dict | None:
        for e in reversed(self.entries):
            if e["type"] == "sighting" and e["item"] == item:
                return e
        return None

    def items_seen(self) -> list[str]:
        return sorted({e["item"] for e in self.entries if e["type"] == "sighting"})

    def clear(self):
        self.entries.clear()


def seed_demo(memory: "Memory", now: float | None = None):
    """Believable history for rehearsing the agent before the models run on real phones."""
    now = now or time.time()
    memory.add_sighting("kitchen", "wallet", 0.52, ts=now - 3 * 3600)
    memory.add_speech("living", "I'm heading out, back around six.", ts=now - 2 * 3600)
    memory.add_sighting("hallway", "keys", 0.38, ts=now - 95 * 60)
    memory.add_speech("kitchen", "Can you grab milk on the way home?", ts=now - 40 * 60)
    memory.add_sighting("living", "keys", 0.47, ts=now - 12 * 60)
    memory.add_sighting("bedroom", "glasses", 0.44, ts=now - 8 * 60)
    memory.add_speech("wearer", "Your appointment with Dr. Patel moved to Thursday at 2.", ts=now - 5 * 60)
    memory.tag_speech(now - 5 * 60, 1, True)
    memory.add_speech("wearer", "Did you take the blue pill this morning?", ts=now - 4 * 60)
    memory.tag_speech(now - 4 * 60, 2, True)
    memory.add_speech("kitchen", "Dinner's ready, come eat!", ts=now - 90)
