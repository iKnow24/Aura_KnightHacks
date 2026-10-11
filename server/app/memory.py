"""The house's memory: a timestamped log of what was said and where things were last seen.

Alerts stay in hub.events (the alert contract). This log holds the two other kinds of entry
the "Ask Lumen" agent needs:

  {"type": "speech",   "ts": 1728540000.1, "zone": "kitchen", "text": "dinner's ready"}
      (lines heard by the headset have zone "wearer", plus "speaker": 1 and "to_you": true
       once the headset works out who said it; "voice": "Sharan" / "Person 4" when the voice is known)
  {"type": "sighting", "ts": 1728540000.1, "zone": "living",  "item": "keys",
   "confidence": 0.41, "thumb": "data:image/jpeg;base64,..."}

Spoken lines are also written to a text file (no photos) so a restart keeps the conversation.
Item photos stay in RAM only.
"""
import json
import time
from pathlib import Path

from .eventlog import record

MAX_ENTRIES = 2000


class Memory:
    def __init__(self, path: Path | str | None = None):
        self.path = Path(path) if path else None
        self.entries: list[dict] = []
        self.load()

    def add(self, entry: dict) -> dict:
        entry.setdefault("ts", time.time())
        self.entries.append(entry)
        record(entry)
        del self.entries[:-MAX_ENTRIES]
        if entry.get("type") == "speech":
            self.save()
        return entry

    def save(self):
        """Rewrite the conversation file from the lines still in memory. Photos are left out."""
        if not self.path:
            return
        lines = []
        for e in self.entries:
            if e.get("type") != "speech" or not e.get("text"):
                continue
            line = {"type": "speech", "ts": e["ts"], "zone": e.get("zone", "wearer"), "text": e["text"]}
            if e.get("place"):
                line["place"] = e["place"]
            if e.get("voice"):
                line["voice"] = e["voice"]
            if "speaker" in e:
                line["speaker"] = e["speaker"]
            if e.get("to_you"):
                line["to_you"] = True
            lines.append(json.dumps(line))
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(("\n".join(lines) + "\n") if lines else "")
        except OSError as e:  # a full disk must never stop a caption
            print("conversation log error:", e)

    def load(self):
        if not self.path or not self.path.exists():
            return
        try:
            raw = self.path.read_text()
        except OSError:
            return
        for line in raw.splitlines():
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if e.get("type") == "speech" and e.get("text"):
                self.entries.append(e)
        del self.entries[:-MAX_ENTRIES]

    def add_speech(self, zone: str, text: str, ts: float | None = None, place: str | None = None,
                   voice: str | None = None) -> dict:
        entry = {"type": "speech", "zone": zone, "text": text.strip(), "ts": ts or time.time()}
        if place:
            entry["place"] = place
        if voice:  # "Sharan" or "Person 4", from detectors/voices.py
            entry["voice"] = voice
        return self.add(entry)

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
                self.save()
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
        self.save()


def seed_demo(memory: "Memory", now: float | None = None):
    """Believable history for rehearsing the agent before the models run on real phones."""
    now = now or time.time()
    memory.add_sighting("kitchen", "wallet", 0.52, ts=now - 3 * 3600)
    memory.add_speech("living", "I'm heading out, back around six.", ts=now - 2 * 3600, place="Front door")
    memory.add_sighting("hallway", "keys", 0.38, ts=now - 95 * 60)
    memory.add_speech("kitchen", "Can you grab milk on the way home?", ts=now - 40 * 60, place="Table")
    memory.add_sighting("living", "keys", 0.47, ts=now - 12 * 60)
    memory.add_sighting("bedroom", "glasses", 0.44, ts=now - 8 * 60)
    memory.add_speech("bedroom", "I put your glasses on the nightstand.", ts=now - 7 * 60, place="Nightstand")
    memory.add_speech("hallway", "Your package is on the porch.", ts=now - 6 * 60, place="Porch")
    memory.add_speech("living", "Your appointment with Dr. Patel moved to Thursday at 2.", ts=now - 5 * 60, place="Sofa")
    memory.tag_speech(now - 5 * 60, 1, True)
    memory.add_speech("kitchen", "Did you take the blue pill this morning?", ts=now - 4 * 60, place="Table")
    memory.tag_speech(now - 4 * 60, 2, True)
    memory.add_speech("kitchen", "Dinner's ready, come eat!", ts=now - 90, place="Stove")
