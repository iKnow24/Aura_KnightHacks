"""Keeps track of every connected screen and sends each alert to the right ones."""
import time
from fastapi import WebSocket

from .eventlog import record
from .modes import MODES


class Hub:
    def __init__(self, mode: str):
        self.mode = mode
        # role -> set of sockets. Roles: dashboard, hud, strobe, node
        self.clients: dict[str, set[WebSocket]] = {}
        # node_id -> {"zone": str, "last_seen": float}
        self.nodes: dict[str, dict] = {}
        self.events: list[dict] = []

    async def connect(self, ws: WebSocket, role: str):
        await ws.accept()
        self.clients.setdefault(role, set()).add(ws)
        await ws.send_json({"type": "state", **self.state()})

    def disconnect(self, ws: WebSocket, role: str):
        self.clients.get(role, set()).discard(ws)

    def state(self) -> dict:
        return {
            "mode": self.mode,
            "modes": {k: v["label"] for k, v in MODES.items()},
            "nodes": self.nodes,
            "events": self.events[-50:],
        }

    def heartbeat(self, node_id: str, zone: str):
        self.nodes[node_id] = {"zone": zone, "last_seen": time.time()}

    async def broadcast(self, roles: list[str], msg: dict):
        for role in roles:
            for ws in list(self.clients.get(role, set())):
                try:
                    await ws.send_json(msg)
                except Exception:
                    self.disconnect(ws, role)

    async def emit_alert(self, kind: str, zone: str, severity: str, source: str, confidence: float = 1.0):
        event = {
            "type": "alert",
            "id": f"{time.time():.3f}",
            "kind": kind,  # e.g. smoke_alarm, doorbell, name_called, fall
            "zone": zone,
            "severity": severity,  # critical | warning | info
            "source": source,  # which detector, or "fake"
            "confidence": confidence,
            "ts": time.time(),
        }
        self.events.append(event)
        record(event)
        routes = MODES[self.mode]["routes"].get(severity, [])
        await self.broadcast(routes, event)
        # The dashboard always gets the timeline, even when the mode doesn't route there.
        if "dashboard" not in routes:
            await self.broadcast(["dashboard"], {**event, "routed": False})
        return event

    async def ack(self, alert_id: str, by: str = "wearer") -> dict | None:
        """Someone tapped the alert. Every screen drops it, and the dashboard shows when it was seen."""
        event = next((e for e in reversed(self.events) if e["id"] == alert_id), None)
        if event is None:
            return None
        if "acked" not in event:
            event["acked"] = {"ts": time.time(), "by": by}
            record({"type": "ack", "id": alert_id, **event["acked"]})
            await self.broadcast(list(self.clients), {"type": "ack", "id": alert_id, **event["acked"]})
        return event

    async def set_mode(self, mode: str):
        self.mode = mode
        record({"type": "mode", "mode": mode})
        await self.broadcast(list(self.clients), {"type": "state", **self.state()})
