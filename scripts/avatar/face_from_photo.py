"""Fits the MPFB avatar's face to a front photo of the person (called by build_avatar.py).

1. Render the model's face straight on, find MediaPipe's 478 face points on the render and on the photo
   (face_landmarks.py, run with the repo's .venv Python).
2. Shape: line the photo's points up with the render's (move, turn, scale), then move the face vertices
   toward the photo's points (smoothly, capped) so eye spacing, nose, mouth and jaw take his proportions.
   Eyes, brows, lashes and teeth are refitted to the new face.
3. Texture: tint the whole skin toward his skin tone, then project the photo onto the face and bake it into
   the skin texture, feathered at the edges.

Photo needs: straight on, no headset or glasses, even light, neutral face. front.jpg/.png/.webp in the folder.
"""
import json
import os
import subprocess
import sys

import bpy
import numpy as np
from mathutils import Vector

from bl_ext.user_default.mpfb.services.humanservice import HumanService

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
VENV_PY = os.path.join(REPO, ".venv", "Scripts" if os.name == "nt" else "bin", "python.exe" if os.name == "nt" else "python")
RES = 1024
VIEW = 0.30  # metres of face shown in the front render
SHAPE_STRENGTH = 0.85
MAX_MOVE = 0.012  # metres; never move a face point further than this
SIGMA = 0.012  # metres; how far each face point's pull spreads

# MediaPipe face-oval point indexes, in order around the face.
OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
        148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
CHEEKS = [50, 280, 205, 425, 187, 411]


