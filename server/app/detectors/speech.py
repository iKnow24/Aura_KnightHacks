"""Speech: cut each node's audio into utterances, then transcribe them with Whisper.

The segmenter is plain loudness gating (no model), so it's testable anywhere. Whisper loads
lazily like the AST model and switches itself off if transformers/torch are missing.

Whisper invents text on noise ("Thank you.", "you"). Those known ghosts are dropped.
"""
import logging
import os
import re

import numpy as np

log = logging.getLogger(__name__)

SAMPLE_RATE = 16_000
# Phones stream with auto-gain off, so speech is quiet. Raise this if fans or traffic get transcribed.
SPEECH_RMS = float(os.environ.get("SPEECH_RMS", "0.012"))
END_SILENCE_S = 0.8
MIN_SPEECH_S = 0.6
MAX_SEGMENT_S = 12

GHOSTS = {"", "you", "thank you", "thanks for watching", "thank you for watching", "bye", "okay", "so"}


class Segmenter:
    """Feed audio chunks; get back a finished utterance (np.ndarray) when someone stops talking."""

    def __init__(self, threshold: float = SPEECH_RMS):
        self.threshold = threshold
        self.buf: list[np.ndarray] = []
        self.voiced = 0  # samples above threshold in this segment
        self.silence = 0  # trailing quiet samples

    def feed(self, chunk: np.ndarray) -> np.ndarray | None:
        loud = float(np.sqrt(np.mean(chunk ** 2))) > self.threshold if len(chunk) else False
        if not self.buf and not loud:
            return None
        self.buf.append(chunk)
        if loud:
            self.voiced += len(chunk)
            self.silence = 0
        else:
            self.silence += len(chunk)
        total = sum(len(c) for c in self.buf)
        if self.silence >= END_SILENCE_S * SAMPLE_RATE or total >= MAX_SEGMENT_S * SAMPLE_RATE:
            audio, voiced = np.concatenate(self.buf), self.voiced
            self.buf, self.voiced, self.silence = [], 0, 0
            if voiced >= MIN_SPEECH_S * SAMPLE_RATE:
                return audio
        return None


def clean(text: str) -> str | None:
    text = text.strip()
    if re.sub(r"[^a-z ]", "", text.lower()).strip() in GHOSTS:
        return None
    return text


class Transcriber:
    def __init__(self):
        self._pipe = None
        self._failed = False

    def available(self) -> bool:
        return self._load() is not None

    def _load(self):
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
        return clean(pipe({"raw": audio, "sampling_rate": SAMPLE_RATE})["text"])


def mentions_name(text: str, name: str) -> bool:
    return bool(name) and re.search(rf"\b{re.escape(name.lower())}\b", text.lower()) is not None
