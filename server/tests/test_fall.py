import math

from app.detectors.fall import FallDetector

FPS = 10


def pose(tilt_deg, hip_y, visible=1.0):
    """33 landmarks for a person whose torso is tilted tilt_deg from vertical, hips at hip_y."""
    lm = [[0.5, 0.5, visible] for _ in range(33)]
    t = math.radians(tilt_deg)
    torso = 0.25
    hip = (0.5, hip_y)
    sh = (hip[0] + torso * math.sin(t), hip[1] - torso * math.cos(t))
    head = (hip[0] + 0.35 * math.sin(t), hip[1] - 0.35 * math.cos(t))
    lm[0][:2] = head
    lm[11][:2] = lm[12][:2] = sh
    lm[23][:2] = lm[24][:2] = hip
    lm[27][:2] = lm[28][:2] = (hip[0] - 0.35 * math.sin(t), hip[1] + 0.35 * math.cos(t))
    return lm


def run(det, frames):
    """frames: list of (seconds, tilt, hip_y). Returns timestamps where the detector fired."""
    fired, ts = [], 0.0
    for seconds, tilt0, hip0, tilt1, hip1 in frames:
        n = max(1, int(seconds * FPS))
        for i in range(n):
            f = (i + 1) / n
            ts += 1 / FPS
            if det.update(ts, pose(tilt0 + (tilt1 - tilt0) * f, hip0 + (hip1 - hip0) * f)):
                fired.append(ts)
    return fired


def test_fast_fall_then_still_fires_once_after_stillness():
    det = FallDetector(stillness_s=5)
    fired = run(det, [(2, 0, 0.55, 0, 0.55), (0.5, 0, 0.55, 85, 0.9), (10, 85, 0.9, 85, 0.9)])
    assert len(fired) == 1
    assert 7 <= fired[0] <= 8.2  # 2.5 s standing + falling, then 5 s still


def test_slow_lie_down_on_couch_does_not_fire():
    det = FallDetector(stillness_s=5)
    assert run(det, [(2, 0, 0.55, 0, 0.55), (5, 0, 0.55, 85, 0.9), (10, 85, 0.9, 85, 0.9)]) == []


def test_sitting_down_does_not_fire():
    det = FallDetector(stillness_s=5)
    assert run(det, [(2, 0, 0.55, 0, 0.55), (0.5, 0, 0.55, 10, 0.8), (10, 10, 0.8, 10, 0.8)]) == []


def test_getting_back_up_cancels():
    det = FallDetector(stillness_s=5)
    assert run(det, [(2, 0, 0.55, 0, 0.55), (0.5, 0, 0.55, 85, 0.9), (2, 85, 0.9, 85, 0.9),
                     (1, 85, 0.9, 0, 0.55), (10, 0, 0.55, 0, 0.55)]) == []


def test_person_leaving_frame_is_unknown_not_fallen():
    det = FallDetector(stillness_s=5)
    run(det, [(2, 0, 0.55, 0, 0.55), (0.5, 0, 0.55, 85, 0.9)])
    fired = [det.update(3 + i / FPS, pose(85, 0.9, visible=0.1)) for i in range(100)]
    assert not any(fired)


def test_pose_frames_over_node_socket_raise_fall_alert():
    import json

    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    client.post("/api/mode", json={"mode": "watch"})
    with client.websocket_connect("/ws/dashboard") as dash, client.websocket_connect("/ws/node/b1?zone=bedroom") as node:
        dash.receive_json(); node.receive_json()
        ts = 0.0
        frames = [(0, 0.55)] * 20 + [(85 * i / 5, 0.55 + 0.35 * i / 5) for i in range(1, 6)] + [(85, 0.9)] * 100
        for tilt, hip in frames:
            ts += 1 / FPS
            node.send_text(json.dumps({"type": "pose", "ts": ts, "landmarks": pose(tilt, hip)}))
        msg = dash.receive_json()
        assert msg["kind"] == "fall" and msg["zone"] == "bedroom" and msg["source"] == "fall"
