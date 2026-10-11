"""Who's talking, by voice: teammates by name, everyone else as Person 4, Person 5, ...

Model: microsoft/wavlm-base-plus-sv from Hugging Face. It turns a stretch of speech into a
512-number "voiceprint"; two clips from the same person point the same way (cosine similarity
near 1). It's ungated and runs through transformers, which the AMD box already has.

How a name gets attached: someone says "my name is Sharan". That sentence's audio becomes Sharan's
voiceprint (CLAUDE.md: names only come from "my name is ..."). Everyone else is grouped by voice
by voice, numbered after the named people (three teammates enrolled -> the next voice is Person 4).

Privacy: named voiceprints (people who said "my name is", i.e. opted in) are saved to VOICE_FILE
(default ~/lumen_voices.json) so a brain restart doesn't make the team re-enroll. Unnamed voices
(Person 4, 5: judges, visitors) stay in RAM only and are never written anywhere.
POST /api/voices/forget wipes both, file included.
Nothing here looks at faces.

Accuracy, honestly: under ~1 s of speech ("yeah", "ok") a voiceprint is close to a guess, so those
lines get no label. When a voice is in between (not clearly a match, not clearly new) it also gets no
label: a blank is better than the wrong name on a judge's sentence.
"""
import json
import logging
import os
import re
import threading
from collections import deque

import numpy as np

log = logging.getLogger(__name__)

SAMPLE_RATE = 16_000
MODEL = os.environ.get("VOICE_MODEL", "microsoft/wavlm-base-plus-sv")
# Clip lengths include the 0.6 s pause the segmenter waits for, so 1.4 s is about 0.8 s of talking.
MIN_S = 1.4  # shorter lines get no voice label
ENROLL_MIN_S = 1.6  # "my name is Sam" needs at least this much audio to become a voiceprint
MAX_S = 8.0  # only the last 8 s of a long line are used
# Cosine similarity cut-offs. The model card uses 0.86 on clean audio; phone mics in a loud room score
# the same person lower, so we start a bit under. Tune on the box with GET /api/voices (recent scores).
MATCH = float(os.environ.get("VOICE_MATCH", "0.80"))  # at or above: same person
NEW = float(os.environ.get("VOICE_NEW", "0.70"))  # below this for everyone: a new Person number
VOICE_FILE = os.environ.get("VOICE_FILE", os.path.expanduser("~/lumen_voices.json"))  # "" = never save
MARGIN = 0.03  # the best name must beat the second best by this much
MAX_GUESTS = 8
KEEP = 20  # a voiceprint is the average of up to this many lines; later lines nudge it

MY_NAME_IS = re.compile(r"\bmy name(?: is|'s)\s+([A-Za-z]{2,})", re.IGNORECASE)
NOT_NAMES = {"not", "just", "going", "actually", "really", "also", "the", "a", "an", "so", "lumen", "um", "uh"}


def name_in(text: str) -> str | None:
    """'Hi, my name is sharan.' -> 'Sharan'."""
    m = MY_NAME_IS.search(text)
    if not m or m.group(1).lower() in NOT_NAMES:
        return None
    return m.group(1).capitalize()


def unit(v: np.ndarray) -> np.ndarray:
    return v / (np.linalg.norm(v) + 1e-9)