def find_photo(folder):
    for name in ("front", "face"):
        for ext in (".jpg", ".jpeg", ".png", ".webp", ".JPG", ".PNG"):
            p = os.path.join(folder, name + ext)
            if os.path.exists(p):
                return p
    pics = sorted(f for f in os.listdir(folder) if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp")))
    return os.path.join(folder, pics[0]) if pics else None


def upright_copy(photo, work):
    """Phones store photos sideways plus a rotate flag; make a plain upright PNG both tools agree on."""
    code = ("import sys; from PIL import Image, ImageOps; "
            "ImageOps.exif_transpose(Image.open(sys.argv[1])).convert('RGB').save(sys.argv[2])")
    out = os.path.join(work, "front_upright.png")
    subprocess.run([VENV_PY, "-c", code, photo, out], check=True)
    return out


def landmarks(*images):
    res = subprocess.run([VENV_PY, os.path.join(HERE, "face_landmarks.py"), *images], check=True, capture_output=True, text=True)
    return json.loads(res.stdout)


def face_center(basemesh):
    eyes = [o for o in bpy.data.objects if o.type == "MESH" and "high-poly" in o.name]
    pts = [eyes[0].matrix_world @ v.co for v in eyes[0].data.vertices]
    return sum(pts, Vector()) / len(pts)


def render_front(center, work):
    scene = bpy.context.scene
    hidden = []
    for o in bpy.data.objects:
        if o.type == "MESH" and any(k in o.name for k in ("afro", "casualsuit", "shoes", "hair")):
            hidden.append((o, o.hide_render))
            o.hide_render = True
    cam = bpy.data.objects.new("face_cam", bpy.data.cameras.new("face_cam"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = VIEW
    cam.location = (center.x, center.y - 1.0, center.z - 0.03)
    cam.rotation_euler = (1.5707963, 0, 0)  # looking along +Y at the face
    scene.collection.objects.link(cam)
    lamp = bpy.data.objects.new("face_lamp", bpy.data.lights.new("face_lamp", "SUN"))
    lamp.data.energy = 3.0
    lamp.rotation_euler = (1.4, 0, 0.2)
    scene.collection.objects.link(lamp)
    scene.camera = cam
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = RES
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "Standard"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("face_world")
    scene.world.color = (0.35, 0.35, 0.35)
    path = os.path.join(work, "model_front.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o, h in hidden:
        o.hide_render = h
    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.objects.remove(lamp, do_unlink=True)
    to_world = lambda p: np.stack([center.x + (p[:, 0] / RES - 0.5) * VIEW, (center.z - 0.03) - (p[:, 1] / RES - 0.5) * VIEW], 1)
    return path, to_world


def similarity(src, dst):
    """Least-squares move + turn + uniform scale taking src points onto dst points."""
    ms, md = src.mean(0), dst.mean(0)
    a, b = src - ms, dst - md
    u, s, vt = np.linalg.svd(b.T @ a)
    r = u @ vt
    if np.linalg.det(r) < 0:
        u[:, -1] *= -1
        r = u @ vt
    scale = s.sum() / (a ** 2).sum()
    return lambda p: (scale * (r @ (p - ms).T)).T + md, (scale, r, ms, md)


def inside(poly, pts):
    """Even-odd test: which pts lie inside the polygon."""
    x, y = pts[:, 0], pts[:, 1]
    res = np.zeros(len(pts), bool)
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi, xj, yj = poly[i][0], poly[i][1], poly[j][0], poly[j][1]
        cross = ((yi > y) != (yj > y)) & (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi)
        res ^= cross
        j = i
    return res


def edge_distance(poly, pts):
    d = np.full(len(pts), np.inf)
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        ab = b - a
        t = np.clip(((pts - a) @ ab) / (ab @ ab + 1e-12), 0, 1)
        d = np.minimum(d, np.linalg.norm(pts - (a + t[:, None] * ab), axis=1))
    return d


def apply(basemesh, rig, folder):
    photo = find_photo(folder)
    if not photo:
        print("FACE no photo in", folder)
        return
    work = os.path.join(os.environ.get("TEMP", "/tmp"), "lumen_avatar_face")
    os.makedirs(work, exist_ok=True)
    photo = upright_copy(photo, work)

    center = face_center(basemesh)
    render, to_world = render_front(center, work)
    found = landmarks(render, photo)
    if not found.get(render) or not found.get(photo):
        print("FACE no face found:", "model" if not found.get(render) else "photo")
        return
    model = to_world(np.array(found[render]["points"]))  # world (x, z) of the model's face points
    pic_px = np.array(found[photo]["points"])
    pic = pic_px * np.array([1, -1])  # photo pixels, y up
    to_model, _ = similarity(pic, model)
    target = to_model(pic)  # the photo's face points, lined up on the model's face

    # 1. Shape: pull the face toward the photo's proportions.
    move = (target - model) * SHAPE_STRENGTH
    length = np.linalg.norm(move, axis=1, keepdims=True)
    move *= np.minimum(1, MAX_MOVE / np.maximum(length, 1e-9))
    mw, inv = basemesh.matrix_world, basemesh.matrix_world.inverted()
    verts = basemesh.data.vertices
    world = np.array([tuple(mw @ v.co) for v in verts])
    front = world[:, 1] < center.y + 0.05
    xz = world[:, [0, 2]]
    oval = model[OVAL]
    edge = edge_distance(oval, xz)
    falloff = np.where(inside(oval, xz), 1.0, np.clip(1 - edge / 0.025, 0, 1)) * front
    idx = np.nonzero(falloff > 0)[0]
    d2 = ((xz[idx, None, :] - model[None, :, :]) ** 2).sum(-1)
    w = np.exp(-d2 / (2 * SIGMA ** 2))
    shift = (w @ move) / (w.sum(1, keepdims=True) + 1e-6) * falloff[idx, None]
    for k, i in enumerate(idx):
        p = world[i].copy()
        p[0] += shift[k, 0]
        p[2] += shift[k, 1]
        verts[i].co = inv @ Vector(p)
    basemesh.data.update()
    try:
        HumanService.refit(basemesh)  # eyes, brows, lashes, teeth follow the new face
    except Exception as e:
        print("FACE refit skipped:", e)
    world = np.array([tuple(mw @ v.co) for v in verts])
    xz = world[:, [0, 2]]
    model_now = model + move

    # 2. Texture: project the photo onto the face through the same alignment, backwards.
    _, (scale, r, ms, md) = similarity(pic, model_now)
    to_photo = lambda p: ((r.T @ ((p - md) / scale).T).T + ms) * np.array([1, -1])
    w_px, h_px = found[photo]["size"]
    uvs = to_photo(xz) / np.array([w_px, h_px])
    oval_now = model_now[OVAL]
    mask = np.where(inside(oval_now, xz), np.clip(edge_distance(oval_now, xz) / 0.012, 0, 1), 0) * front
    normals = np.array([tuple((mw.to_3x3() @ v.normal).normalized()) for v in verts])
    mask *= np.clip((-normals[:, 1] - 0.25) / 0.4, 0, 1)  # only surfaces facing the camera

    mesh = basemesh.data
    uv_photo = mesh.uv_layers.new(name="photo_uv")
    col = mesh.color_attributes.new("photo_mask", "FLOAT_COLOR", "POINT")
    for i, m in enumerate(mask):
        col.data[i].color = (m, m, m, 1)
    for loop in mesh.loops:
        u, v = uvs[loop.vertex_index]
        uv_photo.data[loop.index].uv = (u, 1 - v)

    skin_mat = basemesh.material_slots[0].material
    nodes, links = skin_mat.node_tree.nodes, skin_mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    skin_tex = bsdf.inputs["Base Color"].links[0].from_node
    skin_img = skin_tex.image

    # Whole-body skin tone: match the texture's cheeks to the photo's cheeks.
    photo_img = bpy.data.images.load(photo)
    ph = np.array(photo_img.pixels[:]).reshape(h_px, w_px, 4)
    cheeks = pic_px[CHEEKS].astype(int)
    photo_tone = np.mean([ph[h_px - 1 - y, x, :3] for x, y in cheeks], 0)
    sw, sh = skin_img.size
    sk = np.array(skin_img.pixels[:]).reshape(sh, sw, 4)
    cheek_verts = [int(np.argmin(((xz - model_now[c]) ** 2).sum(1) + (~front) * 9.0)) for c in CHEEKS]
    uv0 = mesh.uv_layers[0].data
    loops_of = {l.vertex_index: l.index for l in mesh.loops}
    skin_tone = np.mean([sk[int(uv0[loops_of[i]].uv[1] * (sh - 1)), int(uv0[loops_of[i]].uv[0] * (sw - 1)), :3] for i in cheek_verts], 0)
    ratio = np.clip(photo_tone / np.maximum(skin_tone, 1e-3), 0.6, 1.4)
    sk[:, :, :3] = np.clip(sk[:, :, :3] * ratio, 0, 1)
    skin_img.pixels = sk.ravel()

    # Bake: skin texture, with the photo laid over the face through the mask, into a new texture.
    baked = bpy.data.images.new("skin_with_face", 2048, 2048)
    uv_main = nodes.new("ShaderNodeUVMap"); uv_main.uv_map = mesh.uv_layers[0].name
    uv_ph = nodes.new("ShaderNodeUVMap"); uv_ph.uv_map = "photo_uv"
    tex_ph = nodes.new("ShaderNodeTexImage"); tex_ph.image = photo_img; tex_ph.extension = "EXTEND"
    attr = nodes.new("ShaderNodeAttribute"); attr.attribute_name = "photo_mask"
    mix = nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"
    emit = nodes.new("ShaderNodeEmission")
    out = next(n for n in nodes if n.type == "OUTPUT_MATERIAL")
    target_node = nodes.new("ShaderNodeTexImage"); target_node.image = baked
    links.new(uv_main.outputs["UV"], skin_tex.inputs["Vector"])
    links.new(uv_ph.outputs["UV"], tex_ph.inputs["Vector"])
    links.new(attr.outputs["Fac"], mix.inputs["Factor"])
    links.new(skin_tex.outputs["Color"], mix.inputs["A"])
    links.new(tex_ph.outputs["Color"], mix.inputs["B"])
    links.new(mix.outputs["Result"], emit.inputs["Color"])
    old_surface = out.inputs["Surface"].links[0].from_socket
    links.new(emit.outputs["Emission"], out.inputs["Surface"])
    nodes.active = target_node
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    bpy.ops.object.select_all(action="DESELECT")
    basemesh.select_set(True)
    bpy.context.view_layer.objects.active = basemesh
    bpy.ops.object.bake(type="EMIT", margin=6, use_clear=True)

    # Put the material back, now using the baked texture, and drop the helper data.
    links.new(old_surface, out.inputs["Surface"])
    for n in (uv_ph, tex_ph, attr, mix, emit, target_node):
        nodes.remove(n)
    skin_tex.image = baked
    baked.pack()
    mesh.uv_layers.remove(mesh.uv_layers["photo_uv"])
    mesh.color_attributes.remove(mesh.color_attributes["photo_mask"])
    print("FACE fitted from", photo, "tone x", np.round(ratio, 2).tolist())
