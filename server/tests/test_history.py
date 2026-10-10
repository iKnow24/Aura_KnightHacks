import json

from fastapi.testclient import TestClient

from app import history, main


def test_sample_history_matches_planted_decline(monkeypatch):
    monkeypatch.setenv("LUMEN_HISTORY_SAMPLE", "1")
    for k in ("DATABRICKS_HOST", "DATABRICKS_TOKEN", "DATABRICKS_WAREHOUSE_ID"):
        monkeypatch.delenv(k, raising=False)
    history._cache.clear()
    out = TestClient(main.app).get("/api/history?household=maria").json()
    assert out["source"] == "sample"
    assert len(out["days"]) == 14
    s = out["status"]
    assert s["latest_day"] == "2026-10-09"
    assert (s["missed_this_week"], s["missed_week_before"]) == (15, 5)
    assert s["pct_slower"] == 50 and s["flagged"]


def test_databricks_failure_never_falls_back_to_sample(monkeypatch):
    monkeypatch.setenv("LUMEN_HISTORY_SAMPLE", "1")
    monkeypatch.setenv("DATABRICKS_HOST", "http://127.0.0.1:9")
    monkeypatch.setenv("DATABRICKS_TOKEN", "x")
    monkeypatch.setenv("DATABRICKS_WAREHOUSE_ID", "x")
    history._cache.clear()
    out = history.history("maria")
    assert out["source"] == "unavailable" and "Databricks unavailable" in out["note"]
    assert out["days"] == [] and out["status"] is None
    history._cache.clear()


def test_databricks_rows_are_parsed(monkeypatch):
    replies = iter([
        [{"day": "2026-10-09", "alerts": "8", "missed_alerts": "1", "night_alerts": "0", "missed_at_night": "0",
          "median_seconds_to_notice": "11.0"}],
        [{"day": "2026-10-09", "median_seconds_this_week": "9.0", "median_seconds_week_before": "6.0",
          "pct_slower": "50", "missed_this_week": "8", "missed_week_before": "2", "flagged": "true"}],
        [{"alert_time": "2026-10-09T18:27:12Z", "kind": "doorbell", "zone": "hallway", "at_night": "false"}],
    ])
    monkeypatch.setattr(history, "_sql", lambda statement, household: next(replies))
    days, status, missed = history.from_databricks("maria")
    assert days[0]["alerts"] == 8 and status["flagged"] and status["pct_slower"] == 50
    assert missed[0]["at_night"] is False


def test_real_event_log_is_used_and_says_no_baseline_yet(tmp_path, monkeypatch):
    from app.eventlog import record
    for k in ("DATABRICKS_HOST", "DATABRICKS_TOKEN", "DATABRICKS_WAREHOUSE_ID"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("EVENT_LOG_DIR", str(tmp_path))
    monkeypatch.setenv("LUMEN_HOUSEHOLD", "home")
    t = 1791519600.0
    record({"type": "alert", "id": "a", "kind": "doorbell", "zone": "hallway", "severity": "warning", "source": "ast", "ts": t})
    record({"type": "ack", "id": "a", "by": "wearer", "ts": t + 4})
    record({"type": "alert", "id": "b", "kind": "smoke_alarm", "zone": "kitchen", "severity": "critical", "source": "fake", "ts": t + 9})
    history._cache.clear()
    out = history.history()
    history._cache.clear()
    assert out["source"] == "event_log" and out["household"] == "home"
    s = out["status"]
    assert s["alerts_this_week"] == 1  # the test-button alert is left out
    assert s["alerts_week_before"] == 0 and not s["flagged"]
    assert s["median_seconds_this_week"] == 4.0


def test_default_history_has_no_generated_household(monkeypatch):
    for key in ("DATABRICKS_HOST", "DATABRICKS_TOKEN", "DATABRICKS_WAREHOUSE_ID", "EVENT_LOG_DIR", "LUMEN_HISTORY_SAMPLE"):
        monkeypatch.delenv(key, raising=False)
    history._cache.clear()
    result = history.history()
    assert result["source"] == "unavailable"
    assert result["days"] == [] and result["status"] is None


def test_missing_real_log_directory_never_uses_samples(tmp_path, monkeypatch):
    for key in ("DATABRICKS_HOST", "DATABRICKS_TOKEN", "DATABRICKS_WAREHOUSE_ID"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("LUMEN_HISTORY_SAMPLE", "1")
    monkeypatch.setenv("EVENT_LOG_DIR", str(tmp_path / "not-created-yet"))
    history._cache.clear()
    result = history.history("maria")
    assert result["source"] == "event_log" and result["days"] == []


def test_sample_cache_does_not_leak_after_switch_to_real_mode(monkeypatch):
    for key in ("DATABRICKS_HOST", "DATABRICKS_TOKEN", "DATABRICKS_WAREHOUSE_ID", "EVENT_LOG_DIR"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("LUMEN_HISTORY_SAMPLE", "1")
    history._cache.clear()
    assert history.history("maria")["source"] == "sample"
    monkeypatch.delenv("LUMEN_HISTORY_SAMPLE")
    assert history.history("maria")["days"] == []


def test_partial_event_line_does_not_break_real_history(tmp_path):
    event = {"type": "alert", "id": "a", "kind": "doorbell", "severity": "warning",
             "zone": "hallway", "household": "home", "source": "ast", "ts": 1760000000.0}
    (tmp_path / "events.jsonl").write_text(json.dumps(event) + '\n{"type":')
    days, status, _ = history.from_sample("home", tmp_path)
    assert len(days) == 1 and status["alerts_this_week"] == 1
