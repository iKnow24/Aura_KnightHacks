import asyncio
import base64
import json
from collections import deque
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

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
from .detectors.voices import Voices, name_in
from .agent import answer
from .llm import local as local_llm
from .recap import recap
from .speakers import CrossTalk
from . import eventlog, hazard
from .direction import locate
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
    models = (sound_model, transcriber, voices, item_finder, local_llm)
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
# Spoken lines land in data/conversations.jsonl (text only). Tests opt out with LUMEN_TESTING=1.
memory = Memory(None if os.environ.get("LUMEN_TESTING") == "1"
                else Path(__file__).resolve().parents[2] / "data" / "conversations.jsonl")
profile = {"name": os.environ.get("LUMEN_NAME", "")}  # set at login; used for name calling
transcriber = Transcriber()
voices = Voices()  # who's talking, by voiceprint (named ones saved to VOICE_FILE)
# Instant captions have text before a voiceprint exists. After "my name is Sharan" on a mic,
# later lines from that same mic keep the name until someone else introduces themselves.
named_mics: dict[str, str] = {}
segmenters: dict[str, Segmenter] = {}
item_finder = ItemFinder()
items_busy: set[str] = set()

# Scene JSON (detectors/scene.py): the latest one per camera for the dashboard, recent model
# times for /api/vision, and each node's latest pose so a photo can say "standing" or "lying".
latest_vision: dict[str, dict] = {}
vision_ms: deque = deque(maxlen=500)
last_pose: dict[str, tuple[float, list | None]] = {}
last_phone_scene: dict[str, float] = {}
last_headset_look: dict[str, float] = {}
last_direction = 0.0


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


async def _maybe_direction():
    """About twice a second, line up every live mic and tell the dashboard which side heard it."""
    global last_direction
    if time.monotonic() - last_direction < 0.45:
        return
    last_direction = time.monotonic()
    tails = {}
    for nid, audio in audio_buffers.items():
        zone = hub.nodes.get(nid, {}).get("zone")
        if zone and len(audio) >= 4000:
            tails[zone] = audio
    if len(tails) < 2:
        return
    found = locate(tails)
    if found:
        await hub.broadcast(["dashboard", "hud"], {"type": "direction", **found, "ts": time.time()})


PARTIAL_EVERY_S = float(os.environ.get("PARTIAL_EVERY_S", "0.7"))  # rough caption this often while someone talks (0 = off)
partial_at: dict[str, float] = {}
partial_busy: set[str] = set()  # one partial per phone at a time, so a slow CPU never backs up


def feed_speech(node_id: str, zone: str, chunk: np.ndarray):
    if transcriber._failed:
        return
    seg = segmenters.setdefault(node_id, Segmenter())
    utterance = seg.feed(chunk)
    if utterance is not None:
        asyncio.create_task(run_speech(zone, utterance, seg.span))
    elif PARTIAL_EVERY_S and node_id not in partial_busy and time.time() - partial_at.get(node_id, 0) >= PARTIAL_EVERY_S:
        audio = seg.so_far()
        if audio is not None:
            partial_at[node_id] = time.time()
            partial_busy.add(node_id)
            asyncio.create_task(run_partial(node_id, seg, zone, audio))


async def run_partial(node_id: str, seg: Segmenter, zone: str, audio: np.ndarray):
    """Words so far, shown greyed out on the caption screens until the finished line replaces them."""
    done = seg.done
    start = seg.start
    try:
        text = await asyncio.to_thread(transcriber.transcribe, audio)
    finally:
        partial_busy.discard(node_id)
    if text and seg.done == done:  # skip it if the sentence already finished while Whisper ran
        # start_ts/end_ts are when the words were *said*, so a caption screen can match them to the
        # mouth that was moving right then instead of guessing from how long Whisper took.
        await hub.broadcast(["hud", "dashboard"], {"type": "caption_partial", "zone": zone, "text": text,
                                                   "ts": time.time(), "start_ts": start, "end_ts": time.time()})


