import json

from fastapi.testclient import TestClient

from app import history, main


def test_sample_history_matches_planted_decline(monkeypatch):
    for k in ("DATABRICKS_HOST", "DATABRICKS_TOKEN", "DATABRICKS_WAREHOUSE_ID"):
        monkeypatch.delenv(k, raising=False)
    history._cache.clear()
    out = TestClient(main.app).get("/api/history?household=maria").json()
    assert out["source"] == "sample"
    assert len(out["days"]) == 14
    s = out["status"]
    assert s["latest_day"] == "2026-10-09"
    assert (s["missed_this_week"], s["missed_week_before"]) == (8, 2)
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
