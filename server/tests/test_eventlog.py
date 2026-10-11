import asyncio
import json

from app.eventlog import record
from app.hub import Hub
from app.memory import Memory


def lines(folder):
    return [json.loads(l) for f in sorted(folder.glob("*.jsonl")) for l in f.read_text().splitlines()]


def test_off_by_default(tmp_path, monkeypatch):
    monkeypatch.delenv("EVENT_LOG_DIR", raising=False)
    record({"type": "speech", "text": "hi"})
    assert not list(tmp_path.iterdir())


def test_alert_ack_speech_and_mode_land_in_hourly_file(tmp_path, monkeypatch):
    monkeypatch.setenv("EVENT_LOG_DIR", str(tmp_path))
    monkeypatch.setenv("LUMEN_HOUSEHOLD", "maria")
    hub, memory = Hub("watch"), Memory()

    async def run():
        alert = await hub.emit_alert("doorbell", "hallway", "warning", "fake")
        await hub.ack(alert["id"])
        await hub.set_mode("night")
    asyncio.run(run())
    entry = memory.add_speech("kitchen", "dinner's ready")
    memory.tag_speech(entry["ts"], 1, True)
    memory.add_sighting("living", "keys", 0.4, thumb="data:image/jpeg;base64,xx")

    got = lines(tmp_path)
    assert [e["type"] for e in got] == ["alert", "ack", "mode", "speech", "caption_meta", "sighting"]
    assert all(e["household"] == "maria" for e in got)
    assert got[1]["id"] == got[0]["id"]
    assert "thumb" not in got[-1]


def test_one_file_per_hour(tmp_path, monkeypatch):
    # Auto Loader reads a file name once, so a finished hour must never be appended to again.
    monkeypatch.setenv("EVENT_LOG_DIR", str(tmp_path))
    record({"type": "speech", "text": "a", "ts": 1760000000.0})
    record({"type": "speech", "text": "b", "ts": 1760000000.0 + 3600})
    assert len(list(tmp_path.glob("*.jsonl"))) == 2


def test_sync_endpoint_needs_the_key(tmp_path, monkeypatch):
    # The log holds what people said and the tunnel URL is public, so no key = no log.
    from fastapi.testclient import TestClient
    from app import main
    monkeypatch.setenv("EVENT_LOG_DIR", str(tmp_path))
    monkeypatch.delenv("LUMEN_SYNC_KEY", raising=False)
    client = TestClient(main.app)
    assert client.get("/api/eventlog").status_code == 403
    monkeypatch.setenv("LUMEN_SYNC_KEY", "pw")
    assert client.get("/api/eventlog", headers={"X-Lumen-Sync-Key": "nope"}).status_code == 403


def test_sync_endpoint_returns_only_new_full_lines(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from app import main
    monkeypatch.setenv("EVENT_LOG_DIR", str(tmp_path))
    monkeypatch.setenv("LUMEN_SYNC_KEY", "pw")
    record({"type": "speech", "text": "a", "ts": 1760000000.0})
    record({"type": "speech", "text": "b", "ts": 1760000001.0})
    name = next(tmp_path.glob("*.jsonl")).name
    with (tmp_path / name).open("a") as f:
        f.write('{"type": "spe')  # the brain is mid-write
    client, key = TestClient(main.app), {"X-Lumen-Sync-Key": "pw"}
    files = client.get("/api/eventlog", headers=key).json()["files"]
    assert [f["name"] for f in files] == [name]
    first = client.get(f"/api/eventlog/{name}?offset=0", headers=key).content
    assert first.count(b"\n") == 2 and first.endswith(b"\n")
    assert client.get(f"/api/eventlog/{name}?offset={len(first)}", headers=key).content == b""
    assert client.get("/api/eventlog/..%2Fsecrets.jsonl", headers=key).status_code == 404
