"""History for the dashboard's History tab: alerts per day, time to notice, missed alerts, and the
"change from normal" warning.

Three sources, same numbers:
- Databricks, when DATABRICKS_HOST, DATABRICKS_TOKEN and DATABRICKS_WAREHOUSE_ID are set. Reads the
  Gold tables lumen_pipeline.sql builds, through the SQL Statement Execution API.
- This house's own event log, when EVENT_LOG_DIR is set (real events, same Gold logic in Python).
  On the AMD box this is the one that works: its proxy blocks databricks.com.
- Otherwise the committed sample files in databricks/sample_data/ (the generated "Maria" household).

Generated samples require LUMEN_HISTORY_SAMPLE=1 and are never a fallback for a configured real source.

Turning the live call on (all in the brain's environment, e.g. before ./run.sh):
  DATABRICKS_HOST=https://<your-workspace>.cloud.databricks.com
  DATABRICKS_TOKEN=<personal access token: Settings > Developer > Access tokens>
  DATABRICKS_WAREHOUSE_ID=<SQL Warehouses > your warehouse > Connection details, the id at the end of HTTP path>
  DATABRICKS_DASHBOARD_URL=<published dashboard link, shown as a button on the tab>   (optional)
  LUMEN_HOUSEHOLD=maria   (which household's rows to read; default maria)
"""
import json
import os
import time
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from statistics import median
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/New_York")  # same as the pipeline's spark.sql.session.timeZone
SAMPLE_DIR = Path(__file__).resolve().parents[2] / "databricks" / "sample_data"
MISSED_AFTER = 300  # seconds; matches gold_alert_response
CACHE_SECONDS = 60
_cache: dict = {}


def _round(x, n=1):
    return None if x is None else round(x, n)


def _median(xs):
    return median(xs) if xs else None


# ---------------------------------------------------------------- sample files -> Gold, in Python
def _alert_rows(lines):
    """gold_alert_response: each non-info alert with seconds to notice and missed."""
    alerts, first_ack = {}, {}
    for e in lines:
        if e.get("type") == "alert" and e.get("kind") and e.get("severity") != "info" and e.get("source") != "fake":
            alerts[(e["household"], e["id"])] = e
        elif e.get("type") == "ack" and e.get("id"):
            key = (e["household"], e["id"])
            first_ack[key] = min(first_ack.get(key, e["ts"]), e["ts"])
    rows = []
    for key, a in alerts.items():
        t = datetime.fromtimestamp(a["ts"], TZ)
        ack = first_ack.get(key)
        secs = None if ack is None else ack - a["ts"]
        rows.append({
            "household": key[0], "kind": a["kind"], "zone": a["zone"], "time": t, "day": t.date(),
            "at_night": t.hour >= 22 or t.hour < 7,
            "seconds": secs, "missed": secs is None or secs > MISSED_AFTER,
        })
    return rows


def _from_rows(rows, household):
    rows = [r for r in rows if r["household"] == household]
    by_day = defaultdict(list)
    for r in rows:
        by_day[r["day"]].append(r)
    days = [{
        "day": d.isoformat(),
        "alerts": len(rs),
        "missed_alerts": sum(r["missed"] for r in rs),
        "night_alerts": sum(r["at_night"] for r in rs),
        "missed_at_night": sum(r["at_night"] and r["missed"] for r in rs),
        "median_seconds_to_notice": _round(_median([r["seconds"] for r in rs if not r["missed"]])),
    } for d, rs in sorted(by_day.items())]

    status = None
    if days:  # gold_change_from_normal for the latest day
        last = date.fromisoformat(days[-1]["day"])
        this = [r for r in rows if last - timedelta(days=7) < r["day"] <= last]
        before = [r for r in rows if last - timedelta(days=14) < r["day"] <= last - timedelta(days=7)]
        status = _status(last.isoformat(), this, before)

    missed = sorted((r for r in rows if r["missed"]), key=lambda r: r["time"], reverse=True)[:8]
    return days, status, [
        {"time": r["time"].isoformat(), "kind": r["kind"], "zone": r["zone"], "at_night": r["at_night"]} for r in missed
    ]


def _status(day, this, before):
    m_this = _round(_median([r["seconds"] for r in this if not r["missed"]]))
    m_before = _round(_median([r["seconds"] for r in before if not r["missed"]]))
    missed_this = sum(r["missed"] for r in this)
    missed_before = sum(r["missed"] for r in before)
    pct = None if not (m_this and m_before) else round(100 * (m_this - m_before) / m_before)
    flagged = len(before) >= 20 and bool(
        (m_this and m_before and m_this > 1.25 * m_before) or missed_this >= 2 * missed_before + 2
    )
    return {
        "latest_day": day, "median_seconds_this_week": m_this, "median_seconds_week_before": m_before,
        "pct_slower": pct, "missed_this_week": missed_this, "missed_week_before": missed_before, "flagged": flagged,
        "alerts_this_week": len(this), "alerts_week_before": len(before),  # < 20 before = no "normal" yet
    }


