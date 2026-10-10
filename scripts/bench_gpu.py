"""Time Lumen's sound model and Whisper on the AMD GPU vs the CPU.

Run on the AMD box from the repo folder:   python3 scripts/bench_gpu.py
It uses the models already downloaded by the brain. Prints median milliseconds per clip.
Clips are synthetic (an alarm-like beep pattern for AST, noise + tone for Whisper), so these numbers
are model speed, not accuracy.
"""
import statistics
import time

import numpy as np
import torch
from transformers import pipeline

SR = 16_000
RUNS = 20


def beeps(seconds=3.0):
    t = np.arange(int(SR * seconds)) / SR
    on = (np.floor(t * 4) % 2 == 0)  # 4 beeps a second, like a smoke alarm
    return (0.5 * np.sin(2 * np.pi * 3100 * t) * on).astype(np.float32)


def speechish(seconds=4.0):
    t = np.arange(int(SR * seconds)) / SR
    return (0.05 * np.random.randn(t.size) + 0.2 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def bench(task, model, clip, device):
    pipe = pipeline(task, model=model, device=device)
    for _ in range(3):  # warm-up (first GPU calls compile kernels)
        pipe({"raw": clip, "sampling_rate": SR})
    times = []
    for _ in range(RUNS):
        if device == 0:
            torch.cuda.synchronize()
        start = time.perf_counter()
        pipe({"raw": clip, "sampling_rate": SR})
        if device == 0:
            torch.cuda.synchronize()
        times.append((time.perf_counter() - start) * 1000)
    del pipe
    return statistics.median(times)


def main():
    gpu = torch.cuda.is_available()
    print("GPU:", torch.cuda.get_device_name(0) if gpu else "none", "| torch", torch.__version__)
    jobs = [
        ("Sound alerts (AST, 3 s clip)", "audio-classification", "MIT/ast-finetuned-audioset-10-10-0.4593", beeps()),
        ("Speech (Whisper small.en, 4 s clip)", "automatic-speech-recognition", "openai/whisper-small.en", speechish()),
    ]
    rows = []
    for name, task, model, clip in jobs:
        g = bench(task, model, clip, 0) if gpu else float("nan")
        c = bench(task, model, clip, -1)
        rows.append((name, g, c))
        print(f"{name}: GPU {g:.0f} ms, CPU {c:.0f} ms, {c / g:.1f}x faster on GPU")
    print("\nMarkdown for the README:\n")
    print("| Model | AMD GPU (median) | CPU (median) | Speed-up |\n|---|---|---|---|")
    for name, g, c in rows:
        print(f"| {name} | {g:.0f} ms | {c:.0f} ms | {c / g:.1f}x |")


if __name__ == "__main__":
    main()
