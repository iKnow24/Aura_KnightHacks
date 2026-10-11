import time

import numpy as np
from fastapi.testclient import TestClient

from app import main
from app.agent import answer_rules
from app.detectors.speech import SAMPLE_RATE, Segmenter, clean, mentions_name
from app.memory import Memory, seed_demo


def test_keys_answer_uses_latest_sighting():
    m = Memory()
    seed_demo(m)
    r = answer_rules("where are my keys?", m, [])
    assert "living room" in r["answer"] and r["evidence"][0]["item"] == "keys"


def test_unknown_item_says_not_seen():
    r = answer_rules("Where did I leave my wallet", Memory(), [])
    assert "haven't seen" in r["answer"]


def test_last_thing_said_quotes_newest_line():
    m = Memory()
    seed_demo(m)
    r = answer_rules("What was the last thing said?", m, [])
    assert "Dinner's ready" in r["answer"] and "kitchen" in r["answer"]


def test_room_filter_on_speech():
    m = Memory()
    seed_demo(m)
    r = answer_rules("what did they say in the living room", m, [])
    assert "Thursday" in r["answer"]


def test_recap_lists_alerts():
    events = [{"kind": "doorbell", "zone": "hallway", "severity": "warning", "ts": time.time() - 600}]
    r = answer_rules("what happened while I was asleep?", Memory(), events)
    assert "doorbell" in r["answer"] and "hallway" in r["answer"]


def test_repeated_sightings_collapse():
    m = Memory()
    m.add_sighting("living", "keys", 0.3)
    m.add_sighting("living", "keys", 0.4)
    m.add_sighting("kitchen", "keys", 0.4)
    assert len(m.entries) == 2 and m.last_seen("keys")["zone"] == "kitchen"


def test_segmenter_cuts_after_silence_and_skips_blips():
    seg = Segmenter(threshold=0.01)
    chunk = 4096
    talk = (0.1 * np.random.randn(chunk)).astype(np.float32)
    quiet = np.zeros(chunk, np.float32)
    out = [seg.feed(talk) for _ in range(5)] + [seg.feed(quiet) for _ in range(5)]
    done = [o for o in out if o is not None]
    assert len(done) == 1 and len(done[0]) >= SAMPLE_RATE
    # One short click is not speech.
    assert all(seg.feed(c) is None for c in [talk] + [quiet] * 5)


def test_whisper_ghosts_dropped_and_name_match():
    assert clean(" Thank you. ") is None
    assert clean("Sharan, dinner!") == "Sharan, dinner!"
    assert mentions_name("Hey sharan, come here", "Sharan")
    assert not mentions_name("sharanya is here", "Sharan")


def test_ask_endpoint_with_seeded_memory():
    client = TestClient(main.app)
    client.delete("/api/memory")
    client.post("/api/memory/seed")
    r = client.post("/api/ask", json={"question": "where are my keys"}).json()
    assert "living room" in r["answer"] and r["evidence"][0]["thumb"] is None
    assert client.post("/api/profile", json={"name": " Sharan "}).json()["name"] == "Sharan"


