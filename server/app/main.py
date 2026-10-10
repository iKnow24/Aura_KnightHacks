import asyncio
import json
from collections import deque
import os
import time
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, Header, HTTPException, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .detectors import alarm_dsp
from .detectors.ast_sound import SoundClassifier, loudness_rise, to_alerts
from .detectors.fall import FallDetector
from .detectors import scene
from .detectors.items import ItemFinder, decode, items_from_hits
from .detectors.speech import Segmenter, Transcriber, mentions_name
from .agent import answer
from .llm import local as local_llm
from .recap import recap
from .speakers import CrossTalk
from . import eventlog
from .history import history
from .hub import Hub
from .memory import Memory, seed_demo
from .modes import DEFAULT_MODE, MODES, make_mode

@asynccontextmanager
async def lifespan(app):
    # Load the models in the background so the first real alert isn't slowed by them.
    # One after another, sound model first: transformers' lazy imports aren't thread-safe, and loading
    # all four in parallel threads made Whisper and the item finder fail on the AMD box with
    # "cannot import name 'pipeline' from 'transformers'".
    models = (sound_model, transcriber, item_finder, local_llm)
    asyncio.get_running_loop().run_in_executor(None, lambda: [m.available() for m in models])
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

# Scene JSON (detectors/scene.py): the latest one per camera for the dashboard, recent model
# times for /api/vision, and each node's latest pose so a photo can say "standing" or "lying".
latest_vision: dict[str, dict] = {}
vision_ms: deque = deque(maxlen=500)
last_pose: dict[str, tuple[float, list | None]] = {}
last_phone_scene: dict[str, float] = {}


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


crosstalk = CrossTalk()


def caption_id(entry: dict) -> str:
    return f"{entry['ts']:.3f}-{entry['zone']}"


WEARER = "wearer"  # zone name the headset uses for its own mic


PARTIAL_EVERY_S = 1.0  # while someone talks, a rough caption this often (0 turns partials off)
partial_at: dict[str, float] = {}
partial_busy: set[str] = set()  # one partial per phone at a time, so a slow CPU never backs up


def feed_speech(node_id: str, zone: str, chunk: np.ndarray):
    if transcriber._failed:
        return
    seg = segmenters.setdefault(node_id, Segmenter())
    utterance = seg.feed(chunk)
    if utterance is not None:
        asyncio.create_task(run_speech(zone, utterance))
    elif PARTIAL_EVERY_S and node_id not in partial_busy and time.time() - partial_at.get(node_id, 0) >= PARTIAL_EVERY_S:
        audio = seg.so_far()
        if audio is not None:
            partial_at[node_id] = time.time()
            partial_busy.add(node_id)
            asyncio.create_task(run_partial(node_id, seg, zone, audio))


async def run_partial(node_id: str, seg: Segmenter, zone: str, audio: np.ndarray):
    """Words so far, shown greyed out on the caption screens until the finished line replaces them."""
    done = seg.done
    try:
        text = await asyncio.to_thread(transcriber.transcribe, audio)
    finally:
        partial_busy.discard(node_id)
    if text and seg.done == done:  # skip it if the sentence already finished while Whisper ran
        await hub.broadcast(["hud"], {"type": "caption_partial", "zone": zone, "text": text, "ts": time.time()})


async def run_speech(zone: str, audio: np.ndarray):
    text = await asyncio.to_thread(transcriber.transcribe, audio)
    if not text:
        return
    keep, replaced = crosstalk.check(zone, text, float(np.sqrt(np.mean(audio ** 2))))
    if not keep:
        return  # a louder phone already captioned this sentence
    entry = memory.add_speech(zone, text)
    msg = {**entry, "type": "caption", "id": caption_id(entry)}
    if replaced:
        old = next((e for e in reversed(memory.entries) if e.get("type") == "speech"
                    and e["zone"] == replaced["zone"] and e["text"] == replaced["text"]), None)
        if old:
            memory.entries.remove(old)
            msg["replaces"] = caption_id(old)
    await hub.broadcast(["dashboard", "hud"], msg)
    if enabled("name_call") and mentions_name(text, profile["name"]):
        await emit_detected("name_called", zone, "warning", source="whisper")


