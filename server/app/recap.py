"""Lecture recap: turn a transcript into a summary, a memory map, and a short quiz.

The map is anchored in *when* each idea was said ("10:42, near the start"), because people
remember things by where and when they heard them. That's the "situational context".

A language model writes it when one is available (local GPU first, see llm.py). Without one,
plain rules still produce a usable recap: frequent words become branches, their sentences
become details, and the quiz blanks a key word out of a real sentence. Nothing is invented.
"""
import re
from collections import Counter

from . import llm

STOP = set("""
a about above after again against all also am an and any are aren't as at be because been before being below
between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few
for from further get gets getting got had hadn't has hasn't have haven't having he he'd he'll he's her here
here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself just
let's like me more most much must my myself no nor not now of off on once only or other ought our ours
ourselves out over own really right same say said says she she'd she'll she's should shouldn't so some such
than that that's the their theirs them themselves then there there's these they they'd they'll they're they've
thing things think this those through to too under until up very was wasn't we we'd we'll we're we've were
weren't what what's when when's where where's which while who who's whom why why's will with won't would
wouldn't you you'd you'll you're you've your yours yourself yourselves okay yeah yes gonna wanna going know
actually basically kind sort lot lots something anything everything well even still back make made want
one two three first next today going look see way time
""".split())

NAME_RE = re.compile(r"\b(?i:my name is|my name's|I'm|I am|this is|call me)\s+([A-Z][a-z]{2,})")
NOT_NAMES = {"Going", "Not", "Just", "Really", "Here", "Sure", "Sorry", "Done", "Back", "From", "The", "Gonna",
             "Glad", "Good", "Fine", "Okay", "Trying", "Looking", "Working", "Talking", "So", "Very"}


def sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+|\n+", text)
    return [p.strip() for p in parts if len(p.split()) >= 3]


def keywords(text: str, n: int = 8) -> list[str]:
    words = re.findall(r"[a-z][a-z'-]{3,}", text.lower())
    counts = Counter(w for w in words if w not in STOP)
    return [w for w, _ in counts.most_common(n)]


def first_ts(word: str, segments: list[dict]) -> float | None:
    for s in segments:
        if re.search(rf"\b{re.escape(word.lower())}", s["text"].lower()):
            return s.get("ts")
    return None


def people(text: str) -> list[str]:
    """Names people said out loud ("I'm Dana"). From speech only, never from faces."""
    out = []
    for name in NAME_RE.findall(text):
        if name not in NOT_NAMES and name not in out:
            out.append(name)
    return out


def recap_rules(text: str, segments: list[dict], title: str) -> dict:
    sents = sentences(text) or [text.strip()]
    keys = keywords(text)
    freq = Counter(re.findall(r"[a-z][a-z'-]{3,}", text.lower()))

    def score(s):
        ws = re.findall(r"[a-z][a-z'-]{3,}", s.lower())
        return sum(freq[w] for w in ws if w in keys) / (len(ws) ** 0.5 + 1)

    top = sorted(sorted(range(len(sents)), key=lambda i: -score(sents[i]))[:3])
    summary = " ".join(sents[i] for i in top)

    branches = []
    for k in keys[:5]:
        details = sorted((s for s in sents if re.search(rf"\b{re.escape(k)}", s.lower())), key=len)[:2]
        branches.append({"label": k.capitalize(), "ts": first_ts(k, segments), "details": details})

    quiz = []
    for i, k in enumerate(keys[:4]):
        sent = next((s for s in sorted(sents, key=len) if re.search(rf"\b{re.escape(k)}\b", s.lower())
                     and len(s.split()) <= 30), None)
        others = [o for o in keys if o != k]
        others = (others[i:] + others[:i])[:3]  # different wrong answers per question
        if not sent or len(others) < 2:
            continue
        blank = re.sub(rf"\b{re.escape(k)}\b", "_____", sent, flags=re.I)
        choices = others[:]
        pos = i % (len(choices) + 1)
        choices.insert(pos, k)
        quiz.append({"q": f"Fill in the blank: {blank}", "choices": choices, "answer": pos})

    points = list(dict.fromkeys(d for b in branches for d in b["details"][:1]))
    return {"title": title, "summary": summary, "points": points,
            "map": {"center": title, "branches": branches}, "quiz": quiz}


SYSTEM = ("You help a hard-of-hearing student remember a lecture they just watched through live captions. "
          "Use only facts in the transcript; never add outside facts. Reply with JSON only, no prose, shaped: "
          '{"title": str (max 6 words), "summary": str (2-3 sentences), "points": [str] (3-5 short), '
          '"branches": [{"label": str (1-3 words), "details": [str] (1-2 short)}] (3-6), '
          '"quiz": [{"q": str, "choices": [str] (4), "answer": int (index of the right choice)}] (3)}')


def clean_llm(data: dict, segments: list[dict], fallback: dict) -> dict | None:
    """Keep only well-formed parts of the model's answer; None if it's unusable."""
    try:
        branches = [{"label": str(b["label"])[:40], "details": [str(d) for d in b.get("details", [])][:2],
                     "ts": first_ts(str(b["label"]).split()[0], segments)}
                    for b in data.get("branches", []) if b.get("label")][:6]
        quiz = [{"q": str(q["q"]), "choices": [str(c) for c in q["choices"]][:4], "answer": int(q["answer"])}
                for q in data.get("quiz", []) if 0 <= int(q.get("answer", -1)) < min(4, len(q.get("choices", [])))]
        if not branches or not data.get("summary"):
            return None
        title = str(data.get("title") or fallback["title"])[:60]
        return {"title": title, "summary": str(data["summary"]),
                "points": [str(p) for p in data.get("points", [])][:5] or fallback["points"],
                "map": {"center": title, "branches": branches}, "quiz": quiz[:4] or fallback["quiz"]}
    except (KeyError, TypeError, ValueError):
        return None


def recap(segments: list[dict], title: str = "Lecture", use_llm: bool = True) -> dict:
    segments = [s for s in segments if s.get("text", "").strip()]
    text = " ".join(s["text"].strip() for s in segments)
    if len(text.split()) < 8:
        return {"title": title, "summary": "Not enough was said to recap yet.", "points": [],
                "map": {"center": title, "branches": []}, "quiz": [], "people": [], "brain": "rules"}
    base = recap_rules(text, segments, title)
    result, brain = base, "rules"
    if use_llm:
        data, name = llm.chat_json(SYSTEM, f"Lecture transcript:\n{text[:12000]}")
        cleaned = clean_llm(data, segments, base) if data else None
        if cleaned:
            result, brain = cleaned, name
    return {**result, "people": people(text), "brain": brain}
