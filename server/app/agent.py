"""Ask Lumen: answers questions about the house from the memory log and the alert timeline.

Two brains, same tools:
- With an LLM key set (Groq, Claude, xAI, Gemini or Hugging Face; see PROVIDERS), the model gets three tools
  (last_seen, transcript, alerts) and decides which to call, so free-form questions work
  ("did anyone say anything about milk?").
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
               "fall": "a possible fall", "glass_break": "glass breaking", "baby_cry": "a baby crying",
               "timer": "a timer go off", "kettle": "the kettle", "phone_ring": "the phone ring", "knock": "a knock",
               "alarm_clock": "an alarm clock", "water_running": "water left running", "dog_bark": "the dog bark",
               "car_horn": "a car horn", "siren": "a siren", "vehicle": "a car approaching",
               "person_behind": "someone come up behind you", "vehicle_behind": "a vehicle come up behind you",
               "spill": "something spill"}

ZONE_NAMES = {"living": "living room", "wearer": "room with you"}


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
    return {"lines": [{"zone": e["zone"], "text": e["text"], "ago": ago(e["ts"]),
                       "said_to_you": e.get("to_you", False), "speaker": e.get("speaker"),
                       "voice": e.get("voice")} for e in lines],
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
        lines = tool_transcript(memory, zone=zone, minutes=24 * 60, limit=20)["entries"]
        if re.search(r"\b(to me|told me)\b", q):
            lines = [e for e in lines if e.get("to_you")] or lines
        lines = lines[-3:]
        if not lines:
            where = f" in the {room(zone)}" if zone else ""
            return {"answer": f"I haven't heard anyone speak{where} yet.", "evidence": []}
        last = lines[-1]
        where = "to you" if last.get("to_you") else f"in the {room(last['zone'])}"
        return {"answer": f"“{last['text']}”, {where}, {ago(last['ts'])}.",
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


# ---- LLM brain --------------------------------------------------------------------------
# Any provider with an OpenAI-compatible API works through the same client. Pick one with
# LUMEN_LLM=groq|claude|xai|gemini|hf|off, or leave it unset to use the first one that has a key.

PROVIDERS = {
    # name: (base URL, env var holding the key, default model)
    "groq": ("https://api.groq.com/openai/v1", "GROQ_API_KEY", "openai/gpt-oss-20b"),  # free tier
    "claude": ("https://api.anthropic.com/v1/", "ANTHROPIC_API_KEY", "claude-haiku-5-5"),
    "xai": ("https://api.x.ai/v1", "XAI_API_KEY", "grok-4.7"),
    # Google Gemini through its OpenAI-compatible endpoint (key from aistudio.google.com).
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai/", "GEMINI_API_KEY", "gemini-2.5-flash"),
    # Hugging Face Inference Providers: one HF token, many open models. Last, so it never
    # takes over from Groq when both keys are set; pick it with LUMEN_LLM=hf.
    "hf": ("https://router.huggingface.co/v1", "HF_TOKEN", "openai/gpt-oss-20b"),
}


def pick_provider() -> tuple[str, str, str, str] | None:
    """(name, base_url, api_key, model) for the configured provider, or None for keyword answers."""
    choice = os.environ.get("LUMEN_LLM", "").lower()
    if choice == "off":
        return None
    for name in [choice] if choice in PROVIDERS else list(PROVIDERS):
        url, key_env, model = PROVIDERS[name]
        if os.environ.get(key_env):
            return name, url, os.environ[key_env], os.environ.get("LUMEN_LLM_MODEL", model)
    return None


def fn(name: str, description: str, properties: dict, required: list | None = None) -> dict:
    return {"type": "function", "function": {"name": name, "description": description, "parameters": {
        "type": "object", "properties": properties, "required": required or []}}}


TOOLS = [
    fn("last_seen", "Where and when a household item was last seen by a room camera.",
       {"item": {"type": "string", "enum": list(ITEM_WORDS)}}, ["item"]),
    fn("transcript", "What people said out loud, newest last. Optionally one room.",
       {"zone": {"type": "string", "enum": ["kitchen", "living", "bedroom", "hallway", "wearer"]},
        "minutes": {"type": "number", "description": "How far back to look. Default 60."}}),
    fn("alerts", "Safety alerts (smoke alarm, doorbell, fall, name called...) in the last N hours.",
       {"hours": {"type": "number"}}),
]

SYSTEM = ("You are Lumen, the memory of a home. You help a deaf or hard-of-hearing person, often an older adult, "
          "keep up with what was said around them. Answer in one to three short sentences, warm and plain, like a "
          "patient family member. No markdown, no jargon. If someone asked them a question or told them something to "
          "do (a time, a pill, an appointment), say that clearly first. Only state what the tools return; if they "
          "return nothing, say you haven't seen or heard it. Say times as relative ('12 minutes ago'). "
          "Zone 'living' is the living room; zone 'wearer' means said in the same room as the user, and "
          "said_to_you=true means the speaker was facing them. voice is who said it, when known (a name, or "
          "'Person 4' for someone whose name we don't know).")


def run_tool(name: str, args: dict, memory: Memory, events: list[dict]) -> dict:
    if name == "last_seen":
        r = tool_last_seen(memory, args.get("item", ""))
        r["entries"] = [r.pop("entry")] if "entry" in r else []
        return r
    if name == "transcript":
        return tool_transcript(memory, args.get("zone"), args.get("minutes", 60))
    return tool_alerts(events, args.get("hours", 12))


def answer_llm(question: str, memory: Memory, events: list[dict]) -> dict | None:
    provider = pick_provider()
    if not provider:
        return None
    name, base_url, key, model = provider
    try:
        from openai import OpenAI
    except ImportError:
        return None
    client = OpenAI(base_url=base_url, api_key=key, timeout=15)
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": question}]
    evidence: list[dict] = []
    try:
        for _ in range(4):
            msg = client.chat.completions.create(model=model, max_tokens=400, tools=TOOLS,
                                                 messages=messages).choices[0].message
            if not msg.tool_calls:
                return {"answer": (msg.content or "").strip(), "evidence": evidence, "brain": name}
            messages.append({"role": "assistant", "content": msg.content or "", "tool_calls": [
                {"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments}}
                for c in msg.tool_calls]})
            for c in msg.tool_calls:
                r = run_tool(c.function.name, json.loads(c.function.arguments or "{}"), memory, events)
                evidence += r.pop("entries")
                # The model only gets the facts, never the photos.
                messages.append({"role": "tool", "tool_call_id": c.id, "content": json.dumps(r)})
    except Exception as e:
        log.warning("%s call failed, using keyword answers (%s)", name, e)
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