def test_llm_brain_tool_loop(monkeypatch):
    """Fake OpenAI-style client: asks for last_seen(keys), then answers. Checks evidence flows back."""
    import sys
    import types
    from app import agent

    def B(**kw): return types.SimpleNamespace(**kw)

    call = B(id="t1", function=B(name="last_seen", arguments='{"item": "keys"}'))
    replies = [B(content=None, tool_calls=[call]), B(content="In the living room, 12 minutes ago.", tool_calls=None)]
    sent = []

    class Client:
        def __init__(self, **kw):
            sent.append(kw["base_url"])
            self.chat = B(completions=B(create=self.create))
        def create(self, **kw):
            sent.append(kw["messages"][-1])
            return B(choices=[B(message=replies.pop(0))])

    monkeypatch.setitem(sys.modules, "openai", types.SimpleNamespace(OpenAI=Client))
    monkeypatch.delenv("LUMEN_LLM", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("GROQ_API_KEY", "x")
    m = Memory()
    seed_demo(m)
    r = agent.answer("yo where'd my keys go", m, [])
    assert r["brain"] == "groq" and "groq.com" in sent[0] and "living room" in r["answer"]
    assert r["evidence"][0]["item"] == "keys"
    assert "thumb" not in sent[-1]["content"]  # photos never sent to the model


def test_provider_choice(monkeypatch):
    from app.agent import pick_provider

    for k in ("GROQ_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY", "HF_TOKEN", "LUMEN_LLM", "LUMEN_LLM_MODEL"):
        monkeypatch.delenv(k, raising=False)
    assert pick_provider() is None
    monkeypatch.setenv("HF_TOKEN", "h")
    name, url, key, model = pick_provider()
    assert name == "hf" and "huggingface.co" in url and key == "h" and model == "openai/gpt-oss-20b"
    monkeypatch.setenv("XAI_API_KEY", "x")
    assert pick_provider()[0] == "xai"
    monkeypatch.setenv("GROQ_API_KEY", "g")
    assert pick_provider()[0] == "groq"
    monkeypatch.setenv("LUMEN_LLM", "xai")
    assert pick_provider()[0] == "xai"
    monkeypatch.setenv("LUMEN_LLM", "hf")
    assert pick_provider()[0] == "hf"
    monkeypatch.setenv("LUMEN_LLM", "off")
    assert pick_provider() is None


def test_wav_encoding():
    from app.detectors.speech import to_wav
    assert to_wav(np.zeros(SAMPLE_RATE, np.float32))[:4] == b"RIFF"


def test_said_to_me_prefers_lines_facing_the_wearer():
    m = Memory()
    seed_demo(m)
    r = answer_rules("what was said to me?", m, [])
    assert "blue pill" in r["answer"] and "to you" in r["answer"]
    # The plain question still gives the newest line from anywhere.
    assert "Dinner" in answer_rules("what was the last thing said", m, [])["answer"]


def test_conversations_reload_from_disk_without_photos(tmp_path):
    path = tmp_path / "conversations.jsonl"
    m = Memory(path)
    m.add_speech("kitchen", "Dinner is ready")
    m.add_sighting("living", "keys", 0.4, thumb="data:image/jpeg;base64,xx")
    saved = path.read_text()
    assert "Dinner is ready" in saved and "base64" not in saved
    again = Memory(path)
    assert len(again.entries) == 1 and again.entries[0]["zone"] == "kitchen"
    e = again.entries[0]
    again.tag_speech(e["ts"], 1, True)
    tagged = Memory(path)
    assert tagged.entries[0]["speaker"] == 1 and tagged.entries[0]["to_you"] is True
    tagged.clear()
    assert Memory(path).entries == []


def test_headset_speech_skips_alarm_detectors_and_takes_caption_meta(monkeypatch):
    client = TestClient(main.app)
    client.delete("/api/memory")
    entry = main.memory.add_speech("wearer", "Your pills are on the counter")
    seen = []
    monkeypatch.setattr(main.alarm_dsp, "is_alarm", lambda buf: seen.append(1) or False)
    with client.websocket_connect("/ws/dashboard") as dash, client.websocket_connect("/ws/node/h1?zone=wearer") as node:
        dash.receive_json(); node.receive_json()
        node.send_bytes(np.zeros(SAMPLE_RATE * 4, np.float32).tobytes())
        node.send_text('{"type": "caption_meta", "ts": %r, "speaker": 2, "to_you": true}' % entry["ts"])
        msg = dash.receive_json()
        while msg['type'] == 'state':
            msg = dash.receive_json()
    assert msg["type"] == "caption" and msg["to_you"] and msg["speaker"] == 2
    assert not seen
