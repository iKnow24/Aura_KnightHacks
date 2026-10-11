import numpy as np
from fastapi.testclient import TestClient

from app import llm, main
from app.main import app
from app.modes import MODES, make_mode
from app.speakers import CrossTalk


def test_crosstalk_keeps_loudest_phone():
    ct = CrossTalk()
    assert ct.check("Dana", "Are we still meeting at noon?", 0.05, ts=10) == (True, None)
    # Sharan's phone heard Dana too, but quieter: dropped.
    assert ct.check("Sharan", "are we still meeting at noon", 0.01, ts=11) == (False, None)
    # A different sentence from Sharan is kept.
    assert ct.check("Sharan", "Yes, the library at twelve.", 0.06, ts=12)[0]


def test_crosstalk_louder_duplicate_replaces_earlier():
    ct = CrossTalk()
    ct.check("Sharan", "Pass me the salt please", 0.01, ts=1)
    keep, replaced = ct.check("Dana", "pass me the salt please", 0.08, ts=1.5)
    assert keep and replaced["zone"] == "Sharan"


def test_new_mode_from_description_rules(monkeypatch):
    monkeypatch.setattr(llm, "chat_json", lambda *a, **k: (None, "rules"))
    key, mode = make_mode("cooking mode for when I'm making dinner and waiting for a delivery")
    assert {"timer", "kettle", "doorbell", "smoke_alarm"} <= set(mode["sound_kinds"])
    assert key.startswith("custom-") and mode["routes"] == MODES["wearer"]["routes"]
    _, quiet = make_mode("study mode, keep it quiet")
    assert quiet["sound_kinds"] == ["smoke_alarm"] and quiet["routes"] == MODES["lecture"]["routes"]


def test_add_mode_endpoint_switches_to_it(monkeypatch):
    monkeypatch.setattr(llm, "chat_json", lambda *a, **k: ({"label": "Gardening", "sound_kinds": ["water_running", "nonsense"]}, "claude"))
    client = TestClient(app)
    r = client.post("/api/modes", json={"description": "I'm out in the garden watering"}).json()
    assert r["key"] == "custom-gardening" and r["sound_kinds"] == ["water_running", "smoke_alarm"]
    assert client.get("/api/state").json()["mode"] == "custom-gardening"
    MODES.pop("custom-gardening")
    client.post("/api/mode", json={"mode": "night"})


def test_browser_captions_are_saved_to_memory():
    client = TestClient(app)
    client.post("/api/speech", json={"text": "The meeting moved to 3 pm", "zone": "wearer"})
    assert main.memory.entries[-1]["text"] == "The meeting moved to 3 pm"


def test_whisper_caption_message_type_and_speaker(monkeypatch):
    monkeypatch.setattr(main.transcriber, "transcribe", lambda audio: "Hi I'm Dana")
    client = TestClient(app)
    with client.websocket_connect("/ws/hud") as hud:
        hud.receive_json()
        import asyncio
        asyncio.run(main.run_speech("Dana", np.full(16000, 0.1, np.float32)))
        msg = hud.receive_json()
    assert msg["type"] == "caption" and msg["zone"] == "Dana" and msg["id"].endswith("Dana")


def test_segmenter_times_the_words_not_the_silence():
    """Captions carry when the words were said, so a caption screen can match them to a moving mouth."""
    from app.detectors.speech import SAMPLE_RATE, Segmenter

    seg = Segmenter()
    loud = np.full(SAMPLE_RATE // 2, 0.3, np.float32)  # half a second of speech per chunk
    quiet = np.zeros(SAMPLE_RATE // 2, np.float32)
    t = 1000.0
    for chunk in (loud, loud, quiet, quiet):
        t += 0.5
        out = seg.feed(chunk, ts=t)
    assert out is not None and seg.span is not None
    start, end = seg.span
    assert start == 1000.0  # the first loud chunk had already been recorded when it arrived
    assert end == 1001.0  # the trailing second of quiet isn't speech
    assert seg.start is None  # ready to time the next sentence


def test_caption_says_when_the_words_were_said(monkeypatch):
    monkeypatch.setattr(main.transcriber, "transcribe", lambda audio: "dinner is ready")
    client = TestClient(app)
    with client.websocket_connect("/ws/dashboard") as dash:
        dash.receive_json()
        import asyncio
        asyncio.run(main.run_speech("living", np.full(16000, 0.1, np.float32), (1000.0, 1002.5)))
        msg = dash.receive_json()
    assert (msg["start_ts"], msg["end_ts"]) == (1000.0, 1002.5)