def from_sample(household: str, folder: Path = SAMPLE_DIR):
    lines = []
    for f in sorted(folder.glob("*.jsonl")):
        for line in f.read_text().splitlines(keepends=True):
            if not line.endswith("\n") or not line.strip():
                continue
            try:
                event = json.loads(line)
                if isinstance(event, dict):
                    lines.append(event)
            except json.JSONDecodeError:
                continue
    return _from_rows(_alert_rows(lines), household)


# ---------------------------------------------------------------- Databricks SQL warehouse
def _sql(statement: str, household: str):
    host = os.environ["DATABRICKS_HOST"].rstrip("/")
    if not host.startswith("http"):
        host = "https://" + host
    body = json.dumps({
        "warehouse_id": os.environ["DATABRICKS_WAREHOUSE_ID"],
        "statement": statement,
        "parameters": [{"name": "household", "value": household}],
        "wait_timeout": "10s",
        "on_wait_timeout": "CANCEL",
        "format": "JSON_ARRAY",
        "disposition": "INLINE",
    }).encode()
    req = urllib.request.Request(
        f"{host}/api/2.0/sql/statements", data=body, method="POST",
        headers={"Authorization": f"Bearer {os.environ['DATABRICKS_TOKEN']}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        out = json.load(resp)
    state = out.get("status", {}).get("state")
    if state != "SUCCEEDED":
        raise RuntimeError(f"Databricks query {state}: {out.get('status', {}).get('error', {}).get('message', '')}")
    cols = [c["name"] for c in out["manifest"]["schema"]["columns"]]
    return [dict(zip(cols, row)) for row in out.get("result", {}).get("data_array", [])]


def _num(x):
    return None if x is None else float(x)


def _int(x):
    return 0 if x is None else int(float(x))


def from_databricks(household: str):
    t = os.environ.get("DATABRICKS_TABLE_PREFIX", "lumen.home.")
    daily = _sql(f"""SELECT day, alerts, missed_alerts, night_alerts, missed_at_night, median_seconds_to_notice
        FROM {t}gold_daily WHERE household = :household ORDER BY day""", household)
    change = _sql(f"""SELECT * FROM {t}gold_change_from_normal
        WHERE household = :household ORDER BY day DESC LIMIT 1""", household)
    missed = _sql(f"""SELECT alert_time, kind, zone, at_night FROM {t}gold_alert_response
        WHERE household = :household AND missed AND severity <> 'info' ORDER BY alert_time DESC LIMIT 8""", household)
    days = [{
        "day": str(r["day"])[:10], "alerts": _int(r["alerts"]), "missed_alerts": _int(r["missed_alerts"]),
        "night_alerts": _int(r["night_alerts"]), "missed_at_night": _int(r["missed_at_night"]),
        "median_seconds_to_notice": _num(r["median_seconds_to_notice"]),
    } for r in daily]
    status = None
    if change:
        c = change[0]
        status = {
            "latest_day": str(c["day"])[:10],
            "median_seconds_this_week": _num(c["median_seconds_this_week"]),
            "median_seconds_week_before": _num(c["median_seconds_week_before"]),
            "pct_slower": None if c["pct_slower"] is None else round(float(c["pct_slower"])),
            "missed_this_week": _int(c["missed_this_week"]), "missed_week_before": _int(c["missed_week_before"]),
            "flagged": str(c["flagged"]).lower() == "true",
            "alerts_this_week": _int(c.get("alerts_this_week")), "alerts_week_before": _int(c.get("alerts_week_before")),
        }
    return days, status, [
        {"time": r["alert_time"], "kind": r["kind"], "zone": r["zone"], "at_night": str(r["at_night"]).lower() == "true"}
        for r in missed
    ]


def databricks_configured():
    return all(os.environ.get(k) for k in ("DATABRICKS_HOST", "DATABRICKS_TOKEN", "DATABRICKS_WAREHOUSE_ID"))


def history(household: str | None = None):
    log_dir = os.environ.get("EVENT_LOG_DIR")
    household = household or os.environ.get("LUMEN_HOUSEHOLD", "demo" if log_dir else "maria")
    sample_enabled = os.environ.get("LUMEN_HISTORY_SAMPLE") == "1"
    cache_key = (household, log_dir, sample_enabled, databricks_configured())
    hit = _cache.get(cache_key)
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    source, note = "unavailable", None
    days, status, missed = [], None, []
    if databricks_configured():
        try:
            days, status, missed = from_databricks(household)
            source = "databricks"
        except Exception:
            note = "Databricks unavailable. No generated data has been substituted."
    if source != "databricks" and log_dir:
        days, status, missed = from_sample(household, Path(log_dir))
        source = "event_log"
        if note:
            note = "Databricks unavailable. Showing this home's local event log."
    if source == "unavailable" and sample_enabled and not log_dir and not databricks_configured():
        days, status, missed = from_sample(household)
        source = "sample"
    if source == "unavailable" and note is None:
        note = "Real history is not connected yet. Configure event logging or Databricks."
    result = {
        "household": household, "source": source, "note": note,
        "days": days, "status": status, "missed": missed,
        "dashboard_url": os.environ.get("DATABRICKS_DASHBOARD_URL") or None,
    }
    _cache[cache_key] = (time.time(), result)
    return result
