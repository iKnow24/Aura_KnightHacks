import * as THREE from 'three'

// Turns a rigged figure's bones to copy a MediaPipe body pose. Works with any Mixamo-style skeleton
// (Mixamo characters, or a Blender model rigged with Mixamo bone names).

const MIN_VIS = 0.5 // ignore body points MediaPipe isn't sure about (legs under a desk)

// bone: [from point, to point, child bone]. Points are MediaPipe indexes; 'hips', 'chest', 'ears' are midpoints.
const RIG = [
  ['Spine', 'hips', 'chest', 'Spine1'],
  ['Neck', 'chest', 'ears', 'Head'],
  ['LeftArm', 11, 13, 'LeftForeArm'],
  ['LeftForeArm', 13, 15, 'LeftHand'],
  ['RightArm', 12, 14, 'RightForeArm'],
  ['RightForeArm', 14, 16, 'RightHand'],
  ['LeftUpLeg', 23, 25, 'LeftLeg'],
  ['LeftLeg', 25, 27, 'LeftFoot'],
  ['RightUpLeg', 24, 26, 'RightLeg'],
  ['RightLeg', 26, 28, 'RightFoot'],
]
const MIDS = { hips: [23, 24], chest: [11, 12], ears: [7, 8] }

// MediaPipe world points (meters, y down, z away from the camera) -> three.js (y up, toward the camera).
function point(lm, key) {
  const [a, b] = MIDS[key] ?? [key, key]
  const p = lm[a], q = lm[b]
  return { v: new THREE.Vector3((p[0] + q[0]) / 2, -(p[1] + q[1]) / 2, -(p[2] + q[2]) / 2), vis: Math.min(p[3], q[3]) }
}

// Bones by their end name, so "mixamorig:LeftArm", "mixamorigLeftArm" and "LeftArm" all match.
function findBones(scene) {
  const bones = {}
  scene.traverse((o) => {
    if (o.isBone) bones[o.name.replace(/^mixamorig[:_]?/i, '')] ??= o
  })
  return bones
}

export function makeRig(scene) {
  const bones = findBones(scene)
  return RIG.filter(([b, , , c]) => bones[b] && bones[c]).map(([b, from, to, c]) => ({
    bone: bones[b], from, to,
    rest: bones[c].position.clone().normalize(), // which way the bone points, in its own space
    bind: bones[b].quaternion.clone(),
    smooth: new THREE.Quaternion(), started: false, weight: 0,
  }))
}

const parentQ = new THREE.Quaternion()
const target = new THREE.Quaternion()

// Call every frame after the idle animation has run. lm = 33 x [x, y, z, visibility] or null.
// Bones blend in when tracked and fade back to the idle animation when the person is lost.
export function poseRig(rig, scene, lm, dt) {
  scene.updateMatrixWorld(true)
  const ease = 1 - Math.exp(-dt * 14)
  for (const r of rig) {
    const a = lm && point(lm, r.from), b = lm && point(lm, r.to)
    const tracked = a && b && a.vis > MIN_VIS && b.vis > MIN_VIS
    r.weight += ((tracked ? 1 : 0) - r.weight) * (1 - Math.exp(-dt * 4))
    if (tracked) {
      // Turn the bone so it points from `a` to `b`, measured in its parent's space.
      const dir = b.v.sub(a.v).normalize().applyQuaternion(r.bone.parent.getWorldQuaternion(parentQ).invert())
      target.setFromUnitVectors(r.rest, dir)
      if (!r.started) { r.smooth.copy(r.bone.quaternion); r.started = true }
      r.smooth.slerp(target, ease)
    } else if (r.weight < 0.01) r.started = false
    if (r.weight > 0.001) {
      r.bone.quaternion.slerp(r.smooth, r.weight)
      r.bone.updateMatrixWorld(true)
    }
  }
}

// Models without an idle clip: start each frame from the rest pose.
export function resetRig(rig) {
  for (const r of rig) r.bone.quaternion.copy(r.bind)
}
