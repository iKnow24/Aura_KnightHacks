import json
import time
from types import SimpleNamespace

import numpy as np
from fastapi.testclient import TestClient

from app import main
from app.detectors import scene
from app.detectors.items import boxes_from_outputs


def body(shoulder_y, hip_y, knee_y, lying=False):
    lm = [[0.5, 0.5, 1.0]] * 33
    lm = [list(p) for p in lm]
    if lying:  # torso flat: shoulders and hips side by side at the same height
        lm[11], lm[12], lm[23], lm[24] = [0.2, 0.8, 1], [0.2, 0.82, 1], [0.6, 0.8, 1], [0.6, 0.82, 1]
    else:
        lm[11], lm[12] = [0.45, shoulder_y, 1], [0.55, shoulder_y, 1]
        lm[23], lm[24] = [0.46, hip_y, 1], [0.54, hip_y, 1]
    lm[25], lm[26] = [0.46, knee_y, 1], [0.54, knee_y, 1]
    return lm


def test_posture_from_keypoints():
    assert scene.posture(body(0.2, 0.5, 0.75)) == 'standing'
    assert scene.posture(body(0.3, 0.6, 0.62)) == 'sitting'
    assert scene.posture(body(0, 0, 0.82, lying=True)) == 'lying'
    assert scene.posture(None) is None


def test_one_pass_boxes_keep_best_query_and_merge_overlaps():
    # 3 boxes x 2 queries. Box 0 and 1 overlap and both say query 0; box 2 says query 1 but too weakly.
    logits = np.array([[3.0, -5], [2.0, -5], [-5, -1.0]])
    boxes = np.array([[0.25, 0.25, 0.2, 0.2], [0.26, 0.26, 0.2, 0.2], [0.7, 0.3, 0.1, 0.1]])
    hits = boxes_from_outputs(logits, boxes, 640, 480, [0.5, 0.5])
    assert len(hits) == 1 and hits[0]['query'] == 0
    # OWLv2 boxes are fractions of the padded 640x640 square, so y uses 640 too
    assert hits[0]['box'] == {'xmin': 96, 'ymin': 96, 'xmax': 224, 'ymax': 224}


def test_scene_json_shape():
    prompts, thresholds, labels = scene.queries()
    assert len(prompts) == len(thresholds) == len(set(prompts))
    hits = [{'label': scene.SCENE['person'][0], 'score': 0.61, 'box': {'xmin': 64, 'ymin': 48, 'xmax': 320, 'ymax': 480}},
            {'label': scene.SCENE['stove'][0], 'score': 0.4, 'box': {'xmin': 400, 'ymin': 200, 'xmax': 640, 'ymax': 400}}]
    ev = scene.build('k1', 'kitchen', 1.0, hits, labels, 640, 480, {'inference_ms': 90.0, 'device': 'GPU'}, 'standing', True)
    assert ev['type'] == 'vision' and ev['people'] == 1 and ev['counts'] == {'person': 1, 'stove': 1}
    assert ev['objects'][0] == {'label': 'person', 'score': 0.61, 'box': [0.1, 0.1, 0.5, 1.0]}
    assert ev['summary'] == '1 person (standing), stove' and ev['inference_ms'] == 90.0
    assert 'jpeg' not in json.dumps(ev)


def wait_for(sent, kind):
    for _ in range(100):
        found = [m for _, m in sent if m.get('type') == kind]
        if found:
            return found
        time.sleep(0.02)
    return []


def test_snapshot_becomes_logged_scene_json_without_the_photo(monkeypatch, tmp_path):
    monkeypatch.setenv('EVENT_LOG_DIR', str(tmp_path))
    sent = []

    async def broadcast(roles, message):
        sent.append((roles, message))

    def detect(image, prompts, thresholds):
        return ([{'label': scene.SCENE['person'][0], 'score': 0.7, 'box': {'xmin': 0, 'ymin': 0, 'xmax': 32, 'ymax': 48}}],
                {'inference_ms': 12.5, 'total_ms': 20.0, 'device': 'Test GPU'})

    monkeypatch.setattr(main.hub, 'broadcast', broadcast)
    monkeypatch.setattr(main.item_finder, 'detect', detect)
    monkeypatch.setattr(main, 'decode', lambda jpeg: SimpleNamespace(size=(64, 48)))  # CI has no Pillow
    monkeypatch.setattr(main.item_finder, '_failed', False)
    main.vision_ms.clear()
    client = TestClient(main.app)
    with client.websocket_connect('/ws/node/scene-test?zone=kitchen') as node:
        node.receive_json()
        node.send_json({'type': 'pose', 'ts': 1, 'landmarks': body(0.2, 0.5, 0.75)})
        node.send_json({'type': 'snapshot', 'ts': 1, 'jpeg': 'data:image/jpeg;base64,AA=='})
        vision = wait_for(sent, 'vision')
        assert vision and vision[0]['posture'] == 'standing' and vision[0]['people'] == 1
        speed = client.get('/api/vision').json()['speed']
        assert speed['frames'] == 1 and speed['p50_ms'] == 12.5
    logged = [json.loads(line) for f in tmp_path.glob('*.jsonl') for line in f.read_text().splitlines()]
    assert [e['type'] for e in logged] == ['vision']
    assert 'base64' not in json.dumps(logged)


def test_phone_scene_is_logged_at_most_every_few_seconds(monkeypatch, tmp_path):
    monkeypatch.setenv('EVENT_LOG_DIR', str(tmp_path))
    client = TestClient(main.app)
    with client.websocket_connect('/ws/node/rear-test?zone=behind') as node:
        node.receive_json()
        for _ in range(3):
            node.send_json({'type': 'scene', 'objects': [{'kind': 'car', 'bearing': 5, 'dist': 8.0}], 'fov': 60})
        node.send_json({'type': 'heartbeat'})
    logged = [json.loads(line) for f in tmp_path.glob('*.jsonl') for line in f.read_text().splitlines()]
    assert len(logged) == 1 and logged[0]['source'] == 'phone' and logged[0]['counts'] == {'car': 1}


def test_memory_page_reports_item_model_status():
    assert TestClient(main.app).get('/api/memory').json()['models']['items'] in ('off', 'loading', 'ready')
