"""Builds the dashboard's realistic avatar of our headset wearer in Blender, with open-source parts only.

Run (Blender 4.2+ with the MPFB extension and the MakeHuman CC0 system assets installed):
    blender -b --python scripts/avatar/build_avatar.py -- OUT.glb [FACE_PHOTO_DIR]

What it does:
1. MPFB (MakeHuman for Blender, GPLv3) builds a young male body matched to his build and skin tone, on
   the Mixamo skeleton, so the dashboard's webcam pose code drives it unchanged.
2. MakeHuman CC0 assets dress it like the demo photos: white tee and jeans, white sneakers, a button
   shirt cut to short sleeves, opened down the front and recolored taupe, short curly hair.
3. If a face photo folder is given, face_from_photo.py fits his face (see that file).
4. Exports a .glb for web/public/models/avatar.glb.

Photos of a person never go in the repo. Keep them outside it (we used Desktop/aura/avatar-photos).
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(ARGS[0] if ARGS else "avatar.glb")
PHOTOS = ARGS[1] if len(ARGS) > 1 else None

SHIRT = (0.2, 0.145, 0.105, 1)  # taupe brown, from the photos (linear color)
SKIN_TINT = (0.96, 0.87, 0.79)  # warms the light MakeHuman skin a little toward his light-medium tan
HAIR_SHRINK = (0.9, 0.92, 0.86)  # sideways, front-back, up: afro -> short curly top with faded sides


def human_info():
    info = {
        "phenotype": {
            "gender": 1.0, "age": 0.36,  # ~19
            "muscle": 0.5, "weight": 0.42, "proportions": 0.65, "height": 0.62,
            "cupsize": 0.5, "firmness": 0.5,
            "race": {"caucasian": 0.55, "african": 0.3, "asian": 0.15},
        },
        "rig": "mixamo",
        "eyes": "high-poly/high-poly.mhclo",
        "eyebrows": "eyebrow010/eyebrow010.mhclo",
        "eyelashes": "eyelashes02/eyelashes02.mhclo",
        "teeth": "teeth_base/teeth_base.mhclo",
        "tongue": "tongue01/tongue01.mhclo",
        "hair": "afro01/afro01.mhclo",
        "clothes": [
            "male_casualsuit06/male_casualsuit06.mhclo",  # white tee + jeans
            "shoes05/shoes05.mhclo",  # white sneakers
            "male_casualsuit01/male_casualsuit01.mhclo",  # button shirt, turned into the open short-sleeve one
        ],
        "skin_mhmat": "skins/young_caucasian_male2/young_caucasian_male2.mhmat",
        "skin_material_type": "GAMEENGINE",
        "eyes_material_type": "GAMEENGINE",
        "eyes_material_settings": {},
        "clothes_material_type": "GAMEENGINE",
        "skin_material_settings": {},
        "targets": [],
        "proxy": "",
        "alternative_materials": {},
    }
    return info


def find(kind):
    return [o for o in bpy.data.objects if o.type == "MESH" and kind.lower() in o.name.lower()]


def bone_head(rig, name):
    return rig.matrix_world @ rig.data.bones[f"mixamorig:{name}"].head_local


def edit_verts(obj, delete):
    """Delete the vertices of obj (in world space, rest pose) for which delete(co) is true."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    mw = obj.matrix_world
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if delete(mw @ v.co)], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()


def flat_material(obj, rgba, roughness=0.75):
    for slot in obj.material_slots:
        m = slot.material
        if not m or not m.use_nodes:
            continue
        bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf:
            continue
        for link in list(bsdf.inputs["Base Color"].links):
            m.node_tree.links.remove(link)
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = roughness


def tint_images(obj, tint):
    for slot in obj.material_slots:
        m = slot.material
        if not m or not m.use_nodes:
            continue
        for n in m.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image and "diffuse" in n.image.name.lower():
                img = n.image
                px = list(img.pixels)
                for i in range(0, len(px), 4):
                    px[i] *= tint[0]; px[i + 1] *= tint[1]; px[i + 2] *= tint[2]
                img.pixels = px
                img.pack()


