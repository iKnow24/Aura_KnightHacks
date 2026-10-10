"""Writes web/public/splats/sample-room.splat: a small fake room made of Gaussian splats.

It only exists so the Room view in the captions corner has something to show before a real scan
of the demo room is dropped in. Real scans come from a phone app (Scaniverse exports .spz).

.splat format: 32 bytes per splat = position (3 float32), scale (3 float32), color RGBA (4 uint8),
rotation quaternion (4 uint8, mapped from -1..1 to 0..255). Units are meters, y is up.
Run: python scripts/make_sample_splat.py
"""
import random
import struct
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "web" / "public" / "splats" / "sample-room.splat"
random.seed(7)
splats = []


def add(x, y, z, size, gray, alpha=230):
    g = max(0, min(255, int(gray + random.uniform(-10, 10))))
    splats.append((x, y, z, size, g, alpha))


def box(x0, x1, y0, y1, z0, z1, step, gray):
    """Fill the surface of a box with splats (a solid-looking piece of furniture)."""
    def rng(a, b):
        n = max(1, int((b - a) / step))
        return [a + (b - a) * (i + 0.5) / n for i in range(n)]
    for x in rng(x0, x1):
        for z in rng(z0, z1):
            add(x, y1, z, step * 0.7, gray)  # top
    for y in rng(y0, y1):
        for x in rng(x0, x1):
            add(x, y, z0, step * 0.7, gray - 25)
            add(x, y, z1, step * 0.7, gray - 25)
        for z in rng(z0, z1):
            add(x0, y, z, step * 0.7, gray - 35)
            add(x1, y, z, step * 0.7, gray - 35)


# Floor: 6 m x 5 m, centered on you, slight checker so it reads as a surface.
for i in range(120):
    for j in range(100):
        x, z = -3 + (i + random.random()) * 0.05, -3 + (j + random.random()) * 0.05
        add(x, 0, z, 0.04, 58 if (int(x * 2) + int(z * 2)) % 2 else 50, 255)
# Low walls on three sides (a dollhouse cut, so the top-down camera can see in).
for i in range(120):
    for k in range(16):
        x, y = -3 + i * 0.05, k * 0.05
        add(x, y, -3, 0.04, 92)
for j in range(100):
    for k in range(16):
        z, y = -3 + j * 0.05, k * 0.05
        add(-3, y, z, 0.04, 80)
        add(3, y, z, 0.04, 80)
# Furniture: couch, coffee table, kitchen counter, a bed in the corner.
box(-2.6, -0.8, 0, 0.45, -2.8, -2.0, 0.06, 150)    # couch
box(-2.2, -1.2, 0, 0.4, -1.6, -1.0, 0.06, 190)    # coffee table
box(1.6, 2.9, 0, 0.9, -2.9, -1.0, 0.06, 210)      # counter
box(1.0, 2.9, 0, 0.5, 0.6, 1.9, 0.07, 120)        # bed

OUT.parent.mkdir(parents=True, exist_ok=True)
with OUT.open("wb") as f:
    for x, y, z, s, g, a in splats:
        f.write(struct.pack("<3f3f4B4B", x, y, z, s, s, s, g, g, g, a, 255, 128, 128, 128))
print(f"{len(splats)} splats, {OUT.stat().st_size / 1e6:.1f} MB -> {OUT}")
