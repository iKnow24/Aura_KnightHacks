import asyncio
import json
import os
import time
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .detectors import alarm_dsp
from .detectors.ast_sound import SoundClassifier, to_alerts
from .detectors.fall import FallDetector
from .hub import Hub
from .modes import DEFAULT_MODE, MODES

@asynccontextmanager
async def lifespan(app):
    # Load the sound model in the background so the first real alert isn't slowed by it.
    asyncio.get_running_loop().run_in_executor(None, sound_model.available)
    yield


app = FastAPI(title="Lumen brain", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
hub = Hub(os.environ.get("MODE", DEFAULT_MODE))

# Rolling ~3 s audio buffer per node for the alarm detector.
audio_buffers: dict[str, np.ndarray] = {}
AUDIO_WINDOW = alarm_dsp.SAMPLE_RATE * 3
fall_detectors: dict[str, FallDetector] = {}

# AI sound model: classify each node's last 3 s once per second, skipping a turn if the
# previous run hasn't finished (keeps a slow CPU from building up a backlog).
sound_model = SoundClassifier()
AST_HOP = alarm_dsp.SAMPLE_RATE  # 1 s of new audio between runs
ast_pending: dict[str, int] = {}
ast_busy: set[str] = set()
COOLDOWN_S = 10
last_alert: dict[tuple[str, str], float] = {}


async def emit_detected(kind: str, zone: str, severity: str, source: str, confidence: float = 1.0):
    """Detector alerts go through a per-room cooldown so one alarm doesn't fire 20 times,
    and the DSP and the AI model don't both report the same smoke alarm."""
    key = (zone, kind)
    if time.time() - last_alert.get(key, 0) < COOLDOWN_S:
        return
    last_alert[key] = time.time()
    await hub.emit_alert(kind, zone, severity, source=source, confidence=confidence)


async def run_ast(node_id: str, zone: str, audio: np.ndarray):
    ast_busy.add(node_id)
    try:
        scores = await asyncio.to_thread(sound_model.classify, audio)
        for a in to_alerts(scores):
            await emit_detected(a["kind"], zone, a["severity"], "ast_sound", a["confidence"])
    finally:
        ast_busy.discard(node_id)


def enabled(detector: str) -> bool:
    return detector in MODES[hub.mode]["detectors"]


class FakeAlert(BaseModel):
    kind: str = "smoke_alarm"
    zone: str = "kitchen"
    severity: str = "critical"


class ModeChange(BaseModel):
    mode: str


@app.get("/api/health")
def health():
    return {"ok": True, "mode": hub.mode}


@app.get("/api/state")
def state():
    return hub.state()


@app.post("/api/fake-alert")
async def fake_alert(body: FakeAlert):
    """Lets the frontend team build everything before any real detector works."""
    return await hub.emit_alert(body.kind, body.zone, body.severity, source="fake")


@app.post("/api/mode")
async def set_mode(body: ModeChange):
    if body.mode not in MODES:
        return {"error": f"unknown mode {body.mode}"}
    await hub.set_mode(body.mode)
    return {"mode": hub.mode}


@app.websocket("/ws/{role}")
async def screen_socket(ws: WebSocket, role: str):
    """Screens that only listen: dashboard, hud, strobe."""
    await hub.connect(ws, role)
    try:
        while True:
            await ws.receive_text()  # keepalive pings
    except WebSocketDisconnect:
        hub.disconnect(ws, role)


@app.websocket("/ws/node/{node_id}")
async def node_socket(ws: WebSocket, node_id: str, zone: str = "unknown"):
    """Camera/mic phones. Binary messages = 16 kHz mono float32 audio. Text = JSON (heartbeat, pose)."""
    await hub.connect(ws, "node")
    hub.heartbeat(node_id, zone)
    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if msg.get("bytes"):
                chunk = np.frombuffer(msg["bytes"], dtype=np.float32)
                buf = np.concatenate([audio_buffers.get(node_id, np.zeros(0, np.float32)), chunk])[-AUDIO_WINDOW:]
                audio_buffers[node_id] = buf
                if len(buf) == AUDIO_WINDOW and enabled("alarm_dsp") and alarm_dsp.is_alarm(buf):
                    await emit_detected("smoke_alarm", zone, "critical", source="alarm_dsp")
                    audio_buffers[node_id] = np.zeros(0, np.float32)  # don't re-fire on the same beeps
                ast_pending[node_id] = ast_pending.get(node_id, 0) + len(chunk)
                if (len(buf) == AUDIO_WINDOW and enabled("ast_sound") and ast_pending[node_id] >= AST_HOP
                        and node_id not in ast_busy):
                    ast_pending[node_id] = 0
                    asyncio.create_task(run_ast(node_id, zone, buf.copy()))
            elif msg.get("text"):
                data = json.loads(msg["text"])
                if data.get("type") == "pose" and enabled("fall"):
                    stillness = MODES[hub.mode].get("fall_stillness_s", 8)
                    det = fall_detectors.setdefault(node_id, FallDetector(stillness))
                    det.stillness_s = stillness
                    if det.update(data["ts"], data.get("landmarks")):
                        await emit_detected("fall", zone, "critical", source="fall")
            hub.heartbeat(node_id, zone)
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(ws, "node")
