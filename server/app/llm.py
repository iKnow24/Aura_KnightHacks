"""Ask a language model for JSON (lecture recap, voice-made modes).

Uses the same provider switch as Ask Lumen (agent.py: LUMEN_LLM=groq|claude|xai|gemini|hf|off, first key
found wins), so there is one setting for the whole app. Optionally, a small open model on our own
AMD GPU (set LUMEN_LOCAL_LLM to a Hugging Face model id, e.g. Qwen/Qwen2.5-3B-Instruct) answers
when no provider does: nothing leaves the box, but it's far weaker and shares the GPU with Whisper.
Every caller falls back to plain rules when this returns None. Safety alerts never come through here.
"""
import json
import logging
import os
import threading

log = logging.getLogger(__name__)

LOCAL_MODEL = os.environ.get("LUMEN_LOCAL_LLM", "")


class LocalLLM:
    def __init__(self):
        self._pipe = None
        self._failed = not LOCAL_MODEL
        self._lock = threading.Lock()  # one generation at a time on the GPU

    def available(self) -> bool:
        return self._load() is not None

    def _load(self):
        if self._pipe is None and not self._failed:
            try:
                import torch
                from transformers import pipeline

                gpu = torch.cuda.is_available()  # ROCm shows up as "cuda"
                self._pipe = pipeline("text-generation", model=LOCAL_MODEL, device=0 if gpu else -1, torch_dtype="auto")
                log.info("Local LLM %s loaded on %s", LOCAL_MODEL, "GPU" if gpu else "CPU")
            except Exception as e:
                self._failed = True
                log.warning("Local LLM off (%s).", e)
        return self._pipe

    def chat(self, system: str, user: str, max_tokens: int) -> str | None:
        pipe = self._load()
        if pipe is None:
            return None
        with self._lock:
            out = pipe([{"role": "system", "content": system}, {"role": "user", "content": user}],
                       max_new_tokens=max_tokens, do_sample=False)
        return out[0]["generated_text"][-1]["content"]


local = LocalLLM()


def _provider(system: str, user: str, max_tokens: int) -> tuple[str | None, str | None]:
    from .agent import pick_provider

    provider = pick_provider()
    if not provider:
        return None, None
    name, base_url, key, model = provider
    from openai import OpenAI

    client = OpenAI(base_url=base_url, api_key=key, timeout=30)
    msg = client.chat.completions.create(model=model, max_tokens=max_tokens, temperature=0.2, messages=[
        {"role": "system", "content": system}, {"role": "user", "content": user}]).choices[0].message
    return msg.content, name


def parse_json(text: str | None) -> dict | None:
    if not text:
        return None
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return None


def chat_json(system: str, user: str, max_tokens: int = 1200) -> tuple[dict | None, str]:
    """Returns (parsed JSON, which brain answered) or (None, "rules") if nobody could."""
    try:
        text, name = _provider(system, user, max_tokens)
        data = parse_json(text)
        if data is not None:
            return data, name
    except Exception as e:
        log.warning("LLM provider failed (%s)", e)
    try:
        data = parse_json(local.chat(system, user, max_tokens))
        if data is not None:
            return data, "local"
    except Exception as e:
        log.warning("Local LLM failed (%s)", e)
    return None, "rules"
