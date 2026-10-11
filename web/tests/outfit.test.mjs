import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { dressAsWearer } from '../src/lib/outfit.js'

// A tiny Mixamo-named figure: one skinned triangle per body part, at the heights of the real walker.
function figure() {
  const bone = (name, y, parent) => { const b = new THREE.Bone(); b.name = `mixamorig${name}`; b.position.y = y; parent?.add(b); return b }
  const hips = bone('Hips', 1.0)
  const spine2 = bone('Spine2', 0.35, hips)
  const head = bone('Head', 0.25, spine2)
  const fore = bone('LeftForeArm', 0.1, spine2)
  fore.position.x = 0.45
  const legs = bone('LeftLeg', -0.6, hips)
  const bones = [hips, spine2, head, fore, legs]
  // [bone index, x, y, z] in the T-pose, meters
  const pts = [[2, 0, 1.78, 0.05], [2, 0.03, 1.66, 0.12], [1, 0.12, 1.3, 0], [1, 0, 1.3, 0.12], [3, 0.6, 1.44, 0], [4, 0.08, 0.3, 0]]
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => p.slice(1)), 3))
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(pts.flatMap((p) => [p[0], 0, 0, 0]), 4))
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(pts.flatMap(() => [1, 0, 0, 0]), 4))
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial())
  const root = new THREE.Group()
  root.add(hips, mesh)
  root.updateMatrixWorld(true)
  mesh.bind(new THREE.Skeleton(bones))
  return { root, mesh, head, spine2, fore }
}

test('the figure gets the outfit colors and the accessories ride on the right bones', () => {
  const { root, mesh, head, spine2, fore } = figure()
  const original = mesh.geometry
  dressAsWearer(root)
  assert.notEqual(mesh.geometry, original, 'the shared original geometry is never recolored')
  const color = (i) => '#' + new THREE.Color().fromArray(mesh.geometry.attributes.color.array, i * 3).getHexString()
  assert.equal(color(0), '#16110e') // top of the head: hair
  assert.equal(color(1), '#c99068') // face: skin
  assert.equal(color(2), '#76604f') // side of the chest: shirt
  assert.equal(color(3), '#ece8de') // front of the chest: the tee where the shirt is open
  assert.equal(color(4), '#c99068') // forearm: skin (short sleeves)
  assert.equal(color(5), '#35507a') // leg: jeans
  assert.equal(head.children.filter((c) => !c.isBone).length, 3, 'curls, headset, earbud')
  assert.ok(spine2.children.some((c) => !c.isBone), 'lanyard')
  assert.ok(fore.children.some((c) => !c.isBone), 'watch')
})
