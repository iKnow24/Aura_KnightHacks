import numpy as np
from fastapi.testclient import TestClient

from app import llm
from app.detectors.ast_sound import loudness_rise, to_alerts
from app.main import app
from app.modes import MODES
from app.recap import people, recap

LECTURE = [
    {"text": "Today we are covering photosynthesis in plants.", "ts": 100.0},
    {"text": "Photosynthesis turns light energy into chemical energy stored in glucose.", "ts": 110.0},
    {"text": "The chloroplast is where photosynthesis happens, and chlorophyll absorbs the light.", "ts": 120.0},
    {"text": "Glucose is then used by the plant for energy and growth.", "ts": 130.0},
    {"text": "Chlorophyll reflects green light, which is why leaves look green.", "ts": 140.0},
    {"text": "Remember that oxygen is released as a byproduct of photosynthesis.", "ts": 150.0},
]


def test_mode_sound_filter_drops_street_sounds_in_lecture():
    scores = [("Vehicle horn, car horn, honking", 0.8), ("Ringtone", 0.6)]
    kinds = {a["kind"] for a in to_alerts(scores, MODES["lecture"]["sound_kinds"])}
    assert kinds == {"phone_ring"}
    assert {a["kind"] for a in to_alerts(scores, MODES["outside"]["sound_kinds"])} == {"car_horn"}


def test_vehicle_needs_rising_loudness():
    assert to_alerts([("Car", 0.9)], rise=1.0) == []
    assert to_alerts([("Car", 0.9)], rise=3.0)[0]["kind"] == "vehicle"
    t = np.linspace(0, 1, 48000, dtype=np.float32)
    louder = (np.sin(2 * np.pi * 200 * t * 30) * t).astype(np.float32)
    assert loudness_rise(louder) > 2


def test_ack_reaches_every_screen_and_marks_event():
    client = TestClient(app)
    client.post("/api/mode", json={"mode": "wearer"})
    with client.websocket_connect("/ws/hud") as hud:
        hud.receive_json()
        alert = client.post("/api/fake-alert", json={"kind": "timer", "zone": "kitchen", "severity": "warning"}).json()
        assert hud.receive_json()["id"] == alert["id"]
        client.post("/api/ack", json={"id": alert["id"]})
        msg = hud.receive_json()
        assert msg["type"] == "ack" and msg["id"] == alert["id"]
    assert client.get("/api/state").json()["events"][-1]["acked"]["by"] == "wearer"


def test_spill_alerts_at_home_not_at_night():
    client = TestClient(app)
    for mode, expect in (("wearer", True), ("night", False)):
        client.post("/api/mode", json={"mode": mode})
        before = len(client.get("/api/state").json()["events"])
        with client.websocket_connect("/ws/node/kitchen-spill?zone=kitchen") as node:
            node.receive_json()
            node.send_json({"type": "spill", "score": 0.8, "area": 0.05})
            node.send_json({"type": "pose", "ts": 0, "landmarks": None})
        events = client.get("/api/state").json()["events"]
        assert (len(events) > before) == expect
    assert events[-1]["kind"] == "spill" and events[-1]["zone"] == "kitchen"


def test_rear_camera_approach_alerts_only_outside():
    client = TestClient(app)
    for mode, expect in (("night", False), ("outside", True)):
        client.post("/api/mode", json={"mode": mode})
        before = len(client.get("/api/state").json()["events"])
        with client.websocket_connect("/ws/node/r1?zone=behind") as node:
            node.receive_json()
            node.send_json({"type": "approach", "label": "car", "score": 0.7})
            node.send_json({"type": "pose", "ts": 0, "landmarks": None})  # round trip so the first is handled
        events = client.get("/api/state").json()["events"]
        assert (len(events) > before) == expect
    assert events[-1]["kind"] == "vehicle_behind" and events[-1]["zone"] == "behind"


def test_recap_rules_map_quiz_and_time_anchors():
    r = recap(LECTURE, "Biology", use_llm=False)
    assert r["brain"] == "rules"
    labels = [b["label"].lower() for b in r["map"]["branches"]]
    assert "photosynthesis" in labels
    branch = r["map"]["branches"][labels.index("photosynthesis")]
    assert branch["ts"] == 100.0
    assert r["quiz"] and all(q["choices"][q["answer"]].lower() in labels or q["choices"][q["answer"]] for q in r["quiz"])
    for q in r["quiz"]:
        assert "_____" in q["q"] and 0 <= q["answer"] < len(q["choices"])


def test_recap_uses_llm_answer_when_well_formed(monkeypatch):
    fake = {"title": "Photosynthesis", "summary": "Plants turn light into glucose.", "points": ["Light to glucose"],
            "branches": [{"label": "Chlorophyll", "details": ["Absorbs light"]}],
            "quiz": [{"q": "What absorbs light?", "choices": ["Chlorophyll", "Glucose", "Oxygen", "Water"], "answer": 0}]}
    monkeypatch.setattr(llm, "chat_json", lambda *a, **k: (fake, "local"))
    r = recap(LECTURE)
    assert r["brain"] == "local" and r["map"]["branches"][0]["ts"] == 120.0


def test_recap_falls_back_on_garbage_llm(monkeypatch):
    monkeypatch.setattr(llm, "chat_json", lambda *a, **k: ({"nonsense": True}, "hf"))
    assert recap(LECTURE)["brain"] == "rules"


def test_people_from_speech():
    assert people("Hi, I'm Dana. My name is Marcus, and I'm going to talk.") == ["Dana", "Marcus"]


def test_parse_json_handles_chatty_model():
    assert llm.parse_json('Sure! Here it is: {"a": 1} hope that helps') == {"a": 1}
    assert llm.parse_json("no json here") is None
