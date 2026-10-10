"""Ask Lumen: answers questions about the house from the memory log and the alert timeline.

Two brains, same tools:
- With ANTHROPIC_API_KEY set, Claude gets three tools (last_seen, transcript, alerts) and
  decides which to call, so free-form questions work ("did anyone say anything about milk?").
- Without a key, or if the API call fails, a keyword router answers the core questions.
  The demo never depends on the network to answer "where are my keys".

Every answer comes back with the log entries it used as evidence, so the dashboard can show
the photo of the keys or the exact quote, and nothing is made up.
"""
import json
import logging
import os
import re
import time

from .memory import Memory

log = logging.getLogger(__name__)

LLM_MODEL = os.environ.get("LUMEN_LLM", "claude-haiku-5-5")

# Words people use -> the item name the camera logs. Keep in sync with detectors/items.py.
ITEM_WORDS = {
    "keys": ["key", "keys", "keychain"],
    "wallet": ["wallet", "purse"],
    "phone": ["phone", "cellphone", "cell"],
    "glasses": ["glasses", "spectacles", "specs"],
    "remote": ["remote", "tv remote", "clicker"],
    "headphones": ["headphones", "earbuds", "airpods"],
}

ZONE_WORDS = {"kitchen": "kitchen", "living": "living", "lounge": "living", "bedroom": "bedroom",
              "hall": "hallway", "hallway": "hallway", "door": "hallway"}

ALERT_NAMES = {"smoke_alarm": "a smoke alarm", "doorbell": "the doorbell", "name_called": "someone call your name",
               "fall": "a possible fall", "glass_break": "glass breaking", "baby_cry": "a baby crying"}

ZONE_NAMES = {"living": "living room"}


def ago(ts: float, now: float | None = None) -> str:
    s = max(0, int((now or time.time()) - ts))
    if s < 60:
        return "just now" if s < 10 else f"{s} seconds ago"
    if s < 3600:
        m = s // 60
        return f"{m} minute{'s' if m != 1 else ''} ago"
    h = s // 3600
    return f"{h} hour{'s' if h != 1 else ''} ago"


def room(zone: str) -> str:
    return ZONE_NAMES.get(zone, zone)


# ---- tools (shared by both brains) ------------------------------------------------------

def tool_last_seen(memory: Memory, item: str) -> dict:
    hit = memory.last_seen(item)
    if not hit:
        return {"found": False, "item": item, "items_tracked": memory.items_seen()}
    return {"found": True, "item": item, "zone": hit["zone"], "ts": hit["ts"], "ago": ago(hit["ts"]),
            "confidence": hit["confidence"], "entry": hit}


def tool_transcript(memory: Memory, zone: str | None = None, minutes: float = 60, limit: int = 10) -> dict:
    lines = memory.speech(zone=zone, since=time.time() - minutes * 60, limit=limit)
    return {"lines": [{"zone": e["zone"], "text": e["text"], "ts": e["ts"], "ago": ago(e["ts"])} for e in lines],
            "entries": lines}


def tool_alerts(events: list[dict], hours: float = 12) -> dict:
    since = time.time() - hours * 3600
    hits = [e for e in events if e["ts"] >= since]
    return {"alerts": [{"kind": e["kind"], "zone": e["zone"], "severity": e["severity"], "ago": ago(e["ts"])}
                       for e in hits], "entries": hits}


# ---- keyword brain ----------------------------------------------------------------------

def find_item(q: str) -> str | None:
    for item, words in ITEM_WORDS.items():
        if any(re.search(rf"\b{re.escape(w)}\b", q) for w in words):
            return item
    return None


def find_zone(q: str) -> str | None:
    for word, zone in ZONE_WORDS.items():
        if re.search(rf"\b{word}\b", q):
            return zone
    return None


