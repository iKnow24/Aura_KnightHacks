"""One place to ask a language model for JSON, local first.

Order, first one that answers wins (LUMEN_LLM_ORDER, default "claude,hf"):
  - "claude": Claude, if ANTHROPIC_API_KEY is set. Biggest context, best answers. The default.
  - "hf": Hugging Face Inference Providers with HF_TOKEN (the team's credits).
  - "local": a small open model on our own AMD GPU (LUMEN_LOCAL_LLM, default Qwen2.5-3B-Instruct).
     Nothing leaves the box, but a 3B model is far weaker and its GPU memory competes with Whisper.
     Add it to the order to turn it on. Off on CPU-only machines unless LUMEN_LOCAL_LLM_CPU=1.
Each returns None on failure and the caller falls back to plain rules, so the demo never
depends on a model. Safety alerts never go through here (see CLAUDE.md).
"""
import json
import logging
import os
import threading
import urllib.request

log = logging.getLogger(__name__)

LOCAL_MODEL = os.environ.get("LUMEN_LOCAL_LLM", "Qwen/Qwen2.5-3B-Instruct")
HF_MODEL = os.environ.get("LUMEN_HF_LLM", "Qwen/Qwen2.5-7B-Instruct")  # any chat model a provider serves
HF_URL = "https://router.huggingface.co/v1/chat/completions"
CLAUDE_MODEL = os.environ.get("LUMEN_LLM", "claude-haiku-5-5")
ORDER = [b.strip() for b in os.environ.get("LUMEN_LLM_ORDER", "claude,hf").split(",") if b.strip()]


class LocalLLM:
    def __init__(self):
        self._pipe = None
        self._failed = "local" not in ORDER or LOCAL_MODEL.lower() in ("", "off", "none")
        self._lock = threading.Lock()  # one generation at a time on the GPU

    def available(self) -> bool:
        return self._load() is not None

    def _load(self):
        if self._pipe is None and not self._failed:
            try:
                import torch
                from transformers import pipeline

                gpu = torch.cuda.is_available()  # ROCm shows up as "cuda"
                if not gpu and os.environ.get("LUMEN_LOCAL_LLM_CPU") != "1":
                    raise RuntimeError("no GPU")
                self._pipe = pipeline("text-generation", model=LOCAL_MODEL, device=0 if gpu else -1,
                                      torch_dtype="auto")
                log.info("Local LLM %s loaded on %s", LOCAL_MODEL, "GPU" if gpu else "CPU")
            except Exception as e:
                self._failed = True
                log.warning("Local LLM off (%s). Using Hugging Face, Claude, or rules instead.", e)
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


def _hf(system: str, user: str, max_tokens: int) -> str | None:
    token = os.environ.get("HF_TOKEN")
    if not token:
        return None
    body = json.dumps({"model": HF_MODEL, "max_tokens": max_tokens, "temperature": 0.2,
                       "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]})
    req = urllib.request.Request(HF_URL, data=body.encode(), method="POST",
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())["choices"][0]["message"]["content"]


def _claude(system: str, user: str, max_tokens: int) -> str | None:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return None
    import anthropic

    resp = anthropic.Anthropic().messages.create(model=CLAUDE_MODEL, max_tokens=max_tokens, system=system,
                                                 messages=[{"role": "user", "content": user}])
    return "".join(b.text for b in resp.content if b.type == "text")


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
    brains = {"local": local.chat, "hf": _hf, "claude": _claude}
    for name in ORDER:
        fn = brains.get(name)
        if fn is None:
            continue
        try:
            data = parse_json(fn(system, user, max_tokens))
        except Exception as e:
            log.warning("%s LLM failed (%s)", name, e)
            continue
        if data is not None:
            return data, name
    return None, "rules"
