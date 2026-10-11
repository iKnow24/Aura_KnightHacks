"""ask_genie: Gemini's history tool. No real Databricks or Gemini calls."""
import json
import sys
import types

from app import agent, genie
from app.memory import Memory


def _set_genie(monkeypatch, on=True):
    for key in ("DATABRICKS_HOST", "DATABRICKS_TOKEN", "GENIE_SPACE_ID"):
        monkeypatch.delenv(key, raising=False)
    if on:
        monkeypatch.setenv("DATABRICKS_HOST", "https://example.cloud.databricks.com")
        monkeypatch.setenv("DATABRICKS_TOKEN", "token")
        monkeypatch.setenv("GENIE_SPACE_ID", "space1")


def test_ask_genie_is_hidden_until_all_three_vars_are_set(monkeypatch):
    _set_genie(monkeypatch, on=False)
    assert genie.configured() is False
    assert "ask_genie" not in {t["function"]["name"] for t in agent.llm_tools()}
    monkeypatch.setenv("DATABRICKS_HOST", "https://example.cloud.databricks.com")
    monkeypatch.setenv("DATABRICKS_TOKEN", "token")
    assert genie.configured() is False
    _set_genie(monkeypatch, on=True)
    assert "ask_genie" in {t["function"]["name"] for t in agent.llm_tools()}


def test_genie_returns_the_text_attachment(monkeypatch):
    _set_genie(monkeypatch)
    calls = []

    def fetch(method, url, token, body=None):
        calls.append((method, url))
        if method == "POST":
            return {"conversation": {"id": "c1"}, "message": {"message_id": "m1", "status": "ASKING_AI"}}
        return {"status": "COMPLETED", "attachments": [
            {"attachment_id": "a1", "text": {"content": "Worth a call. 15 missed versus 5."}}]}

    out = genie.ask("Is Mom doing okay this week?", fetch=fetch, sleep=lambda _s: None)
    assert out["ok"] is True and "15 missed" in out["answer"]
    assert calls[0][0] == "POST" and calls[0][1].endswith("/spaces/space1/start-conversation")
    assert "/conversations/c1/messages/m1" in calls[1][1]


def test_genie_reads_query_rows_when_there_is_no_text(monkeypatch):
    _set_genie(monkeypatch)

    def fetch(method, url, token, body=None):
        if method == "POST":
            return {"conversation": {"id": "c1"}, "message": {"message_id": "m1", "status": "COMPLETED",
                    "attachments": [{"attachment_id": "q1", "query": {"query": "select 1"}}]}}
        return {"statement_response": {
            "manifest": {"schema": {"columns": [{"name": "missed_this_week"}, {"name": "missed_week_before"}]}},
            "result": {"data_array": [["15", "5"]]}}}

    out = genie.ask("how many did she miss", fetch=fetch, sleep=lambda _s: None)
    assert out == {"ok": True, "answer": "missed_this_week: 15, missed_week_before: 5"}


def test_genie_failure_has_no_numbers(monkeypatch):
    _set_genie(monkeypatch)

    def fetch(method, url, token, body=None):
        raise OSError("network blocked")

    out = genie.ask("Is Mom doing okay this week?", fetch=fetch, sleep=lambda _s: None)
    assert out["ok"] is False
    assert out["answer"] == genie.UNAVAILABLE
    assert not any(ch.isdigit() for ch in out["answer"])


def test_gemini_tool_loop_uses_ask_genie_and_does_not_invent_on_failure(monkeypatch):
    import app.agent as agent_mod

    def B(**kw):
        return types.SimpleNamespace(**kw)

    _set_genie(monkeypatch)
    monkeypatch.setenv("LUMEN_LLM", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    for key in ("GROQ_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY", "HF_TOKEN"):
        monkeypatch.delenv(key, raising=False)

    call = B(id="t1", function=B(name="ask_genie", arguments='{"question": "Is Mom okay this week?"}'))
    replies = [B(content=None, tool_calls=[call]),
               B(content="I couldn't get the home's history right now.", tool_calls=None)]
    sent = []

    class Client:
        def __init__(self, **kw):
            sent.append(kw["base_url"])
            self.chat = B(completions=B(create=self.create))

        def create(self, **kw):
            sent.append(kw)
            return B(choices=[B(message=replies.pop(0))])

    monkeypatch.setitem(sys.modules, "openai", types.SimpleNamespace(OpenAI=Client))
    monkeypatch.setattr(agent_mod.genie, "ask", lambda *a, **k: genie._unavailable())
    result = agent_mod.answer("Is Mom doing okay this week?", Memory(), [])
    assert result["brain"] == "gemini" and result["evidence"] == []
    assert "googleapis.com" in sent[0]
    tools = {t["function"]["name"] for t in sent[1]["tools"]}
    assert "ask_genie" in tools
    tool_body = json.loads(sent[2]["messages"][-1]["content"])
    assert tool_body["ok"] is False and not any(ch.isdigit() for ch in tool_body["answer"])
    assert "ask_genie" in sent[1]["messages"][0]["content"]
