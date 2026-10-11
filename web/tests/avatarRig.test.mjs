import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { idlePose, makeRig, poseRig, withIdle } from '../src/lib/avatarRig.js'

// A tiny Mixamo-named skeleton in T-pose: the left arm points along +x (the figure's left when it faces +z).
function skeleton() {
  const bone = (name, x, y, parent) => {
    const b = new THREE.Bone()
    b.name = `mixamorig${name}`
    b.position.set(x, y, 0)
    parent?.add(b)
    return b
  }
  const hips = bone('Hips', 0, 1)
  const spine = bone('Spine', 0, 0.1, hips)
  bone('Spine1', 0, 0.3, spine)
  const arm = bone('LeftArm', 0.2, 0.3, spine)
  const fore = bone('LeftForeArm', 0.3, 0, arm)
  bone('LeftHand', 0.25, 0, fore)
  const root = new THREE.Group()
  root.add(hips)
  return { root, arm, fore }
}

const pose = (points) => {
  const lm = Array.from({ length: 33 }, () => [0, 0, 0, 0])
  for (const [i, x, y] of points) lm[i] = [x, y, 0, 1]
  return lm
}

test('a raised arm turns the figure\'s arm bones to point up', () => {
  const { root, arm, fore } = skeleton()
  const rig = makeRig(root)
  assert.deepEqual(rig.map((r) => r.bone.name), ['mixamorigSpine', 'mixamorigLeftArm', 'mixamorigLeftForeArm'])
  // MediaPipe: y grows downward, so a raised left elbow and wrist have smaller y than the shoulder.
  const lm = pose([[11, 0.2, -0.5], [13, 0.2, -0.8], [15, 0.2, -1.05]])
  for (let i = 0; i < 80; i++) poseRig(rig, root, lm, 0.1)
  root.updateMatrixWorld(true)
  const dir = (a, b) => b.getWorldPosition(new THREE.Vector3()).sub(a.getWorldPosition(new THREE.Vector3())).normalize()
  assert.ok(dir(arm, fore).y > 0.99, `upper arm points up: ${dir(arm, fore).toArray()}`)
  assert.ok(dir(fore, fore.children[0]).y > 0.99, 'forearm points up')
})

test('a person the camera loses fades back to the idle pose', () => {
  const { root, arm } = skeleton()
  const rig = makeRig(root)
  const lm = pose([[11, 0.2, -0.5], [13, 0.2, -0.8], [15, 0.2, -1.05]])
  for (let i = 0; i < 40; i++) poseRig(rig, root, lm, 0.1)
  for (let i = 0; i < 80; i++) { arm.quaternion.identity(); poseRig(rig, root, null, 0.1) }
  assert.ok(rig.every((r) => r.weight < 0.01))
  assert.ok(arm.quaternion.angleTo(new THREE.Quaternion()) < 0.01)
})

test('with no webcam the figure stands relaxed, and points the webcam can\'t see fall back to that pose', () => {
  const idle = idlePose(0)
  assert.ok(idle[15][1] > idle[11][1], 'hands hang below the shoulders (MediaPipe y grows downward)')
  assert.ok(idle.every((p, i) => ![11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 7, 8].includes(i) || p[3] === 1))
  const seen = Array.from({ length: 33 }, (_, i) => (i === 15 ? [0.3, -0.9, 0, 0.99] : [0, 0, 0, 0.1]))
  const mixed = withIdle(seen, 0)
  assert.deepEqual(mixed[15], [0.3, -0.9, 0, 0.99], 'a raised hand the camera sees is kept')
  assert.deepEqual(mixed[27], idlePose(0)[27], 'an ankle hidden under the desk uses the idle pose')
})
