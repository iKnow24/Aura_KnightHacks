import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

// Dresses the walker figure (three.js "Xbot", Mixamo skeleton) as the person in the demo headset:
// short curly dark hair with faded sides, white VR headset with a black strap, open taupe short-sleeve
// shirt over a white tee, purple lanyard with a badge, earbud, black watch on the left wrist, blue
// jeans, white sneakers. Stylized on purpose: outfit and hair only, no attempt at a face likeness.
//
// Clothes are colors painted onto the existing skinned mesh, so they bend with the animation and the
// webcam pose. Hair, headset, lanyard, earbud and watch are small meshes parented to the bones they
// sit on. Numbers are meters in the figure's T-pose (1.8 m tall, facing +z, its left arm along +x).

const C = {
  skin: '#c99068', hair: '#16110e', fade: '#3b2d24', shirt: '#76604f', tee: '#ece8de',
  jeans: '#35507a', shoe: '#efece6', sole: '#d8ccb6', headset: '#f1f1ee', strap: '#1c1c1f',
  lanyard: '#55399a', badge: '#4b2442', watch: '#18181b',
}

// The white tee shows in a strip down the front where the shirt hangs open, a little wider at the
// bottom, plus its round neckline above the shirt's open collar.
function tee(p) {
  if (p.z < 0.05 || p.y < 1.02) return false // the shirt's hem covers the hips
  if (p.y > 1.45) return p.y < 1.53 && Math.abs(p.x) < 0.06
  return Math.abs(p.x) < 0.034 + 0.012 * ((1.45 - p.y) / 0.43)
}

// Which part of the outfit a point of the body is, from the bone that moves it most and where it sits.
function paint(bone, p) {
  const ax = Math.abs(p.x)
  if (/Hand|Fingers/.test(bone)) return C.skin
  if (bone === 'Head') {
    if (p.y < 1.6) return C.skin // neck
    if (p.y > 1.74 || (p.z < -0.03 && p.y > 1.63)) return C.hair
    if (ax > 0.075 && p.y > 1.65 && p.z < 0.06) return C.fade
    return C.skin
  }
  if (/ForeArm/.test(bone)) return ax < 0.47 ? C.shirt : C.skin // sleeve rolled just past the elbow
  if (/Arm|Shoulder|Spine/.test(bone)) return tee(p) ? C.tee : C.shirt
  if (bone === 'Hips') return p.y > 0.9 ? (tee(p) ? C.tee : C.shirt) : C.jeans
  if (/UpLeg|Leg/.test(bone)) return C.jeans
  if (/Foot|Toe/.test(bone)) return p.y < 0.025 ? C.sole : C.shoe
  return C.shirt
}

function paintMesh(mesh) {
  mesh.geometry = mesh.geometry.clone() // never recolor the cached original other figures share
  const { position, skinIndex, skinWeight } = mesh.geometry.attributes
  const colors = new Float32Array(position.count * 3)
  const p = new THREE.Vector3(), color = new THREE.Color()
  mesh.skeleton.update()
  for (let i = 0; i < position.count; i++) {
    let top = 0, weight = -1
    for (let k = 0; k < 4; k++) if (skinWeight.getComponent(i, k) > weight) { weight = skinWeight.getComponent(i, k); top = skinIndex.getComponent(i, k) }
    const bone = mesh.skeleton.bones[top].name.replace(/^mixamorig[:_]?/i, '').replace(/(Left|Right)Hand.+/, 'Fingers')
    p.fromBufferAttribute(position, i)
    mesh.applyBoneTransform(i, p).applyMatrix4(mesh.matrixWorld)
    color.set(paint(bone, p)).toArray(colors, i * 3)
  }
  mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  // Double-sided so the shirt and jeans stay solid when the view swings behind the figure.
  mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, side: THREE.DoubleSide })
}

const mat = (color, roughness = 0.6) => new THREE.MeshStandardMaterial({ color, roughness })
const at = (mesh, x, y, z) => { mesh.position.set(x, y, z); return mesh }

// Short curls: a cap of small bumps over the top of the head.
function curls() {
  const ball = new THREE.SphereGeometry(0.024, 8, 6)
  const spots = []
  for (let i = 0; i < 140; i++) {
    const u = (i + 0.5) / 140, a = i * 2.39996 // golden-angle spiral over the cap
    const up = 0.35 + 0.65 * u, r = Math.sqrt(1 - up * up)
    const x = 0.098 * r * Math.cos(a), z = 0.12 * r * Math.sin(a) - 0.01, y = 1.7 + 0.1 * up
    if (z > 0.1 && y < 1.77) continue // keep the forehead clear
    spots.push([x, y, z])
  }
  const hair = new THREE.InstancedMesh(ball, mat(C.hair, 0.95), spots.length)
  const m = new THREE.Matrix4()
  spots.forEach(([x, y, z], i) => hair.setMatrixAt(i, m.makeTranslation(x, y, z)))
  return hair
}