class VoiceBook:
    """The voiceprints, and the rules for matching a new line against them. Pure numpy, so it's testable."""

    def __init__(self, path: str | None = None):
        self.lock = threading.Lock()
        self.path = path  # where named voiceprints are saved; None = RAM only
        self.people: dict[str, dict] = {}  # name -> {"vec", "n"}
        self.guests: list[dict] = []  # {"label", "vec", "n"}, RAM only
        self.next_person = 1
        self.scores: deque = deque(maxlen=30)  # recent best scores, for tuning thresholds on the box
        self._read()

    def _read(self):
        try:
            with open(self.path) as f:
                saved = json.load(f)
            self.people = {k: {"vec": unit(np.array(v["vec"], np.float32)), "n": v["n"]} for k, v in saved.items()}
            log.info("Voice ID: remembered %s", ", ".join(self.people))
        except (TypeError, OSError, ValueError, KeyError):
            pass  # no file yet (or saving is off)

    def _save(self):
        if not self.path:
            return
        try:
            with open(self.path, "w") as f:
                json.dump({k: {"vec": v["vec"].tolist(), "n": v["n"]} for k, v in self.people.items()}, f)
        except OSError as e:
            log.warning("Voice ID: couldn't save voices (%s)", e)

    @staticmethod
    def _blend(entry: dict, vec: np.ndarray):
        n = min(entry["n"], KEEP - 1)
        entry["vec"] = unit(entry["vec"] * n + vec)
        entry["n"] += 1

    def enroll(self, name: str, vec: np.ndarray) -> dict:
        vec = unit(vec)
        with self.lock:
            if name in self.people:
                self._blend(self.people[name], vec)
            else:
                self.people[name] = {"vec": vec, "n": 1}
            # If this voice was already a Person number, that was this person all along: merge it in.
            for g in list(self.guests):
                if float(g["vec"] @ vec) >= MATCH:
                    self.guests.remove(g)
            self._save()
            return {"voice": name, "voice_known": True, "voice_score": 1.0, "enrolled": True}

    def identify(self, vec: np.ndarray) -> dict | None:
        vec = unit(vec)
        with self.lock:
            named = sorted(((float(p["vec"] @ vec), name) for name, p in self.people.items()), reverse=True)
            guests = sorted(((float(g["vec"] @ vec), i) for i, g in enumerate(self.guests)), reverse=True)
            best = max([s for s, _ in named[:1] + guests[:1]], default=-1.0)
            self.scores.append(round(best, 3))
            if named and named[0][0] >= MATCH:
                second = max([s for s, _ in named[1:2]] + [s for s, _ in guests[:1]], default=-1.0)
                if named[0][0] - second >= MARGIN:
                    score, name = named[0]
                    self._blend(self.people[name], vec)
                    return {"voice": name, "voice_known": True, "voice_score": round(score, 3)}
                return None  # two voices fit about equally: don't guess
            if guests and guests[0][0] >= MATCH:
                score, i = guests[0]
                self._blend(self.guests[i], vec)
                return {"voice": self.guests[i]["label"], "voice_known": False, "voice_score": round(score, 3)}
            if best >= NEW or len(self.guests) >= MAX_GUESTS:
                return None  # in between: not clearly anyone we know, not clearly someone new
            number = max(self.next_person, len(self.people) + 1)
            self.next_person = number + 1
            label = f"Person {number}"
            self.guests.append({"label": label, "vec": vec, "n": 1})
            return {"voice": label, "voice_known": False, "voice_score": round(max(best, 0.0), 3)}

    def forget(self):
        with self.lock:
            self.people.clear()
            self.guests.clear()
            self.scores.clear()
            self.next_person = 1
            if self.path and os.path.exists(self.path):
                os.remove(self.path)

    def summary(self) -> dict:
        """Names and line counts only; the voiceprints themselves never leave this object."""
        with self.lock:
            return {"people": [{"name": k, "lines": v["n"]} for k, v in self.people.items()],
                    "guests": [{"name": g["label"], "lines": g["n"]} for g in self.guests],
                    "recent_scores": list(self.scores), "match": MATCH, "new": NEW}


class Voices:
    """Loads the model lazily (like Whisper) and labels finished lines. Switches itself off if it can't load."""

    def __init__(self, embed=None):
        self.book = VoiceBook(VOICE_FILE or None)
        self._pipe = embed  # the embedding function; tests pass a fake
        self._failed = os.environ.get("VOICE_ID", "1") == "0"
        self._lock = threading.Lock()
        self._loading = threading.Lock()  # a caption arriving mid-startup waits instead of loading a second copy

    def available(self) -> bool:
        return self._load() is not None

    def _load(self):
        with self._loading:
            return self._load_once()

    def _load_once(self):
        if self._pipe is None and not self._failed:
            try:
                import torch
                from transformers import AutoFeatureExtractor, WavLMForXVector

                device = "cuda" if torch.cuda.is_available() else "cpu"  # ROCm shows up as "cuda"
                features = AutoFeatureExtractor.from_pretrained(MODEL)
                model = WavLMForXVector.from_pretrained(MODEL).to(device).eval()

                def embed(audio: np.ndarray) -> np.ndarray:
                    inputs = features(audio, sampling_rate=SAMPLE_RATE, return_tensors="pt").to(device)
                    with torch.no_grad():
                        return model(**inputs).embeddings[0].float().cpu().numpy()

                self._pipe = embed
                log.info("Voice ID %s loaded on %s", MODEL, device)
            except Exception as e:
                self._failed = True
                log.warning("Voice ID off (%s). Captions won't say who's talking.", e)
        return self._pipe

    def label(self, audio: np.ndarray, text: str) -> dict | None:
        """{"voice": "Sharan" | "Person 4", "voice_known": bool, "voice_score": float}, or None."""
        seconds = len(audio) / SAMPLE_RATE
        name = name_in(text)
        if seconds < (ENROLL_MIN_S if name else MIN_S):
            return None
        embed = self._load()
        if embed is None:
            return None
        with self._lock:  # one line at a time on the GPU
            vec = embed(audio[-int(MAX_S * SAMPLE_RATE):].astype(np.float32))
        return self.book.enroll(name, vec) if name else self.book.identify(vec)
