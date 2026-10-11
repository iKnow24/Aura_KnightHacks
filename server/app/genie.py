"""Ask Databricks Genie a history question and bring back its plain-language answer.

Genie is the caregiver history (this week vs last week). The brain calls it only when
DATABRICKS_HOST, DATABRICKS_TOKEN and GENIE_SPACE_ID are all set. The AMD box's proxy
blocks databricks.com, so leave those unset there: the tool stays hidden and Ask Lumen
keeps answering from the local log. On a laptop that can reach Databricks, Gemini can
call ask_genie for week-long questions.
"""
import json
import logging
import os
import time
import urllib.error
import urllib.request

log = logging.getLogger("lumen.genie")

UNAVAILABLE = "I couldn't get the home's history right now."
_DONE = {"COMPLETED"}
_STOP = {"FAILED", "CANCELLED", "QUERY_RESULT_EXPIRED"}


def configured() -> bool:
    return all(os.environ.get(k) for k in ("DATABRICKS_HOST", "DATABRICKS_TOKEN", "GENIE_SPACE_ID"))


def ask(question: str, fetch=None, sleep=time.sleep, deadline: float = 25) -> dict:
    """{"ok": True, "answer": "..."} or a refusal with no counts in it."""
    if not configured():
        return _unavailable()
    fetch = fetch or _fetch
    host = _host()
    token = os.environ["DATABRICKS_TOKEN"]
    space = os.environ["GENIE_SPACE_ID"].strip()
    try:
        started = fetch("POST", f"{host}/api/2.0/genie/spaces/{space}/start-conversation",
                        token, {"content": question})
        message = started.get("message") or {}
        conversation_id = (started.get("conversation") or {}).get("id") or message.get("conversation_id")
        message_id = message.get("message_id") or message.get("id")
        if not conversation_id or not message_id:
            return _unavailable()
        message = _wait(fetch, host, token, space, conversation_id, message_id, message, sleep, deadline)
        if message.get("status") != "COMPLETED":
            return _unavailable()
        text = _answer_text(message)
        if not text:
            text = _rows_text(fetch, host, token, space, conversation_id, message_id, message)
        if not text:
            return _unavailable()
        return {"ok": True, "answer": text}
    except Exception as e:
        log.warning("genie call failed (%s)", type(e).__name__)
        return _unavailable()


def _unavailable() -> dict:
    return {"ok": False, "answer": UNAVAILABLE,
            "instruction": "Tell the person this. Do not invent counts, times, or names."}


def _host() -> str:
    host = os.environ["DATABRICKS_HOST"].rstrip("/")
    return host if host.startswith("http") else "https://" + host


def _wait(fetch, host, token, space, conversation_id, message_id, message, sleep, deadline):
    url = (f"{host}/api/2.0/genie/spaces/{space}/conversations/{conversation_id}"
           f"/messages/{message_id}")
    end = time.monotonic() + deadline
    while message.get("status") not in _DONE | _STOP:
        if time.monotonic() >= end:
            return message
        sleep(1)
        message = fetch("GET", url, token)
    return message


def _answer_text(message: dict) -> str:
    parts = []
    for attachment in message.get("attachments") or []:
        content = (attachment.get("text") or {}).get("content")
        if content and content.strip():
            parts.append(content.strip())
    return " ".join(parts)


def _rows_text(fetch, host, token, space, conversation_id, message_id, message) -> str:
    lines = []
    for attachment in message.get("attachments") or []:
        if "query" not in attachment or not attachment.get("attachment_id"):
            continue
        url = (f"{host}/api/2.0/genie/spaces/{space}/conversations/{conversation_id}"
               f"/messages/{message_id}/attachments/{attachment['attachment_id']}/query-result")
        try:
            payload = fetch("GET", url, token)
        except Exception:
            continue
        line = _format_rows(payload)
        if line:
            lines.append(line)
    return " ".join(lines)


def _format_rows(payload: dict) -> str:
    stmt = payload.get("statement_response") or payload
    cols = [c.get("name", "") for c in ((stmt.get("manifest") or {}).get("schema") or {}).get("columns") or []]
    data = (stmt.get("result") or {}).get("data_array") or []
    bits = []
    for row in data[:5]:
        if cols:
            bits.append(", ".join(f"{c}: {v}" for c, v in zip(cols, row)))
        else:
            bits.append(", ".join(str(v) for v in row))
    return "; ".join(bits)


def _fetch(method: str, url: str, token: str, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:200]
        raise RuntimeError(f"genie HTTP {e.code}: {detail}") from None
