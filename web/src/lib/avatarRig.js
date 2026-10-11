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

// A person standing relaxed, in MediaPipe world points: arms down, slow breathing, a slight sway and
// the head drifting a little. Drives figures that have no idle animation clip (the Blender avatar),
// and fills in body parts the webcam can't see (legs under a desk) so they stand naturally.
export function idlePose(t) {
  const breath = Math.sin(t * 1.25) * 0.005, sway = Math.sin(t * 0.45) * 0.012, look = Math.sin(t * 0.3) * 0.015
  const lm = Array.from({ length: 33 }, () => [0, 0, 0, 0])
  const set = (i, x, y, z = 0) => { lm[i] = [x, y, z, 1] }
  for (const s of [1, -1]) {
    const L = s > 0
    set(L ? 11 : 12, s * 0.18 + sway, -0.46 - breath)
    set(L ? 13 : 14, s * 0.22 + sway * 0.6, -0.19 - breath * 0.5, -0.01)
    set(L ? 15 : 16, s * 0.23 + sway * 0.3, 0.06, -0.05)
    set(L ? 23 : 24, s * 0.1, 0)
    set(L ? 25 : 26, s * 0.1, 0.43, -0.01)
    set(L ? 27 : 28, s * 0.1, 0.85)
    set(L ? 7 : 8, s * 0.07 + sway + look, -0.62 - breath, -0.035)
  }
  return lm
}

// A walk cycle in the same point space, used where the camera cannot see the legs.
export function walkPose(t) {
  const lm = idlePose(t)
  const s = Math.sin(t * 6.2)
  const swing = (ankle, knee, sign) => {
    const lift = Math.max(0, sign * s)
    lm[ankle][2] = sign * s * 0.2
    lm[ankle][1] = 0.85 - lift * 0.14
    lm[knee][2] = sign * s * 0.1
    lm[knee][1] = 0.43 - lift * 0.1
  }
  swing(27, 25, 1)
  swing(28, 26, -1)
  lm[15][2] = -s * 0.14
  lm[16][2] = s * 0.14
  return lm
}

// Real webcam points where MediaPipe is sure of them. Missing points stand, or walk when `walking`.
export function withIdle(lm, t, walking = false) {
  const idle = walking ? walkPose(t) : idlePose(t)
  return lm ? lm.map((p, i) => (p[3] > 0.5 ? p : idle[i])) : idle
}

// True once the legs are stepping, or the shoulders are bouncing like a walk. `state` is a small object
// the caller keeps so a single frame of noise does not flip the gait.
export function isWalking(lm, state, dt) {
  if (!lm) { state.walk = 0; return false }
  let moving = 0
  if (lm[27][3] > 0.45 && lm[28][3] > 0.45) {
    const lift = Math.abs(lm[27][1] - lm[28][1])
    const spread = Math.abs((lm[27][2] || 0) - (lm[28][2] || 0))
    moving = lift > 0.05 || spread > 0.08 ? 1 : 0
  } else if (lm[11][3] > 0.5 && lm[12][3] > 0.5) {
    const y = (lm[11][1] + lm[12][1]) / 2
    if (state.shoulder != null) {
      const v = Math.abs(y - state.shoulder) / Math.max(dt, 0.02)
      state.bounce = (state.bounce || 0) * 0.8 + v * 0.2
      moving = state.bounce > 0.25 ? 1 : 0
    }
    state.shoulder = y
  }
  state.walk = (state.walk || 0) + ((moving - (state.walk || 0)) * Math.min(1, dt * 4))
  return state.walk > 0.4
}

// Models without an idle clip: start each frame from the rest pose.
export function resetRig(rig) {
  for (const r of rig) r.bone.quaternion.copy(r.bind)
}
