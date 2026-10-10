import importlib.util
import json
from pathlib import Path

from fastapi.testclient import TestClient

from app import main
from app.eventlog import record

spec = importlib.util.spec_from_file_location("sync", Path(__file__).resolve().parents[2] / "scripts" / "databricks_sync.py")
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class FakeDatabricks:
    def __init__(self):
        self.files = {}

    def upload(self, path, data):
        assert path not in self.files  # Auto Loader reads a name once: never reuse one
        self.files[path] = data


def test_each_event_is_uploaded_exactly_once(tmp_path, monkeypatch):
    monkeypatch.setenv("EVENT_LOG_DIR", str(tmp_path / "log"))
    monkeypatch.setenv("LUMEN_SYNC_KEY", "pw")
    monkeypatch.setattr(sync, "STATE", tmp_path / "state.json")
    client = TestClient(main.app)
    monkeypatch.setattr(sync, "call", lambda url, method="GET", data=None, headers=None:
                        client.get(url.replace("http://lumen", ""), headers=headers).content)
    db, state = FakeDatabricks(), {}
    record({"type": "speech", "text": "a", "ts": 1760000000.0})
    sync.sync_once("http://lumen", "pw", db, "/Volumes/lumen/home/raw_events", state)
    sync.sync_once("http://lumen", "pw", db, "/Volumes/lumen/home/raw_events", state)  # nothing new
    record({"type": "speech", "text": "b", "ts": 1760000001.0})
    sync.sync_once("http://lumen", "pw", db, "/Volumes/lumen/home/raw_events", state)
    assert len(db.files) == 2
    texts = [json.loads(l)["text"] for d in db.files.values() for l in d.splitlines()]
    assert texts == ["a", "b"]
    assert json.loads((tmp_path / "state.json").read_text()) == state