def pose_now(node_id: str) -> tuple[str | None, bool]:
    """(posture, someone in view) from this node's pose stream, if it reported in the last 2 s."""
    seen_at, landmarks = last_pose.get(node_id, (0, None))
    if time.monotonic() - seen_at > 2:
        return None, False
    return scene.posture(landmarks), bool(landmarks)


async def run_items(node_id: str, zone: str, jpeg: str):
    """One OWLv2 pass per still: item sightings for Ask Lumen + one scene JSON line. The photo is dropped here."""
    items_busy.add(node_id)
    try:
        prompts, thresholds, labels = scene.queries()

        def look():
            image = decode(jpeg)
            hits, timing = item_finder.detect(image, prompts, thresholds)
            return hits, timing, items_from_hits(image, hits), image.size

        hits, timing, items, (width, height) = await asyncio.to_thread(look)
        for h in items:
            memory.add_sighting(zone, h["item"], h["confidence"], h["thumb"])
            await hub.broadcast(["dashboard"], {"type": "sighting", "item": h["item"], "zone": zone, "ts": time.time()})
        if timing:
            await publish_vision(scene.build(node_id, zone, time.time(), hits, labels, width, height, timing,
                                             *pose_now(node_id)))
    except Exception as e:  # a bad frame shouldn't kill the node socket
        print("item finder error:", e)
    finally:
        items_busy.discard(node_id)


async def publish_vision(event: dict):
    latest_vision[event["node_id"]] = event
    if "inference_ms" in event:
        vision_ms.append(event["inference_ms"])
    eventlog.record(event)
    await hub.broadcast(["dashboard"], event)


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


class Heard(BaseModel):
    text: str
    zone: str = "wearer"
    speaker: int | None = None  # person number from the phone's face tracking
    to_you: bool = False


class SpeechTag(BaseModel):
    ts: float
    speaker: int | None = None
    to_you: bool = False


class NewMode(BaseModel):
    description: str


class Segment(BaseModel):
    text: str
    ts: float | None = None


class RecapRequest(BaseModel):
    segments: list[Segment]
    title: str = "Lecture"


@app.get("/api/health")
def health():
    return {"ok": True, "mode": hub.mode}


@app.get("/api/history")
def get_history(household: str | None = None):
    """History tab: Databricks Gold tables when configured, else the committed sample week."""
    return history(household)


@app.get("/api/eventlog")
def get_eventlog(x_lumen_sync_key: str | None = Header(None)):
    """Hourly event files, for scripts/databricks_sync.py. Needs LUMEN_SYNC_KEY (the log holds speech)."""
    if not eventlog.sync_allowed(x_lumen_sync_key):
        raise HTTPException(403, "event log sync is off (set EVENT_LOG_DIR and LUMEN_SYNC_KEY on the brain)")
    return {"files": eventlog.list_files()}


@app.get("/api/eventlog/{name}")
def get_eventlog_file(name: str, offset: int = 0, x_lumen_sync_key: str | None = Header(None)):
    """New lines of one hourly file, starting at byte offset."""
    if not eventlog.sync_allowed(x_lumen_sync_key):
        raise HTTPException(403, "event log sync is off")
    try:
        return Response(eventlog.read_from(name, offset), media_type="application/x-ndjson")
    except (ValueError, FileNotFoundError):
        raise HTTPException(404, "no such file")


@app.get("/api/vision")
def get_vision():
    """Latest scene JSON per camera, and how fast the model has been (the AMD GPU number)."""
    ms = sorted(vision_ms)
    pick = lambda q: ms[min(len(ms) - 1, int(q * len(ms)))] if ms else None  # noqa: E731
    return {"latest": list(latest_vision.values()),
            "speed": {"frames": len(ms), "p50_ms": pick(0.5), "p95_ms": pick(0.95),
                      "device": item_finder.device_name, "model": scene.MODEL_ID}}


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


@app.post("/api/speech")
def heard(body: Heard):
    """Captions made in the browser (Instant mode) get saved too, so Ask Lumen can answer from them."""
    if body.text.strip():
        entry = memory.add_speech(body.zone, body.text)
        if body.speaker is not None:
            entry.update(speaker=body.speaker, to_you=body.to_you)
    return {"ok": True}


@app.post("/api/speech/tag")
def tag_speech(body: SpeechTag):
    """The captions phone worked out who said a Whisper line (lips) and whether they faced the wearer."""
    entry = memory.tag_speech(body.ts, body.speaker, body.to_you)
    return {"ok": entry is not None}


