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
    host = "https://example.cloud.databricks.com"

    def download(self, path):
        return self.files[path]
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


def setup_transport(tmp_path, monkeypatch):
    monkeypatch.setenv("EVENT_LOG_DIR", str(tmp_path / "log"))
    monkeypatch.setenv("LUMEN_SYNC_KEY", "pw")
    monkeypatch.setattr(sync, "STATE", tmp_path / "state.json")
    client = TestClient(main.app)
    monkeypatch.setattr(sync, "call", lambda url, method="GET", data=None, headers=None:
                        client.get(url.replace("http://lumen", ""), headers=headers).content)


def test_timeout_then_append_and_restart_preserves_each_event(tmp_path, monkeypatch):
    import urllib.error
    setup_transport(tmp_path, monkeypatch)

    class TimeoutAfterUpload(FakeDatabricks):
        fail = True

        def upload(self, path, data):
            if path in self.files:
                raise urllib.error.HTTPError(path, 409, "exists", {}, None)
            super().upload(path, data)
            if self.fail:
                self.fail = False
                raise urllib.error.URLError("response lost")

    db, state = TimeoutAfterUpload(), {}
    record({"type": "speech", "text": "first", "ts": 1760000000.0})
    import pytest
    with pytest.raises(urllib.error.URLError):
        sync.sync_once("http://lumen", "pw", db, "/Volumes/lumen/home/raw_events", state)
    record({"type": "speech", "text": "later", "ts": 1760000001.0})
    # Simulate a new process, not merely a second call with the in-memory state.
    state = json.loads(sync.STATE.read_text())
    sync.sync_once("http://lumen", "pw", db, "/Volumes/lumen/home/raw_events", state)
    texts = [json.loads(line)["text"] for chunk in db.files.values() for line in chunk.splitlines()]
    assert texts == ["first", "later"]
    assert state["pending"] is None


def test_conflict_with_different_bytes_does_not_advance(tmp_path, monkeypatch):
    import pytest
    import urllib.error
    setup_transport(tmp_path, monkeypatch)

    class ConflictingUpload(FakeDatabricks):
        def upload(self, path, data):
            self.files[path] = b"different\n"
            raise urllib.error.HTTPError(path, 409, "exists", {}, None)

    state = {}
    record({"type": "speech", "text": "first", "ts": 1760000000.0})
    with pytest.raises(ValueError, match="differs"):
        sync.sync_once("http://lumen", "pw", ConflictingUpload(), "/Volumes/lumen/home/raw_events", state)
    assert state["offsets"] == {}
    assert json.loads(sync.STATE.read_text())["pending"] is not None


def test_busy_job_is_retried_on_idle_round_after_restart(tmp_path, monkeypatch):
    setup_transport(tmp_path, monkeypatch)
    db, state = FakeDatabricks(), {}
    record({"type": "speech", "text": "first", "ts": 1760000000.0})
    sync.sync_once("http://lumen", "pw", db, "/Volumes/lumen/home/raw_events", state)
    replies = iter([False, True])
    db.run_job = lambda job: next(replies)
    assert not sync.start_pending_job(db, "123", state)
    state = json.loads(sync.STATE.read_text())
    assert sync.sync_once("http://lumen", "pw", db, "/Volumes/lumen/home/raw_events", state) == 0
    assert sync.start_pending_job(db, "123", state)
    assert not json.loads(sync.STATE.read_text())["pipeline_due"]


def test_job_request_failure_remains_pending(tmp_path, monkeypatch):
    import pytest
    import urllib.error
    setup_transport(tmp_path, monkeypatch)
    db, state = FakeDatabricks(), {}
    sync.prepare_state(state, "http://lumen", db, "/Volumes/lumen/home/raw_events")
    state["pipeline_due"] = True
    sync.save_state(state)
    def fail(job):
        raise urllib.error.URLError("offline")
    db.run_job = fail
    with pytest.raises(urllib.error.URLError):
        sync.start_pending_job(db, "123", state)
    assert json.loads(sync.STATE.read_text())["pipeline_due"]


def test_destination_change_cannot_reuse_offsets(tmp_path, monkeypatch):
    import pytest
    setup_transport(tmp_path, monkeypatch)
    db, state = FakeDatabricks(), {}
    sync.prepare_state(state, "http://lumen", db, "/Volumes/lumen/home/raw_events")
    with pytest.raises(ValueError, match="another source or destination"):
        sync.prepare_state(state, "http://lumen", db, "/Volumes/other/home/raw_events")


def test_failed_checkpoint_write_keeps_previous_checkpoint(tmp_path, monkeypatch):
    import pytest
    monkeypatch.setattr(sync, "STATE", tmp_path / "state.json")
    sync.save_state({"before": True})
    def fail(*args):
        raise OSError("disk full")
    monkeypatch.setattr(sync.os, "replace", fail)
    with pytest.raises(OSError):
        sync.save_state({"after": True})
    assert json.loads(sync.STATE.read_text()) == {"before": True}
