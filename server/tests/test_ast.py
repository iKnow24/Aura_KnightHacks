import numpy as np
from fastapi.testclient import TestClient

from app import main
from app.detectors.ast_sound import to_alerts


def test_maps_audioset_labels_to_alert_kinds():
    alerts = to_alerts([("Speech", 0.9), ("Doorbell", 0.6), ("Ding-dong", 0.4), ("Glass", 0.1)])
    assert alerts == [{"kind": "doorbell", "severity": "warning", "confidence": 0.6, "label": "Doorbell"}]


def test_below_threshold_is_ignored():
    assert to_alerts([("Smoke detector, smoke alarm", 0.1)]) == []


def test_model_result_becomes_one_alert_with_cooldown(monkeypatch):
    monkeypatch.setattr(main.sound_model, "classify", lambda audio: [("Baby cry, infant cry", 0.8)])
    with TestClient(main.app) as client, client.websocket_connect("/ws/dashboard") as dash:
        client.post("/api/mode", json={"mode": "watch"})
        dash.receive_json()
        audio = np.zeros(16000 * 3, np.float32)
        client.portal.call(main.run_ast, "n1", "bedroom", audio)
        client.portal.call(main.run_ast, "n1", "bedroom", audio)  # within cooldown: dropped
        msg = dash.receive_json()
        while msg["type"] != "alert":  # skip the state update from the mode change
            msg = dash.receive_json()
        assert msg["kind"] == "baby_cry" and msg["source"] == "ast_sound" and msg["confidence"] == 0.8
        assert [e["kind"] for e in main.hub.events].count("baby_cry") == 1


def test_missing_model_packages_turn_detector_off_quietly():
    from app.detectors.ast_sound import SoundClassifier

    clf = SoundClassifier()
    clf._failed = True  # what happens after a failed import or download
    assert clf.classify(np.zeros(16000, np.float32)) == []
