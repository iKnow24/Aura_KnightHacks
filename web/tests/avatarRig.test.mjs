import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { makeRig, poseRig } from '../src/lib/avatarRig.js'

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