async def run_speech(zone: str, audio: np.ndarray, span: tuple[float, float] | None = None):
    text = await asyncio.to_thread(transcriber.transcribe, audio)
    if not text:
        return
    keep, replaced = crosstalk.check(zone, text, float(np.sqrt(np.mean(audio ** 2))))
    if not keep:
        return  # a louder phone already captioned this sentence
    entry = memory.add_speech(zone, text)
    msg = {**entry, "type": "caption", "id": caption_id(entry)}
    if span:
        msg["start_ts"], msg["end_ts"] = span
    if replaced:
        old = next((e for e in reversed(memory.entries) if e.get("type") == "speech"
                    and e["zone"] == replaced["zone"] and e["text"] == replaced["text"]), None)
        if old:
            memory.entries.remove(old)
            memory.save()
            msg["replaces"] = caption_id(old)
    await hub.broadcast(["dashboard", "hud"], msg)
    # The words go out first; who said it follows a moment later as a small patch on the same line.
    # (Naming the voice is another model pass, and a caption shouldn't wait for it.)
    asyncio.create_task(name_voice(msg["id"], entry, audio, text))
    if enabled("name_call") and mentions_name(text, profile["name"]):
        await emit_detected("name_called", zone, "warning", source="whisper")


async def name_voice(line_id: str, entry: dict, audio: np.ndarray, text: str):
    """Voiceprint match for a line already on screen: {"type": "caption_voice", "id": ..., "voice": ...}."""
    voice = await asyncio.to_thread(voices.label, audio, text)
    if not voice:
        return
    memory.set_voice(entry["ts"], voice["voice"])
    await hub.broadcast(["dashboard", "hud"], {"type": "caption_voice", "id": line_id, "ts": entry["ts"], **voice})


def pose_now(node_id: str) -> tuple[str | None, bool]:
    """(posture, someone in view) from this node's pose stream, if it reported in the last 2 s."""
    seen_at, landmarks = last_pose.get(node_id, (0, None))
    if time.monotonic() - seen_at > 2:
        return None, False
    return scene.posture(landmarks), bool(landmarks)


async def look_at(node_id: str, zone: str, jpeg: str) -> dict | None:
    """One OWLv2 pass per still: item sightings for Ask Lumen + one scene JSON line. The photo is dropped here."""
    prompts, thresholds, labels = scene.queries()

    def look():
        image = decode(jpeg)
        hits, timing = item_finder.detect(image, prompts, thresholds)
        return hits, timing, items_from_hits(image, hits), image.size

    hits, timing, items, (width, height) = await asyncio.to_thread(look)
    for h in items:
        memory.add_sighting(zone, h["item"], h["confidence"], h["thumb"])
        await hub.broadcast(["dashboard"], {"type": "sighting", "item": h["item"], "zone": zone, "ts": time.time()})
    if not timing:
        return None
    event = scene.build(node_id, zone, time.time(), hits, labels, width, height, timing, *pose_now(node_id))
    await publish_vision(event)
    return event


async def run_items(node_id: str, zone: str, jpeg: str):
    items_busy.add(node_id)
    try:
        await look_at(node_id, zone, jpeg)
    except Exception as e:  # a bad frame shouldn't kill the node socket
        print("item finder error:", e)
    finally:
        items_busy.discard(node_id)


async def publish_vision(event: dict):
    previous = latest_vision.get(event["node_id"])
    changed = scene.change_sentence(event["zone"], previous, event)
    counts = scene.watched_counts(event)
    if counts:
        memory.note_scene(event["zone"], counts, event.get("summary", ""))
    if changed:
        text, lost, still = changed
        event["change"] = text
        memory.note_change(event["zone"], text, lost, still)
        if any(label in scene.DRINKS for label in lost):
            event["risk"] = {"score": max(event.get("risk", {}).get("score", 0), 74), "level": "warning",
                             "why": "a drink left the scene"}
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


async def handle_spill(zone: str, data: dict):
    # The kitchen phone decided a new puddle is sitting on the counter. Same rule as a
    # rear-camera approach: the phone measures, the brain only sends the alert.
    # The scene JSON says which drink was there a moment ago, so Ask Lumen can name it.
    if enabled("spill"):
        seen = next((e for e in reversed(list(latest_vision.values())) if e.get("zone") == zone), None)
        drinks = [label for label in ("cup", "bottle") if (seen or {}).get("counts", {}).get(label)]
        what = drinks[0] if drinks else "drink"
        memory.note_change(zone, f"A {what} spilled in the {zone}. The scene JSON had shown it there just before.",
                           lost=drinks or [what], seen=[])
        await emit_detected("spill", zone, "warning", source="spill_vision", confidence=float(data.get("score", 0.8)))


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


