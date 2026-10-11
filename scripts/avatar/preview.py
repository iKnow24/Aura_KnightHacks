"""Renders front / three-quarter / face close-up previews of a built avatar .glb into one PNG.

    blender -b --python scripts/avatar/preview.py -- AVATAR.glb OUT.png
"""
import math
import os
import sys

import bpy
from mathutils import Vector

src, out = sys.argv[sys.argv.index("--") + 1:][:2]
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
top = max((o.matrix_world @ Vector(c)).z for o in meshes for c in o.bound_box)

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x, scene.render.resolution_y = 420, 760
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new("w")
scene.world.color = (0.02, 0.02, 0.022)
scene.view_settings.view_transform = "Standard"

def light(name, loc, energy, kind="AREA", size=2.0):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    if kind == "AREA":
        data.size = size
    obj = bpy.data.objects.new(name, data)
    obj.location = loc
    obj.rotation_euler = (Vector((0, 0, top * 0.6)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(obj)

light("key", (1.5, -2.5, top + 0.6), 160)
light("fill", (-2.0, -2.0, top * 0.6), 60)
light("rim", (0.5, 2.5, top + 0.5), 90)

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
scene.camera = cam

shots = [  # (camera position, look-at, lens mm)
    ((0, -4.2, top * 0.55), (0, 0, top * 0.5), 50),
    ((2.6, -3.2, top * 0.62), (0, 0, top * 0.5), 50),
    ((0, -0.75, top - 0.12), (0, 0, top - 0.13), 50),
]
paths = []
for i, (pos, at, lens) in enumerate(shots):
    cam.location = pos
    cam.rotation_euler = (Vector(at) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens
    p = f"{out}.{i}.png"
    scene.render.filepath = p
    bpy.ops.render.render(write_still=True)
    paths.append(p)

# Side by side into one image.
imgs = [bpy.data.images.load(p) for p in paths]
w, h = imgs[0].size
sheet = bpy.data.images.new("sheet", w * len(imgs), h)
px = [0.0] * (w * len(imgs) * h * 4)
for i, im in enumerate(imgs):
    src_px = list(im.pixels)
    for y in range(h):
        o = (y * w * len(imgs) + i * w) * 4
        px[o:o + w * 4] = src_px[y * w * 4:(y + 1) * w * 4]
sheet.pixels = px
sheet.filepath_raw = out
sheet.file_format = "PNG"
sheet.save()
for p in paths:
    os.remove(p)
print("PREVIEW", out, "top", round(top, 2))
