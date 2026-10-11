import asyncio
import numpy as np
from fastapi.testclient import TestClient

from app.detectors import alarm_dsp
from app.main import app

SR = alarm_dsp.SAMPLE_RATE


def t3_alarm(seconds=3.0):
    """Synthetic smoke alarm: 3.1 kHz beeps, 0.5 s on / 0.5 s off."""
    t = np.arange(int(SR * seconds)) / SR
    tone = np.sin(2 * np.pi * 3100 * t)
    gate = (t % 1.0) < 0.5
    return (tone * gate + 0.05 * np.random.randn(len(t))).astype(np.float32)


def test_alarm_dsp_fires_on_t3_pattern():
    assert alarm_dsp.is_alarm(t3_alarm())


def test_alarm_dsp_ignores_noise_and_speechlike_tone():
    noise = (0.3 * np.random.randn(SR * 3)).astype(np.float32)
    hum = np.sin(2 * np.pi * 300 * np.arange(SR * 3) / SR).astype(np.float32)
    assert not alarm_dsp.is_alarm(noise)
    assert not alarm_dsp.is_alarm(hum)


def test_fake_alert_reaches_strobe_in_night_mode():
    client = TestClient(app)
    client.post("/api/mode", json={"mode": "night"})
    with client.websocket_connect("/ws/strobe") as strobe:
        assert strobe.receive_json()["type"] == "state"
        client.post("/api/fake-alert", json={"kind": "smoke_alarm", "zone": "kitchen", "severity": "critical"})
        msg = strobe.receive_json()
        assert msg["type"] == "alert" and msg["zone"] == "kitchen"


