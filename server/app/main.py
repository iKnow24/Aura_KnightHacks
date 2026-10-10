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
from .detectors.ast_sound import SoundClassifier, loudness_rise, to_alerts
from .detectors.fall import FallDetector
from .detectors.items import ItemFinder, decode
from .detectors.speech import Segmenter, Transcriber, mentions_name
from .agent import answer
from .llm import local as local_llm
from .recap import recap
from .hub import Hub
from .memory import Memory, seed_demo
from .modes import DEFAULT_MODE, MODES

@asynccontextmanager
async def lifespan(app):
    # Load the sound model in the background so the first real alert isn't slowed by it.
    loop = asyncio.get_running_loop()
    for model in (sound_model, transcriber, item_finder, local_llm):
        loop.run_in_executor(None, model.available)
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

# Memory for "Ask Lumen": what was said (Whisper) and where things were last seen (OWLv2).
memory = Memory()
profile = {"name": os.environ.get("LUMEN_NAME", "")}  # set at login; used for name calling
transcriber = Transcriber()
segmenters: dict[str, Segmenter] = {}
item_finder = ItemFinder()
items_busy: set[str] = set()


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
        for a in to_alerts(scores, MODES[hub.mode].get("sound_kinds"), loudness_rise(audio)):
            await emit_detected(a["kind"], zone, a["severity"], "ast_sound", a["confidence"])
    finally:
        ast_busy.discard(node_id)


async def run_speech(zone: str, audio: np.ndarray):
    text = await asyncio.to_thread(transcriber.transcribe, audio)
    if not text:
        return
    entry = memory.add_speech(zone, text)
    await hub.broadcast(["dashboard", "hud"], {"type": "caption", **entry})
    if enabled("name_call") and mentions_name(text, profile["name"]):
        await emit_detected("name_called", zone, "warning", source="whisper")


async def run_items(node_id: str, zone: str, jpeg: str):
    items_busy.add(node_id)
    try:
        hits = await asyncio.to_thread(lambda: item_finder.find(decode(jpeg)))
        for h in hits:
            memory.add_sighting(zone, h["item"], h["confidence"], h["thumb"])
            await hub.broadcast(["dashboard"], {"type": "sighting", "item": h["item"], "zone": zone, "ts": time.time()})
    except Exception as e:  # a bad frame shouldn't kill the node socket
        print("item finder error:", e)
    finally:
        items_busy.discard(node_id)


# Rear-facing phone (Outside mode): the phone's own object detector says something behind
# the wearer is getting bigger in frame fast. The brain only decides what to call it.
APPROACH_KINDS = {"person": ("person_behind", "warning"), "bicycle": ("bike_behind", "warning"),
                  "car": ("vehicle_behind", "critical"), "truck": ("vehicle_behind", "critical"),
                  "bus": ("vehicle_behind", "critical"), "motorcycle": ("vehicle_behind", "critical")}


async def handle_approach(zone: str, data: dict):
    hit = APPROACH_KINDS.get(data.get("label", ""))
    if hit and enabled("rear_vision"):
        await emit_detected(hit[0], zone, hit[1], source="rear_vision", confidence=float(data.get("score", 1.0)))


def enabled(detector: str) -> bool:
    return detector in MODES[hub.mode]["detectors"]


class FakeAlert(BaseModel):
    kind: str = "smoke_alarm"
    zone: str = "kitchen"
    severity: str = "critical"


class ModeChange(BaseModel):
    mode: str


class Question(BaseModel):
    question: str


class Profile(BaseModel):
    name: str


class Ack(BaseModel):
    id: str
    by: str = "wearer"


class Segment(BaseModel):
    text: str
    ts: float | None = None


class RecapRequest(BaseModel):
    segments: list[Segment]
    title: str = "Lecture"


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


@app.post("/api/ack")
async def ack(body: Ack):
    event = await hub.ack(body.id, body.by)
    return event or {"error": "unknown alert"}


@app.post("/api/recap")
async def make_recap(body: RecapRequest):
    """End of a lecture: summary, memory map, quiz. Local model first, rules if none."""
    segs = [s.model_dump() for s in body.segments]
    return await asyncio.to_thread(recap, segs, body.title)


@app.post("/api/mode")
async def set_mode(body: ModeChange):
    if body.mode not in MODES:
        return {"error": f"unknown mode {body.mode}"}
    await hub.set_mode(body.mode)
    return {"mode": hub.mode}


@app.post("/api/profile")
def set_profile(body: Profile):
    """Demo login: the name is what name calling listens for. No passwords, nothing stored."""
    profile["name"] = body.name.strip()
    return profile


@app.post("/api/ask")
async def ask(body: Question):
    return await asyncio.to_thread(answer, body.question, memory, hub.events)


@app.get("/api/memory")
def get_memory():
    return {"entries": [{k: v for k, v in e.items() if k != "thumb"} for e in memory.entries[-100:]],
            "models": {"whisper": model_status(transcriber), "items": model_status(item_finder),
                       "llm": model_status(local_llm)}}


def model_status(model) -> str:
    return "off" if model._failed else "ready" if model._pipe is not None else "loading"


@app.post("/api/memory/seed")
def seed_memory():
    """Fills memory with a believable history so the agent can be rehearsed without the models."""
    seed_demo(memory)
    return {"entries": len(memory.entries)}


@app.delete("/api/memory")
def clear_memory():
    memory.clear()
    return {"entries": 0}


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
    """Camera/mic phones. Binary messages = 16 kHz mono float32 audio.
    Text = JSON: {"type": "pose", ...} at 10 fps, {"type": "snapshot", "jpeg": dataURL} every few seconds."""
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
                if not transcriber._failed:
                    utterance = segmenters.setdefault(node_id, Segmenter()).feed(chunk)
                    if utterance is not None:
                        asyncio.create_task(run_speech(zone, utterance))
            elif msg.get("text"):
                data = json.loads(msg["text"])
                if data.get("type") == "pose" and enabled("fall"):
                    stillness = MODES[hub.mode].get("fall_stillness_s", 8)
                    det = fall_detectors.setdefault(node_id, FallDetector(stillness))
                    det.stillness_s = stillness
                    if det.update(data["ts"], data.get("landmarks")):
                        await emit_detected("fall", zone, "critical", source="fall")
                elif data.get("type") == "approach":
                    await handle_approach(zone, data)
                elif data.get("type") == "snapshot" and node_id not in items_busy and not item_finder._failed:
                    asyncio.create_task(run_items(node_id, zone, data["jpeg"]))
            hub.heartbeat(node_id, zone)
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(ws, "node")
