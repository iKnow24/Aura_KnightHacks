import asyncio

from fastapi.testclient import TestClient

from app import main
from app.hub import Hub


def test_room_node_connect_heartbeat_and_disconnect_reach_dashboard():
    client = TestClient(main.app)
    with client.websocket_connect('/ws/dashboard') as dashboard:
        dashboard.receive_json()
        with client.websocket_connect('/ws/node/camera-test?zone=kitchen') as node:
            node.receive_json()
            connected = dashboard.receive_json()
            assert connected['nodes']['camera-test']['zone'] == 'kitchen'
            node.send_json({'type': 'heartbeat'})
            refreshed = dashboard.receive_json()
            assert refreshed['nodes']['camera-test']['last_seen'] >= connected['nodes']['camera-test']['last_seen']
        disconnected = dashboard.receive_json()
        assert 'camera-test' not in disconnected['nodes']


def test_old_disconnect_does_not_remove_reconnected_node():
    hub = Hub('night')
    old, new = object(), object()

    async def run():
        await hub.register_node(old, 'same', 'kitchen')
        await hub.register_node(new, 'same', 'kitchen')
        await hub.unregister_node(old, 'same')
        assert 'same' in hub.nodes
        await hub.unregister_node(new, 'same')
        assert 'same' not in hub.nodes

    asyncio.run(run())


def test_demo_preview_is_forwarded_without_entering_memory_or_event_log(monkeypatch, tmp_path):
    monkeypatch.setenv('LUMEN_DEMO_PREVIEW', '1')
    monkeypatch.setenv('EVENT_LOG_DIR', str(tmp_path))
    client = TestClient(main.app)
    before = list(main.memory.entries)
    with client.websocket_connect('/ws/dashboard') as dashboard:
        dashboard.receive_json()
        with client.websocket_connect('/ws/node/preview-test?zone=bedroom') as node:
            node.receive_json()
            dashboard.receive_json()  # registered
            node.send_json({'type': 'camera_preview', 'jpeg': 'data:image/jpeg;base64,AA==', 'ts': 1})
            dashboard.receive_json()  # heartbeat state
            preview = dashboard.receive_json()
            assert preview['type'] == 'camera_preview'
            assert preview['node_id'] == 'preview-test' and preview['zone'] == 'bedroom'
            assert preview['ts'] > 1
    assert main.memory.entries == before
    assert not list(tmp_path.glob('*.jsonl'))


def test_headset_audio_is_not_played_back_on_the_dashboard(monkeypatch):
    # Playing the mic out of the laptop speakers made a phone-call echo. The brain still hears it.
    import numpy as np
    pcm = np.zeros(32, dtype=np.float32).tobytes()
    forwarded = []

    async def grab(roles, data):
        forwarded.append((roles, data))

    monkeypatch.setattr(main.hub, 'broadcast_bytes', grab)
    monkeypatch.setenv('LUMEN_DEMO_PREVIEW', '1')
    client = TestClient(main.app)
    before = list(main.memory.entries)
    with client.websocket_connect('/ws/dashboard') as dashboard:
        dashboard.receive_json()
        with client.websocket_connect('/ws/node/headset-a?zone=wearer') as node:
            node.receive_json()
            dashboard.receive_json()
            node.send_bytes(pcm)
            assert dashboard.receive_json()['type'] == 'state'
    assert forwarded == []
    assert main.memory.entries == before


def test_preview_is_off_by_default(monkeypatch):
    monkeypatch.delenv('LUMEN_DEMO_PREVIEW', raising=False)
    sent = []

    async def broadcast(roles, message):
        sent.append((roles, message))

    monkeypatch.setattr(main.hub, 'broadcast', broadcast)
    client = TestClient(main.app)
    with client.websocket_connect('/ws/node/private-test?zone=living') as node:
        node.receive_json()
        node.send_json({'type': 'camera_preview', 'jpeg': 'data:image/jpeg;base64,AA=='})
        node.send_json({'type': 'heartbeat'})
    assert not any(message['type'] == 'camera_preview' for _, message in sent)
