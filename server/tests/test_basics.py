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