class Look(BaseModel):
    jpeg: str
    zone: str = "living"


class SceneBoxes(BaseModel):
    zone: str = "living"
    objects: list[dict] = []


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


@app.post("/api/look")
async def look(body: Look):
    """The dashboard's own laptop camera, about once a second: what's in this frame (the white headset
    is one of the scene words), so the camera wall can draw the boxes on the same frame. The photo is dropped; only the JSON is kept."""
    if item_finder._failed:
        raise HTTPException(503, "vision model is off")
    if not body.jpeg.startswith("data:image/jpeg;base64,") or len(body.jpeg) > 400_000:
        raise HTTPException(400, "send a small JPEG data URL")
    if "dashboard-camera" in items_busy:
        raise HTTPException(429, "still looking at the last frame")
    items_busy.add("dashboard-camera")
    try:
        return await look_at("dashboard-camera", body.zone, body.jpeg) or {}
    finally:
        items_busy.discard("dashboard-camera")


@app.post("/api/hazard")
async def hazard_note(body: Look):
    """Opt-in "watch out" note for one dashboard camera still, written by Gemini. Advice only: it never fires
    an alert. The photo is answered and dropped; only the note text goes in the event log."""
    if not body.jpeg.startswith("data:image/jpeg;base64,") or len(body.jpeg) > 400_000:
        raise HTTPException(400, "send a small JPEG data URL")
    if "hazard" in items_busy:
        return {"enabled": True, "notes": [], "wait": True}
    items_busy.add("hazard")
    try:
        result = await asyncio.to_thread(hazard.look, body.jpeg)
    finally:
        items_busy.discard("hazard")
    if result.get("notes"):
        eventlog.record({"type": "hazard_note", "zone": body.zone, "notes": result["notes"],
                         "model": result.get("model"), "advisory": True})
    return result


@app.post("/api/scene-boxes")
async def scene_boxes(body: SceneBoxes):
    """The laptop camera measured its own boxes because the big vision model is off on this machine."""
    event = scene.from_boxes("laptop-camera", body.zone, time.time(), body.objects)
    await publish_vision(event)
    return event


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


def voice_on_mic(zone: str, text: str) -> str | None:
    """The name they just said, or the name this mic already introduced."""
    said = name_in(text)
    if said:
        named_mics[zone] = said
        return said
    return named_mics.get(zone)


@app.post("/api/speech")
async def heard(body: Heard):
    """Captions made in the browser (Instant mode). Saved, and sent to the dashboard, which is not on that phone."""
    text = body.text.strip()
    if text:
        voice = voice_on_mic(body.zone, text)
        entry = memory.add_speech(body.zone, text, voice=voice)
        if body.speaker is not None:
            entry.update(speaker=body.speaker, to_you=body.to_you)
        if voice:
            entry["voice_known"] = voice == name_in(text) or voice in voices.book.people
        await hub.broadcast(["dashboard", "hud"], {**entry, "type": "caption", "id": caption_id(entry)})
    return {"ok": True}


@app.post("/api/speech/partial")
async def heard_partial(body: Heard):
    """Words still being said, so the dashboard is not a sentence behind the mouth."""
    text = body.text.strip()
    if text:
        voice = named_mics.get(body.zone)
        msg = {"type": "caption_partial", "zone": body.zone, "text": text, "ts": time.time()}
        if voice:
            msg["voice"] = voice
        await hub.broadcast(["dashboard", "hud"], msg)
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


class PresenterDir(BaseModel):
    corner: int  # 1 top right, 2 top left, 3 bottom right, 4 bottom left


@app.post("/api/presenter_dir")
async def presenter_dir(body: PresenterDir):
    """The presenter says which corner a sound came from (keys 1-4 on the dashboard). This is a
    demo control, not sound localization: it is sent as `presenter_set` and logged that way."""
    if body.corner not in (1, 2, 3, 4):
        return {"error": "corner must be 1, 2, 3 or 4"}
    msg = {"type": "presenter_dir", "corner": body.corner, "presenter_set": True, "ts": time.time()}
    eventlog.record(msg)
    await hub.broadcast(["hud", "dashboard"], msg)
    return {"ok": True}


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


@app.get("/api/voices")
def get_voices():
    """Whose voices the brain knows (names and line counts, never the voiceprints) and recent match scores."""
    return {"model": model_status(voices), **voices.book.summary()}