def answer_rules(question: str, memory: Memory, events: list[dict]) -> dict:
    q = question.lower()
    item = find_item(q)

    if item and re.search(r"\b(where|find|seen|left|lost)\b", q):
        r = tool_last_seen(memory, item)
        if not r["found"]:
            return {"answer": f"I haven't seen your {item} yet. Point a room's camera where you usually leave them.",
                    "evidence": []}
        return {"answer": f"Your {item} were last seen in the {room(r['zone'])}, {r['ago']}.",
                "evidence": [r["entry"]]}

    if re.search(r"\b(said|say|saying|told|talk|spoke|heard|hear)\b", q):
        zone = find_zone(q)
        lines = tool_transcript(memory, zone=zone, minutes=24 * 60, limit=3)["entries"]
        if not lines:
            where = f" in the {room(zone)}" if zone else ""
            return {"answer": f"I haven't heard anyone speak{where} yet.", "evidence": []}
        last = lines[-1]
        return {"answer": f"“{last['text']}”, in the {room(last['zone'])}, {ago(last['ts'])}.",
                "evidence": lines}

    if re.search(r"\b(happen|happened|miss|missed|asleep|sleep|night|while|recap|anything|alerts?)\b", q):
        hits = tool_alerts(events, hours=12)["entries"]
        if not hits:
            return {"answer": "All quiet. No alerts in the last 12 hours.", "evidence": []}
        parts = [f"{ALERT_NAMES.get(e['kind'], e['kind'])} in the {room(e['zone'])} {ago(e['ts'])}" for e in hits[-4:]]
        return {"answer": f"{len(hits)} alert{'s' if len(hits) != 1 else ''}: " + "; ".join(parts) + ".",
                "evidence": hits[-4:]}

    return {"answer": "Try “Where are my keys?”, “What was the last thing said?”, "
                      "or “What happened while I was asleep?”", "evidence": []}


# ---- Claude brain -----------------------------------------------------------------------

TOOLS = [
    {"name": "last_seen", "description": "Where and when a household item was last seen by a room camera.",
     "input_schema": {"type": "object", "properties": {"item": {"type": "string", "enum": list(ITEM_WORDS)}},
                      "required": ["item"]}},
    {"name": "transcript", "description": "What people said out loud, newest last. Optionally one room.",
     "input_schema": {"type": "object", "properties": {
         "zone": {"type": "string", "enum": ["kitchen", "living", "bedroom", "hallway"]},
         "minutes": {"type": "number", "description": "How far back to look. Default 60."}}}},
    {"name": "alerts", "description": "Safety alerts (smoke alarm, doorbell, fall, name called...) in the last N hours.",
     "input_schema": {"type": "object", "properties": {"hours": {"type": "number"}}}},
]

SYSTEM = ("You are Lumen, the memory of a home that helps a deaf or hard-of-hearing person. Answer in one or two "
          "short sentences, plain words, no markdown. Only state what the tools return; if they return nothing, "
          "say you haven't seen or heard it. Say times as relative ('12 minutes ago'). Room 'living' is the living room.")


def answer_llm(question: str, memory: Memory, events: list[dict]) -> dict | None:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return None
    try:
        import anthropic
    except ImportError:
        return None
    client = anthropic.Anthropic()
    messages = [{"role": "user", "content": question}]
    evidence: list[dict] = []
    try:
        for _ in range(4):
            resp = client.messages.create(model=LLM_MODEL, max_tokens=300, system=SYSTEM, tools=TOOLS,
                                          messages=messages)
            if resp.stop_reason != "tool_use":
                text = "".join(b.text for b in resp.content if b.type == "text").strip()
                return {"answer": text, "evidence": evidence, "brain": "claude"}
            messages.append({"role": "assistant", "content": resp.content})
            results = []
            for b in resp.content:
                if b.type != "tool_use":
                    continue
                if b.name == "last_seen":
                    r = tool_last_seen(memory, b.input.get("item", ""))
                    evidence += [r["entry"]] if r.get("entry") else []
                elif b.name == "transcript":
                    r = tool_transcript(memory, b.input.get("zone"), b.input.get("minutes", 60))
                    evidence += r["entries"]
                else:
                    r = tool_alerts(events, b.input.get("hours", 12))
                    evidence += r["entries"]
                # The model never sees photos or raw entries, only the facts.
                slim = {k: v for k, v in r.items() if k not in ("entry", "entries")}
                results.append({"type": "tool_result", "tool_use_id": b.id, "content": json.dumps(slim)})
            messages.append({"role": "user", "content": results})
    except Exception as e:
        log.warning("Claude call failed, using keyword answers (%s)", e)
    return None


def answer(question: str, memory: Memory, events: list[dict]) -> dict:
    result = answer_llm(question, memory, events) or {**answer_rules(question, memory, events), "brain": "rules"}
    # Thumbnails make the evidence heavy; dedupe and keep the newest few.
    seen, out = set(), []
    for e in reversed(result["evidence"]):
        key = (e.get("type", "alert"), e["ts"])
        if key not in seen:
            seen.add(key)
            out.append(e)
    result["evidence"] = out[:4]
    return result