function headset() {
  const g = new THREE.Group()
  g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.21, 0.115, 0.11, 4, 0.035), mat(C.headset, 0.45)), 0, 1.705, 0.15))
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.006, 0.004), mat('#c9c9c4')), 0, 1.705, 0.207)) // seam on the front
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.118, 0.011, 8, 40), mat(C.strap, 0.8))
  band.rotation.x = Math.PI / 2
  band.scale.set(1, 1.12, 1)
  g.add(at(band, 0, 1.71, 0.0))
  const over = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.01, 8, 24, Math.PI), mat(C.strap, 0.8))
  over.rotation.y = Math.PI / 2
  g.add(at(over, 0, 1.71, -0.01)) // the strap over the top
  return g
}

function lanyard() {
  const g = new THREE.Group()
  const cord = mat(C.lanyard, 0.7)
  for (const s of [1, -1]) {
    const path = new THREE.CatmullRomCurve3([[0.07, 1.53, -0.01], [0.075, 1.47, 0.1], [0.045, 1.33, 0.155], [0.012, 1.25, 0.168]]
      .map(([x, y, z]) => new THREE.Vector3(x * s, y, z)))
    g.add(new THREE.Mesh(new THREE.TubeGeometry(path, 24, 0.006, 6), cord))
  }
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.095, 0.005), mat('#f4f4f5', 0.4)), 0, 1.195, 0.172))
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.06, 0.002), mat(C.badge, 0.4)), 0, 1.2, 0.176))
  return g
}

// The walker mesh is open through the seat. A smooth jeans shape sits on the back of the hips
// and closes that hole, with a waistband so the hem reads as clothing.
function seat() {
  const g = new THREE.Group()
  const jeans = mat(C.jeans, 0.7)
  const band = mat('#2a4064', 0.5)
  for (const s of [1, -1]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.058, 28, 20), jeans)
    cheek.scale.set(1.05, 0.82, 0.72)
    cheek.position.set(s * 0.05, 0.945, -0.112)
    g.add(cheek)
  }
  const fill = new THREE.Mesh(new THREE.SphereGeometry(0.04, 20, 14), jeans)
  fill.scale.set(1.35, 0.7, 0.6)
  fill.position.set(0, 0.95, -0.1)
  g.add(fill)
  const waist = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.015, 12, 48), band)
  waist.rotation.x = Math.PI / 2
  waist.position.set(0, 1.012, -0.015)
  g.add(waist)
  return g
}

// A smooth short sleeve over the low-poly upper arm, with a folded cuff at the elbow.
function sleeve(sign) {
  const g = new THREE.Group()
  const cloth = mat(C.shirt, 0.62)
  const cuffMat = mat('#5c4a3c', 0.45)
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.052, 0.28, 32, 1, true), cloth)
  tube.rotation.z = Math.PI / 2
  tube.position.set(sign * 0.31, 1.44, -0.05)
  g.add(tube)
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.054, 0.011, 14, 32), cuffMat)
  cuff.rotation.y = Math.PI / 2
  cuff.position.set(sign * 0.44, 1.438, -0.05)
  g.add(cuff)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.066, 28, 18), cloth)
  cap.scale.set(0.85, 0.95, 0.82)
  cap.position.set(sign * 0.175, 1.45, -0.048)
  g.add(cap)
  return g
}

function watch() {
  const g = new THREE.Group()
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.011, 8, 24), mat(C.watch, 0.5))
  band.rotation.y = Math.PI / 2
  g.add(at(band, 0.665, 1.44, -0.05))
  g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.012, 0.034, 2, 0.004), mat('#0b0b0c', 0.3)), 0.665, 1.482, -0.05))
  return g
}

function bone(scene, name) {
  let found = null
  scene.traverse((o) => { if (!found && o.isBone && o.name.replace(/^mixamorig[:_]?/i, '') === name) found = o })
  return found
}

// Call once on a fresh clone of walker.glb, before it is scaled or animated.
export function dressAsWearer(scene) {
  scene.updateMatrixWorld(true)
  scene.traverse((o) => { if (o.isSkinnedMesh) paintMesh(o) })
  const parts = [
    ['Head', curls()],
    ['Head', headset()],
    ['Head', at(new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.014, 4, 8), mat(C.watch, 0.4)), 0.092, 1.655, 0.02)], // earbud, left ear
    ['Spine2', lanyard()],
    ['Hips', seat()],
    ['LeftArm', sleeve(1)],
    ['RightArm', sleeve(-1)],
    ['LeftForeArm', watch()],
  ]
  for (const [name, part] of parts) {
    const b = bone(scene, name)
    if (!b) continue
    scene.add(part)
    b.attach(part) // keeps the T-pose placement, then follows the bone
    part.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false } })
  }
  return scene
}
