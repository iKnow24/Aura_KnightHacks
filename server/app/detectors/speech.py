"""Speech: cut each node's audio into utterances, then transcribe them with Whisper.

The segmenter is plain loudness gating (no model), so it's testable anywhere. Whisper runs
either on Groq's free API (WHISPER_PROVIDER=groq plus GROQ_API_KEY: large-v3 quality, no GPU
needed, but the audio clip goes to Groq) or locally, loading lazily like the AST model and
switching itself off if transformers/torch are missing.

Whisper invents text on noise ("Thank you.", "you"). Those known ghosts are dropped, and so are
its stuck-record loops ("I mean, I mean, I mean, ...") which get cut down to one copy.

While someone is still talking, `Segmenter.so_far()` hands out the audio heard so far, so the brain
can send a rough "partial" caption every second instead of making people wait for the pause.
"""
import io
import logging
import os
import re
import threading
import time
import wave

import numpy as np

log = logging.getLogger(__name__)

SAMPLE_RATE = 16_000
# Phones stream with auto-gain off, so speech is quiet. Raise this if fans or traffic get transcribed.
SPEECH_RMS = float(os.environ.get("SPEECH_RMS", "0.012"))
END_SILENCE_S = 0.6
MIN_SPEECH_S = 0.6
MAX_SEGMENT_S = 8  # long monologues get cut here; partial captions cover the wait


GHOSTS = {"", "you", "thank you", "thanks for watching", "thank you for watching", "bye", "okay", "so"}


class Segmenter:
    """Feed audio chunks; get back a finished utterance (np.ndarray) when someone stops talking."""

    def __init__(self, threshold: float = SPEECH_RMS):
        self.threshold = threshold
        self.buf: list[np.ndarray] = []
        self.voiced = 0  # samples above threshold in this segment
        self.silence = 0  # trailing quiet samples
        self.done = 0  # counts finished utterances, so a slow partial can tell it's out of date
        self.start: float | None = None  # clock time this utterance started
        self.span: tuple[float, float] | None = None  # (start, end) of the utterance just returned

    def feed(self, chunk: np.ndarray, ts: float | None = None) -> np.ndarray | None:
        """`ts` is the clock time this chunk arrived (defaults to now); it times the utterance."""
        ts = time.time() if ts is None else ts
        loud = float(np.sqrt(np.mean(chunk ** 2))) > self.threshold if len(chunk) else False
        if not self.buf and not loud:
            return None
        if not self.buf:
            # The chunk we're adding was recorded just before it arrived.
            self.start = ts - len(chunk) / SAMPLE_RATE
        self.buf.append(chunk)
        if loud:
            self.voiced += len(chunk)
            self.silence = 0
        else:
            self.silence += len(chunk)
        total = sum(len(c) for c in self.buf)
        if self.silence >= END_SILENCE_S * SAMPLE_RATE or total >= MAX_SEGMENT_S * SAMPLE_RATE:
            audio, voiced = np.concatenate(self.buf), self.voiced
            # The trailing quiet isn't speech, so the words ended before it.
            self.span = (self.start if self.start is not None else ts, ts - self.silence / SAMPLE_RATE)
            self.buf, self.voiced, self.silence, self.start = [], 0, 0, None
            self.done += 1
            if voiced >= MIN_SPEECH_S * SAMPLE_RATE:
                return audio
        return None

    def so_far(self) -> np.ndarray | None:
        """The current utterance up to now, once there's enough speech in it to be worth a partial."""
        if self.voiced < MIN_SPEECH_S * SAMPLE_RATE:
            return None
        return np.concatenate(self.buf)


# The same 1 to 6 words said 4+ times in a row ("That's it. That's it. That's it. That's it.").
# People do say "no, no, no", so three in a row is left alone.
LOOP = re.compile(r"((?:\S+\s+){1,6}?)\1{3,}", re.IGNORECASE)


def clean(text: str) -> str | None:
    text = LOOP.sub(r"\1", text.strip() + " ").strip()
    if re.sub(r"[^a-z ]", "", text.lower()).strip() in GHOSTS:
        return None
    return text


class Transcriber:
    def __init__(self):
        self._pipe = None
        self._failed = False
        self._lock = threading.Lock()  # partials and finals share one model; take turns on the GPU

    def available(self) -> bool:
        return self._load() is not None

    def _load(self):
        if self._pipe is None and not self._failed and os.environ.get("WHISPER_PROVIDER") == "groq":
            try:
                from openai import OpenAI

                client = OpenAI(base_url="https://api.groq.com/openai/v1", api_key=os.environ["GROQ_API_KEY"], timeout=20)
                self._pipe = lambda audio: {"text": client.audio.transcriptions.create(
                    file=("speech.wav", to_wav(audio["raw"])), model="whisper-large-v3-turbo", language="en").text}
                log.info("Whisper via Groq")
            except Exception as e:
                self._failed = True
                log.warning("Groq Whisper off (%s).", e)
        if self._pipe is None and not self._failed:
            try:
                import torch
                from transformers import pipeline

                gpu = torch.cuda.is_available()  # ROCm shows up as "cuda"
                model = os.environ.get("WHISPER_MODEL", "openai/whisper-small.en" if gpu else "openai/whisper-base.en")
                self._pipe = pipeline("automatic-speech-recognition", model=model, device=0 if gpu else -1)
                log.info("Whisper %s loaded on %s", model, "GPU" if gpu else "CPU")
            except Exception as e:
                self._failed = True
                log.warning("Whisper off (%s). Speech memory and name calling won't run.", e)
        return self._pipe

    def transcribe(self, audio: np.ndarray) -> str | None:
        pipe = self._load()
        if pipe is None:
            return None
        with self._lock:
            return clean(pipe({"raw": audio, "sampling_rate": SAMPLE_RATE})["text"])


def to_wav(audio: np.ndarray) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
    return out.getvalue()


def mentions_name(text: str, name: str) -> bool:
    return bool(name) and re.search(rf"\b{re.escape(name.lower())}\b", text.lower()) is not None