def test_node_audio_triggers_real_alarm_alert():
    client = TestClient(app)
    client.post("/api/mode", json={"mode": "night"})
    with client.websocket_connect("/ws/strobe") as strobe, client.websocket_connect("/ws/node/k1?zone=kitchen") as node:
        strobe.receive_json(); node.receive_json()
        audio = t3_alarm()
        for i in range(0, len(audio), SR // 2):
            node.send_bytes(audio[i : i + SR // 2].tobytes())
        msg = strobe.receive_json()
        assert msg["source"] == "alarm_dsp" and msg["zone"] == "kitchen"


def test_headset_mic_triggers_alarm_with_no_model_and_no_api():
    client = TestClient(app)
    client.post("/api/mode", json={"mode": "night"})
    with client.websocket_connect("/ws/strobe") as strobe, client.websocket_connect("/ws/node/headset-z?zone=wearer") as node:
        strobe.receive_json(); node.receive_json()
        audio = t3_alarm()
        for i in range(0, len(audio), SR // 2):
            node.send_bytes(audio[i : i + SR // 2].tobytes())
        msg = strobe.receive_json()
        assert msg["source"] == "alarm_dsp" and msg["zone"] == "wearer" and msg["kind"] == "smoke_alarm"


def test_rear_scene_reaches_wearer_phone_as_rear_side():
    client = TestClient(app)
    with client.websocket_connect("/ws/hud") as hud, client.websocket_connect("/ws/node/rear-t?zone=behind") as node:
        hud.receive_json(); node.receive_json()
        node.send_json({"type": "scene", "objects": [{"kind": "car", "bearing": -10, "dist": 6.5}], "fov": 52})
        msg = hud.receive_json()
        assert msg["type"] == "scene" and msg["side"] == "rear" and msg["objects"][0]["kind"] == "car"


def test_whisper_loops_are_cut_to_one_copy():
    from app.detectors.speech import clean
    assert clean("I mean, " * 40) == "I mean,"
    assert clean("What did its name mean? " * 20) == "What did its name mean?"
    assert clean("No, no, no, it was") == "No, no, no, it was"  # people really say this
    assert clean("It's the green ball, it's the green ball.") == "It's the green ball, it's the green ball."


def test_partial_audio_only_once_someone_is_talking():
    import numpy as np
    from app.detectors.speech import SAMPLE_RATE, Segmenter
    seg = Segmenter(threshold=0.01)
    loud = np.full(SAMPLE_RATE // 4, 0.1, dtype=np.float32)
    seg.feed(loud)
    assert seg.so_far() is None  # a quarter second isn't enough yet
    for _ in range(3):
        seg.feed(loud)
    assert len(seg.so_far()) == SAMPLE_RATE
    for _ in range(4):
        seg.feed(np.zeros(SAMPLE_RATE // 4, dtype=np.float32))
    assert seg.done == 1 and seg.so_far() is None


def test_hazard_notes_are_parsed_safely_and_never_fire_alerts(monkeypatch):
    from app import hazard

    assert hazard.parse('```json\n{"notes": [{"label": "cup at table edge", "where": "left", "why": "could fall"}]}\n```') == [
        {"label": "cup at table edge", "where": "left", "why": "could fall"}]
    assert hazard.parse("no hazards here") == []
    assert hazard.parse('{"notes": "oops"}') == []
    assert len(hazard.parse('{"notes": [{"label": "a"}, {"label": "b"}, {"label": "c"}]}')) == 2
    # Without a Gemini key it says so instead of calling anything.
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("LUMEN_LLM", "off")
    assert hazard.look("data:image/jpeg;base64,AAAA") == {"enabled": False, "notes": []}


def test_hazard_endpoint_without_a_key_is_off_and_rejects_big_photos(monkeypatch):
    monkeypatch.setenv("LUMEN_LLM", "off")
    client = TestClient(app)
    ok = client.post("/api/hazard", json={"jpeg": "data:image/jpeg;base64,AAAA"})
    assert ok.status_code == 200 and ok.json() == {"enabled": False, "notes": []}
    assert client.post("/api/hazard", json={"jpeg": "not a photo"}).status_code == 400


def test_hazard_note_sends_the_photo_to_gemini_and_returns_the_notes(monkeypatch):
    import sys
    import types

    from app import hazard

    seen = {}

    class FakeClient:
        def __init__(self, **kw):
            seen["base_url"] = kw["base_url"]
            self.chat = types.SimpleNamespace(completions=types.SimpleNamespace(create=self.create))

        def create(self, **kw):
            seen["content"] = kw["messages"][0]["content"]
            text = '{"notes": [{"label": "cup at table edge", "where": "left of the table", "why": "could fall"}]}'
            return types.SimpleNamespace(choices=[types.SimpleNamespace(message=types.SimpleNamespace(content=text))])

    monkeypatch.setitem(sys.modules, "openai", types.SimpleNamespace(OpenAI=FakeClient))
    monkeypatch.setenv("LUMEN_LLM", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(hazard, "_last_call", 0.0)
    out = hazard.look("data:image/jpeg;base64,AAAA")
    assert out["notes"][0]["label"] == "cup at table edge" and "generativelanguage" in seen["base_url"]
    assert seen["content"][1] == {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,AAAA"}}
    assert hazard.look("data:image/jpeg;base64,AAAA")["wait"] is True  # asked again too soon


def test_presenter_direction_is_logged_and_labelled():
    client = TestClient(app)
    with client.websocket_connect("/ws/hud") as hud:
        hud.receive_json()
        client.post("/api/presenter_dir", json={"corner": 2})
        msg = hud.receive_json()
    assert msg["type"] == "presenter_dir" and msg["corner"] == 2 and msg["presenter_set"] is True
    r = client.post("/api/presenter_dir", json={"corner": 2})
    assert r.json() == {"ok": True}
    assert client.post("/api/presenter_dir", json={"corner": 9}).json().get("error")


def test_ask_falls_back_to_another_key(monkeypatch):
    """Gemini busy (503) -> Ask Lumen tries Groq next, if that key is set too."""
    from app import agent

    for env in ("GROQ_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY", "HF_TOKEN"):
        monkeypatch.delenv(env, raising=False)
    monkeypatch.setenv("LUMEN_LLM", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    monkeypatch.setenv("GROQ_API_KEY", "q")
    assert agent.pick_provider()[0] == "gemini"
    assert [p[0] for p in agent.backup_providers("gemini")] == ["groq"]
    monkeypatch.setenv("LUMEN_LLM", "off")
    assert agent.backup_providers("gemini") == []


def test_mic_levels_name_the_loudest_device(monkeypatch):
    """Twice a second the screens get how loud each device is, so they can show which one hears it."""
    import numpy as np

    from app import main

    sent = []

    async def fake_broadcast(targets, msg):
        sent.append((targets, msg))

    monkeypatch.setattr(main.hub, "broadcast", fake_broadcast)
    monkeypatch.setattr(main, "last_direction", 0)
    monkeypatch.setattr(main, "audio_buffers", {"mac": np.full(8000, 0.3, np.float32), "head": np.full(8000, 0.01, np.float32)})
    monkeypatch.setattr(main.hub, "nodes", {"mac": {"zone": "living"}, "head": {"zone": "wearer"}})
    asyncio.run(main._maybe_direction())
    levels = next(m for t, m in sent if m["type"] == "mic_levels")
    assert "dashboard" in next(t for t, m in sent if m["type"] == "mic_levels")
    assert levels["levels"]["living"] > levels["levels"]["wearer"]