@app.post("/api/modes")
async def add_mode(body: NewMode):
    """'Add a new mode': the wearer describes it out loud, Lumen picks what to listen for."""
    key, mode = await asyncio.to_thread(make_mode, body.description)
    MODES[key] = mode
    await hub.set_mode(key)
    return {"key": key, **mode}


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


class FakeCaption(BaseModel):
    text: str = "Your appointment moved to Thursday at 2."
    zone: str = "wearer"


@app.post("/api/fake-caption")
async def fake_caption(body: FakeCaption):
    """Like a Whisper result, for building and rehearsing the caption screens without a model."""
    entry = memory.add_speech(body.zone, body.text)
    await hub.broadcast(["dashboard", "hud"], {**entry, "type": "caption"})
    return entry


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
    loaded = getattr(model, "_pipe", None) or getattr(model, "_model", None)  # item finder holds _model
    return "off" if model._failed else "ready" if loaded is not None else "loading"


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
    await hub.register_node(ws, node_id, zone)
    last_status = 0
    last_preview = 0
    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            hub.heartbeat(node_id, zone)
            if time.monotonic() - last_status >= 2:
                last_status = time.monotonic()
                await hub.broadcast(["dashboard"], {"type": "state", **hub.state()})
            if msg.get("bytes"):
                chunk = np.frombuffer(msg["bytes"], dtype=np.float32)
                # The wearer's own mic: speech only, alarms are the room nodes' job. Except Outside,
                # where there are no room nodes and this mic is what hears the car horn.
                if zone == WEARER and hub.mode != "outside":
                    feed_speech(node_id, zone, chunk)
                    continue
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
                feed_speech(node_id, zone, chunk)
            elif msg.get("text"):
                data = json.loads(msg["text"])
                if data.get("type") == "camera_preview":
                    # Explicit demo-only opt-in. Never pass full frames to memory or the event log.
                    jpeg = data.get("jpeg")
                    if (os.environ.get("LUMEN_DEMO_PREVIEW") == "1"
                            and isinstance(jpeg, str) and jpeg.startswith("data:image/jpeg;base64,")
                            and len(jpeg) <= 400_000 and time.monotonic() - last_preview >= 0.9):
                        last_preview = time.monotonic()
                        await hub.broadcast(["dashboard"], {"type": "camera_preview", "node_id": node_id,
                                                            "zone": zone, "ts": time.time(), "jpeg": jpeg})
                elif data.get("type") == "pose":
                    last_pose[node_id] = (time.monotonic(), data.get("landmarks"))  # posture for the scene JSON
                    if not enabled("fall"):
                        continue
                    stillness = MODES[hub.mode].get("fall_stillness_s", 8)
                    det = fall_detectors.setdefault(node_id, FallDetector(stillness))
                    det.stillness_s = stillness
                    if det.update(data["ts"], data.get("landmarks")):
                        await emit_detected("fall", zone, "critical", source="fall")
                elif data.get("type") == "approach":
                    await handle_approach(zone, data)
                elif data.get("type") == "scene":
                    # What a camera phone sees right now, for the walking-figure view. Not stored.
                    side = "rear" if zone == "behind" else "front"
                    await hub.broadcast(["hud"], {"type": "scene", "side": side, "objects": data.get("objects", [])[:10],
                                                  "fov": data.get("fov", 50), "ts": time.time()})
                    if time.monotonic() - last_phone_scene.get(node_id, 0) >= scene.EVERY_S:
                        last_phone_scene[node_id] = time.monotonic()
                        await publish_vision(scene.from_phone(node_id, zone, time.time(), data.get("objects") or []))
                elif data.get("type") == "caption_meta":
                    entry = memory.tag_speech(data["ts"], data.get("speaker"), bool(data.get("to_you")))
                    if entry:
                        await hub.broadcast(["dashboard"], {**entry, "type": "caption"})
                elif data.get("type") == "snapshot" and node_id not in items_busy and not item_finder._failed:
                    asyncio.create_task(run_items(node_id, zone, data["jpeg"]))
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(ws, "node")
        if await hub.unregister_node(ws, node_id):
            # Do not join audio or pose from before a disconnect to a new session.
            for cache in (audio_buffers, fall_detectors, ast_pending, segmenters, latest_vision, last_pose,
                          last_phone_scene):
                cache.pop(node_id, None)