def opaque_materials():
    """Skin and clothes export as solid (layers see-through otherwise flicker); hair, brows and lashes keep a cut-out edge."""
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf:
            continue
        if any(k in m.name for k in ("afro", "eyebrow", "eyelash", "high-poly")):  # eyes need their clear cornea
            continue
        for link in list(bsdf.inputs["Alpha"].links):
            m.node_tree.links.remove(link)
        bsdf.inputs["Alpha"].default_value = 1.0


def shrink_images(max_size=1024):
    for img in bpy.data.images:
        if img.size[0] > max_size or img.size[1] > max_size:
            s = max_size / max(img.size)
            img.scale(int(img.size[0] * s), int(img.size[1] * s))
            img.pack()


def build():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    settings = HumanService.get_default_deserialization_settings()
    settings["subdiv_levels"] = 0
    basemesh = HumanService.deserialize_from_dict(human_info(), settings)
    rig = basemesh.parent if basemesh.parent and basemesh.parent.type == "ARMATURE" else next(o for o in bpy.data.objects if o.type == "ARMATURE")

    # The long-sleeved shirt hides the arm skin under it; we cut its sleeves short, so show the arms again.
    for m in list(basemesh.modifiers):
        if m.type == "MASK" and "casualsuit01" in m.name:
            basemesh.modifiers.remove(m)

    TargetService.bake_targets(basemesh)
    # His face, before any clothes are cut: fitting it refits every worn asset to the new face.
    if PHOTOS:
        sys.path.insert(0, os.path.dirname(__file__))
        import face_from_photo
        face_from_photo.apply(basemesh, rig, PHOTOS)  # also matches the skin tone to the photo
    else:
        tint_images(basemesh, SKIN_TINT)

    # Short curls: shrink the afro toward the middle of the skull, more on the sides (faded) than on top.
    eyes = find("high-poly")
    for hair in find("afro"):
        ex = [eyes[0].matrix_world @ v.co for v in eyes[0].data.vertices] if eyes else []
        eye_z = sum(c.z for c in ex) / len(ex) if ex else bone_head(rig, "Head").z + 0.07
        center = Vector((0, sum(c.y for c in ex) / len(ex) + 0.09 if ex else 0, eye_z + 0.03))
        inv = hair.matrix_world.inverted()
        for v in hair.data.vertices:
            d = hair.matrix_world @ v.co - center
            v.co = inv @ (center + Vector((d.x * HAIR_SHRINK[0], d.y * HAIR_SHRINK[1], d.z * HAIR_SHRINK[2])))

    # The button shirt: keep only the shirt (not its trousers), cut sleeves just above the elbow, open the front.
    shirts = [o for o in find("casualsuit01")]
    if shirts:
        shirt = shirts[0]
        hips_z = bone_head(rig, "Hips").z
        l_arm, r_arm = bone_head(rig, "LeftArm"), bone_head(rig, "RightArm")
        chest_front = min((shirt.matrix_world @ v.co).y for v in shirt.data.vertices)  # MakeHuman faces -Y
        def drop(c):
            if c.z < hips_z - 0.09:
                return True  # trousers
            if min((c - l_arm).length, (c - r_arm).length) > 0.24 and abs(c.x) > 0.2:
                return True  # sleeve below the elbow
            return c.y < chest_front + 0.06 and abs(c.x) < 0.05 and c.z < l_arm.z - 0.02  # the open front
        edit_verts(shirt, drop)
        # Under the shirt, keep only the bit of tee that shows through the open front (and the jeans below),
        # so the tee never pokes through the shirt.
        for tee in find("casualsuit06"):
            tee_front = min((tee.matrix_world @ v.co).y for v in tee.data.vertices)
            edit_verts(tee, lambda c: c.z > hips_z - 0.07 and not (c.y < tee_front + 0.09 and abs(c.x) < 0.075))
        flat_material(shirt, SHIRT, 0.85)
        # Sit a few millimetres outside the tee so the two don't flicker through each other.
        for v in shirt.data.vertices:
            v.co += v.normal * 0.009

    opaque_materials()

    shrink_images()
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    for child in rig.children_recursive:
        child.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_skins=True, export_morph=True, export_animations=False,
                              export_image_format="JPEG", export_jpeg_quality=85)
    print("WROTE", OUT, os.path.getsize(OUT))


build()
