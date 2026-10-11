"""Hazard notes: a plain-words "watch out" for one camera still, written by Gemini.

This is advice, not an alert. It never fires the strobe or an alert card, and nothing here decides
whether a safety alert happens (CLAUDE.md: detectors are deterministic or classifier + threshold).
The dashboard shows it as a small line along the bottom of its camera tile, labelled as an AI note.

Privacy: the still goes to Google, so this is opt-in. Nothing calls it until someone presses the
"AI hazard check" button on the dashboard, and it only works when a Gemini key is set on the brain
(GEMINI_API_KEY, LUMEN_LLM=gemini). The photo is sent, answered, and dropped: it is never stored,
only the note text is kept in the event log.
"""
import json
import logging
import re
import time

from .agent import pick_provider

log = logging.getLogger(__name__)

MIN_GAP_S = 6  # whatever the page asks, never call the model more often than this

PROMPT = (
    "This is one still from a camera in a home. The people it protects are deaf or hard of hearing. "
    "Name at most two things in the picture that are a safety hazard right now: an object close to the "
    "edge of a table, shelf or counter that could fall; something that could start a fire (a lit stove or "
    "candle, a pan left on heat, a cord or cloth near heat, something overloaded in a socket); something "
    "on the floor to trip on; liquid spilled on the floor. Only name what you can clearly see; if "
    "nothing is a hazard, return an empty list. Do not describe people or guess who anyone is. "
    'Reply with JSON only: {"notes": [{"label": "short name, e.g. cup at table edge", '
    '"where": "e.g. left side of the table", "why": "under 8 words"}]}'
)

_last_call = 0.0


def available() -> bool:
    provider = pick_provider()
    return bool(provider and provider[0] == "gemini")


def parse(text: str) -> list[dict]:
    """The model's reply -> at most two clean notes. Anything unreadable means no notes."""
    match = re.search(r"\{.*\}", text or "", re.S)
    try:
        raw = json.loads(match.group(0)).get("notes", []) if match else []
    except (ValueError, AttributeError):
        return []
    notes = []
    for n in raw if isinstance(raw, list) else []:
        if isinstance(n, dict) and str(n.get("label", "")).strip():
            notes.append({k: str(n.get(k, "")).strip()[:80] for k in ("label", "where", "why")})
    return notes[:2]


def look(jpeg: str) -> dict:
    """{"enabled": bool, "notes": [...], "wait": bool}. Blocking: run it in a thread."""
    global _last_call
    provider = pick_provider()
    if not provider or provider[0] != "gemini":
        return {"enabled": False, "notes": []}
    if time.time() - _last_call < MIN_GAP_S:
        return {"enabled": True, "notes": [], "wait": True}
    _last_call = time.time()
    try:
        from openai import OpenAI
    except ImportError:
        return {"enabled": False, "notes": [], "error": "the openai package isn't installed on the brain"}
    _, url, key, model = provider
    try:
        reply = OpenAI(base_url=url, api_key=key, timeout=25).chat.completions.create(
            model=model, max_tokens=250,
            messages=[{"role": "user", "content": [
                {"type": "text", "text": PROMPT},
                {"type": "image_url", "image_url": {"url": jpeg}},
            ]}])
        return {"enabled": True, "notes": parse(reply.choices[0].message.content), "model": model}
    except Exception as e:  # a bad key or no network must not take the dashboard down
        log.warning("hazard note failed (%s)", e)
        return {"enabled": True, "notes": [], "error": "Luma didn't answer"}