class VoiceClip(BaseModel):
    audio: str  # base64 of 16 kHz mono float32, from the Voices page
    name: str = ""


def clip_vec(body: VoiceClip):
    try:
        audio = np.frombuffer(base64.b64decode(body.audio), np.float32)
        return voices.embed_clip(audio)
    except ValueError as e:
        raise HTTPException(400, str(e) or "Couldn't read that recording.")


@app.post("/api/voices/enroll")
def enroll_voice(body: VoiceClip):
    """Voices page: save this person's voice (each extra recording makes it more reliable)."""
    name = " ".join(body.name.split())[:30].title()
    if not name:
        raise HTTPException(400, "Type a name first.")
    try:
        audio = np.frombuffer(base64.b64decode(body.audio), np.float32)
        if len(audio) > 10 * 16000:  # the 60 s script: averaged over many pieces
            voices.enroll_long(name, audio)
        else:
            voices.book.enroll(name, voices.embed_clip(audio))
    except ValueError as e:
        raise HTTPException(400, str(e) or "Couldn't read that recording.")
    return voices.book.summary()


@app.get("/api/voices/backup")
def backup_voices():
    """Download the team's saved voiceprints (named ones only), to restore on a rebuilt box."""
    return voices.book.backup()


@app.post("/api/voices/restore")
def restore_voices(body: dict):
    try:
        voices.book.restore(body)
    except (ValueError, KeyError, TypeError) as e:
        raise HTTPException(400, str(e) or "That isn't a Lumen voices backup.")
    return voices.book.summary()


@app.post("/api/voices/who")
def who_is_this(body: VoiceClip):
    """Voices page test: which saved voice does this recording match?"""
    return voices.book.who(clip_vec(body))


class VoiceName(BaseModel):
    name: str


@app.post("/api/voices/remove")
def remove_voice(body: VoiceName):
    voices.book.remove(body.name)
    return voices.book.summary()


@app.post("/api/voices/forget")
def forget_voices():
    voices.book.forget()
    return {"ok": True}


@app.get("/api/memory")
def get_memory():
    speech = [e for e in memory.entries if e.get("type") == "speech"][-500:]
    other = [e for e in memory.entries if e.get("type") != "speech"][-50:]
    return {"entries": [{k: v for k, v in e.items() if k != "thumb"} for e in other + speech],
            "models": {"whisper": model_status(transcriber), "voices": model_status(voices), "items": model_status(item_finder),
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
                # Do not play this mic on the dashboard. Speakers into a nearby mic come back
                # a moment later, like a phone call. The brain still analyzes the audio below.
                # The headset mic is analyzed here, on this machine: the beep detector (no model,
                # no API), the local sound model, and local Whisper. Nothing in this block calls out.
                buf = np.concatenate([audio_buffers.get(node_id, np.zeros(0, np.float32)), chunk])[-AUDIO_WINDOW:]
                audio_buffers[node_id] = buf
                await _maybe_direction()
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
                    # Room cameras stay off unless the demo flag is set. The headset is the screen
                    # the dashboard is supposed to show, so its picture is forwarded either way.
                    # Never pass full frames to memory or the event log.
                    jpeg = data.get("jpeg")
                    preview_ok = zone == WEARER or os.environ.get("LUMEN_DEMO_PREVIEW") == "1"
                    if (preview_ok and isinstance(jpeg, str) and jpeg.startswith("data:image/jpeg;base64,")
                            and len(jpeg) <= 400_000 and time.monotonic() - last_preview >= 0.9):
                        last_preview = time.monotonic()
                        await hub.broadcast(["dashboard"], {"type": "camera_preview", "node_id": node_id,
                                                            "zone": zone, "ts": time.time(), "jpeg": jpeg})
                        # Same local vision pass as a room photo. The frame is dropped after; only labels stay.
                        if (zone == WEARER and node_id not in items_busy and not item_finder._failed
                                and time.monotonic() - last_headset_look.get(node_id, 0) >= 2):
                            last_headset_look[node_id] = time.monotonic()
                            asyncio.create_task(run_items(node_id, zone, jpeg))
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
                elif data.get("type") == "spill":
                    await handle_spill(zone, data)
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
                          last_phone_scene, last_headset_look):
                cache.pop(node_id, None)
