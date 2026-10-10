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
    assert "heading out" in r["answer"]


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


def test_claude_brain_tool_loop(monkeypatch):
    """Fake Anthropic client: asks for last_seen(keys), then answers. Checks evidence flows back."""
    import sys
    import types
    from app import agent

    class B:
        def __init__(self, **kw): self.__dict__.update(kw)

    replies = [
        B(stop_reason="tool_use", content=[B(type="tool_use", id="t1", name="last_seen", input={"item": "keys"})]),
        B(stop_reason="end_turn", content=[B(type="text", text="In the living room, 12 minutes ago.")]),
    ]
    seen = []

    class Client:
        def __init__(self): self.messages = self
        def create(self, **kw):
            seen.append(kw["messages"][-1])
            return replies.pop(0)

    monkeypatch.setitem(sys.modules, "anthropic", types.SimpleNamespace(Anthropic=Client))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    m = Memory()
    seed_demo(m)
    r = agent.answer("yo where'd my keys go", m, [])
    assert r["brain"] == "claude" and "living room" in r["answer"]
    assert r["evidence"][0]["item"] == "keys"
    assert "thumb" not in seen[-1]["content"][0]["content"]  # photos never sent to the model
