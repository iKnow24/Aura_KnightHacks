import json

from fastapi.testclient import TestClient

from app import history, main


def test_sample_story_puts_the_clinic_on_the_map(monkeypatch):
    for k in ("DATABRICKS_HOST", "DATABRICKS_TOKEN", "DATABRICKS_WAREHOUSE_ID"):
        monkeypatch.delenv(k, raising=False)
    history._cache.clear()
    out = history.history("maria")
    assert any(p["name"] == "Dr. Patel's office" and p["city"] == "Orlando" for p in out["places"])
    said = [m for m in out["moments"] if m["clinic"]]
    assert any("appointment" in m["detail"].lower() for m in said)
    assert any(m["kind"] == "alert" and m["title"] == "doorbell" for m in out["moments"])


def test_sample_history_matches_planted_decline(monkeypatch):
    for k in ("DATABRICKS_HOST", "DATABRICKS_TOKEN", "DATABRICKS_WAREHOUSE_ID"):
        monkeypatch.delenv(k, raising=False)
    history._cache.clear()
    out = TestClient(main.app).get("/api/history?household=maria").json()
    assert out["source"] == "sample"
    # 30 steady days (2026-08-27..09-25) plus the original 14. The warning still uses only the last two weeks.
    assert len(out["days"]) == 44
    assert out["days"][0]["day"] == "2026-08-27"
    s = out["status"]
    assert s["latest_day"] == "2026-10-09"
    assert (s["missed_this_week"], s["missed_week_before"]) == (15, 5)
    assert s["pct_slower"] == 50 and s["flagged"]


def test_databricks_failure_falls_back_to_sample(monkeypatch):
    monkeypatch.setenv("DATABRICKS_HOST", "http://127.0.0.1:9")
    monkeypatch.setenv("DATABRICKS_TOKEN", "x")
    monkeypatch.setenv("DATABRICKS_WAREHOUSE_ID", "x")
    history._cache.clear()
    out = history.history("maria")
    assert out["source"] == "sample" and "Databricks unavailable" in out["note"]
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


def test_event_log_clinic_comes_from_the_words(tmp_path, monkeypatch):
    from app.eventlog import record
    for k in ("DATABRICKS_HOST", "DATABRICKS_TOKEN", "DATABRICKS_WAREHOUSE_ID"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("EVENT_LOG_DIR", str(tmp_path))
    monkeypatch.setenv("LUMEN_HOUSEHOLD", "home")
    record({"type": "speech", "zone": "living", "text": "Your appointment moved to Thursday at 2.", "ts": 1791519600.0, "speaker": 4})
    history._cache.clear()
    out = history.history()
    history._cache.clear()
    assert any(p["id"] == "clinic" and "appointment" in p["detail"].lower() for p in out["places"])


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
