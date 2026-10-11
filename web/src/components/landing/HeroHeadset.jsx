import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { AnimatePresence, motion } from 'framer-motion'
import { BellRing } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { idlePose, makeRig, poseRig, resetRig } from '../../lib/avatarRig'
import { ECLIPSE } from '../ui/Timeline'

// Landing hero: a head in a headset. Sound travels in from the left as a waveform, enters the headset
// at the temple, and comes out in front of the lens as a caption card. One moment, repeated: someone
// calls Maya's name from the kitchen. The Eclipse gradient is the only color, on the wave and the card.

const ORANGE = new THREE.Color('#FF8A3D')
const PINK = new THREE.Color('#FF4F7B')
const PURPLE = new THREE.Color('#8B6CFF')
const TRAVEL = 1.1 // seconds for sound to cross from the left edge to the headset
const LOOP = 8.4
const WORD_EVERY = 0.26

const BEATS = [
  { kind: 'speech', at: 0.3, len: 5.6, who: 'Dad', where: 'Kitchen', text: 'Maya, dinner’s ready. Come on down!', name: true },
].map((b) => ({ ...b, words: b.text?.split(' ') }))

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

// How loud the sound is at the source, at loop time t (0..1).
function loudness(t) {
  t = ((t % LOOP) + LOOP) % LOOP
  let a = 0.025 // the room is never fully silent
  for (const b of BEATS) {
    const u = t - b.at
    if (b.kind === 'speech') {
      const end = b.len - TRAVEL - 0.7
      if (u > 0 && u < end) a += smooth(0, 0.15, u) * smooth(end, end - 0.3, u) * (0.22 + 0.32 * Math.abs(Math.sin(u * 8.5) * Math.sin(u * 2.9 + 1)))
    } else {
      if (u > 0) a += 0.62 * Math.exp(-u * 3.2) * smooth(0, 0.03, u) // ding
      if (u > 0.75) a += 0.55 * Math.exp(-(u - 0.75) * 2.6) // dong
    }
  }
  return a
}
const isBell = () => false // the hero has no doorbell beat any more; kept so the spark code reads the same

// A head built from a rounded box, not a stretched sphere: a box has real flat planes (forehead,
// cheek, jaw) meeting at edges, which reads as "a face" at a glance in a way any sphere, however it's
// squashed, keeps reading as "a ball". Nose, lips and a chin point are small bumps added on top.
const HEAD = { w: 1.42, h: 1.82, d: 1.5, r: 0.46 }
function headGeometry() {
  const g = new RoundedBoxGeometry(HEAD.w, HEAD.h, HEAD.d, 7, HEAD.r)
  const p = g.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    let { x: X, y: Y, z: Z } = v
    // A jaw corner: full width through the cheekbones, then a hard taper down to the chin.
    if (Y < -0.1) { const j = smooth(-0.1, -0.86, Y); X *= 1 - 0.56 * j; Z *= 1 - (Z < 0 ? 0.3 : 0.2) * j }
    const front = Math.max(0, Z)
    const noseW = 0.07 + 0.05 * smooth(-0.05, -0.32, Y)
    Z += 0.16 * front * Math.exp(-((X / noseW) ** 2)) * Math.exp(-(((Y + 0.2) / 0.17) ** 2)) * (0.45 + 0.55 * smooth(0.05, -0.3, Y))
    Z += 0.035 * front * Math.exp(-((X / 0.17) ** 2)) * Math.exp(-(((Y + 0.53) / 0.06) ** 2)) // lips
    Z += 0.045 * front * Math.exp(-((X / 0.2) ** 2)) * Math.exp(-(((Y + 0.78) / 0.1) ** 2)) // chin point
    p.setXYZ(i, X, Y, Z)
  }
  g.deleteAttribute('normal')
  g.deleteAttribute('uv')
  const m = mergeVertices(g)
  m.computeVertexNormals()
  return m
}
// A short curly cap sitting just outside the skull, from the crown down to just above the ears,
// with a per-vertex wobble so it reads as curls rather than a smooth helmet. A capped sphere dome
// (not a filtered box) so the mesh stays a closed, intact shape with no stray triangles.
function hairGeometry() {
  const g = new THREE.SphereGeometry(1, 64, 40, 0, Math.PI * 2, 0, Math.PI * 0.5)
  const p = g.attributes.position
  const v = new THREE.Vector3()
  const sx = HEAD.w / 2 + 0.07, sy = HEAD.h / 2 + 0.09, sz = HEAD.d / 2 + 0.07
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const curl = 1 + 0.012 * (Math.sin(v.x * 34 + v.y * 15) + Math.sin(v.y * 26 - v.z * 19) + Math.sin(v.z * 30 + v.x * 11))
    p.setXYZ(i, v.x * sx * curl, v.y * sy * curl + 0.02, v.z * sz * curl)
  }
  g.computeVertexNormals()
  return g
}

// A thin mustache, sitting between the nose and the upper lip.
function mustacheGeometry() {
  const g = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI, 0, Math.PI * 0.4)
  g.scale(0.185, 0.034, 0.05)
  g.translate(0, -0.455, 1.03)
  g.computeVertexNormals()
  return g
}

// A rounded box bent around the vertical axis, so it wraps the face like a visor. Built from a finely
// cut box (so the bend has vertices to move), with its corners pulled in to radius r.
function bentBox(w, h, d, r, R, zOff = 0) {
  const g = new THREE.BoxGeometry(w, h, d, 96, 10, 4)
  g.deleteAttribute('normal')
  g.deleteAttribute('uv')
  const p = g.attributes.position
  const half = new THREE.Vector3(w / 2 - r, h / 2 - r, d / 2 - r)
  const v = new THREE.Vector3(), inner = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    inner.copy(v).clamp(half.clone().negate(), half)
    v.sub(inner)
    if (v.lengthSq() > 0) v.setLength(r)
    v.add(inner)
    const a = v.x / R, rr = R + v.z + zOff
    p.setXYZ(i, rr * Math.sin(a), v.y, rr * Math.cos(a) - R)
  }
  const m = mergeVertices(g)
  m.computeVertexNormals()
  return m
}

function gradientTexture() {
  const c = document.createElement('canvas')
  c.width = 256; c.height = 4
  const ctx = c.getContext('2d')
  const gr = ctx.createLinearGradient(0, 0, 256, 0)
  gr.addColorStop(0, '#FF8A3D'); gr.addColorStop(0.5, '#FF4F7B'); gr.addColorStop(1, '#8B6CFF')
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 256, 4)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// The soft reflection across the top of the glass: white at the top edge, gone by the middle.
function sheenTexture() {
  const c = document.createElement('canvas')
  c.width = 4; c.height = 64
  const ctx = c.getContext('2d')
  const gr = ctx.createLinearGradient(0, 0, 0, 64)
  gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(0.25, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 4, 64)
  return new THREE.CanvasTexture(c)
}

function dotTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')
  const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

const gradientAt = (s, out) => (s < 0.5 ? out.copy(ORANGE).lerp(PINK, s * 2) : out.copy(PINK).lerp(PURPLE, (s - 0.5) * 2))

const WAVES = [
  { dy: 0, dz: 0, width: 2.4, phase: 0, gain: 1 },
  { dy: 0.09, dz: -0.12, width: 1.3, phase: 1.7, gain: 0.7 },
  { dy: -0.08, dz: 0.1, width: 1, phase: 3.1, gain: 0.55 },
]
const N = 180

// Adds light onto the page behind the transparent canvas without touching its alpha, so faint
// colors brighten what's under them instead of drawing dark smudges.
function addOnto(m) {
  Object.assign(m, {
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  })
  return m
}
const PARTICLES = 60

// The real face: the Blender (MPFB) person from the dashboard, already wearing the white headset.
// It is a 4 MB file, so the code-built head shows until it arrives, then swaps out.
const AVATAR = `${import.meta.env.BASE_URL}models/avatar.glb`
const SCALE = 6.2 // meters -> scene units, so the head is about the size of the placeholder

function loadAvatar() {
  return new GLTFLoader().loadAsync(AVATAR).then((gltf) => {
    const scene = gltf.scene
    scene.traverse((o) => {
      if (!o.isMesh) return
      o.frustumCulled = false
      for (const m of [o.material].flat()) {
        if (!m) continue
        if (/hair|afro|eyebrow|eyelash/i.test(m.name)) Object.assign(m, { alphaTest: 0.62, transparent: false, depthWrite: true, side: THREE.DoubleSide })
        else if (!/high-poly|cornea/i.test(m.name)) m.transparent = false
        if (/high-poly/i.test(m.name)) o.visible = false // eye-wetness shell, would show as a grey film
      }
    })
    // A smaller headset, closer to the Tecknet in the team's photos: shrink the shell about its own center.
    scene.traverse((o) => {
      if (!o.isMesh || !/^headset_Cube/.test(o.name)) return
      o.geometry.computeBoundingBox()
      const mid = o.geometry.boundingBox.getCenter(new THREE.Vector3())
      o.updateMatrix()
      const before = mid.clone().applyMatrix4(o.matrix)
      o.scale.multiply(new THREE.Vector3(0.7, 0.66, 0.62))
      o.updateMatrix()
      o.position.add(before.sub(mid.applyMatrix4(o.matrix)))
    })
    // Arms down and relaxed (the file is in a T-pose), then measure where the headset ended up.
    scene.scale.setScalar(SCALE)
    const rig = makeRig(scene)
    for (let i = 0; i < 6; i++) { resetRig(rig); poseRig(rig, scene, idlePose(0), 5) }
    scene.updateMatrixWorld(true)
    const box = new THREE.Box3()
    scene.traverse((o) => { if (o.isMesh && /^headset_Cube$/.test(o.name)) box.expandByObject(o) })
    if (box.isEmpty()) scene.traverse((o) => { if (o.isMesh && /headset/i.test(o.name)) box.expandByObject(o) })
    const c = box.getCenter(new THREE.Vector3())
    // Put the headset where the placeholder's visor sits, so the waves and the caption line up.
    scene.position.set(-c.x, 0.12 - c.y, 0.98 - box.max.z + 0.1)
    const off = scene.position
    const anchors = {
      temple: new THREE.Vector3(box.min.x + off.x - 0.02, c.y + off.y, c.z + off.z - (box.max.z - box.min.z) * 0.15),
      lens: new THREE.Vector3(c.x + off.x, c.y + off.y, box.max.z + off.z + 0.03),
    }
    return { scene, rig, anchors }
  })
}

function Scene({ onBeat, overlay, narrow }) {
  const { gl, scene, camera, size } = useThree()
  const head = useRef()
  const clock = useRef(0)
  const last = useRef('')
  const glow = useRef(0)
  const pointer = useRef({ x: 0, y: 0 })
  const [avatar, setAvatar] = useState(null)
  const [failed, setFailed] = useState(false) // only then show the code-built head
  const ready = avatar || failed
  const anchors = useRef({ temple: new THREE.Vector3(-0.74, 0.12, 0.5), lens: new THREE.Vector3(0.15, 0.1, 1.05) })

  useEffect(() => {
    let live = true
    loadAvatar().then((a) => { if (!live) return; anchors.current = a.anchors; setAvatar(a) })
      .catch((e) => { console.warn('Hero avatar failed to load; using the built-in head', e); if (live) setFailed(true) })
    return () => { live = false }
  }, [])

  const parts = useMemo(() => {
    const skin = new THREE.MeshPhysicalMaterial({ color: '#c99068', roughness: 0.55, clearcoat: 0.18, clearcoatRoughness: 0.5 })
    const hair = new THREE.MeshPhysicalMaterial({ color: '#19130f', roughness: 0.85, clearcoat: 0.06 })
    const alu = new THREE.MeshPhysicalMaterial({ color: '#e6e6ea', metalness: 0.15, roughness: 0.28, clearcoat: 0.6, envMapIntensity: 1.4 })
    const glass = new THREE.MeshPhysicalMaterial({ color: '#0d0d11', metalness: 0.3, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 3 })
    const sheen = addOnto(new THREE.MeshBasicMaterial({ map: sheenTexture(), toneMapped: false, opacity: 0.5 }))
    const fabric = new THREE.MeshStandardMaterial({ color: '#18181b', roughness: 1 })
    const strip = addOnto(new THREE.MeshBasicMaterial({ map: gradientTexture(), toneMapped: false, opacity: 0.4 }))
    return { skin, alu, glass, fabric, strip, sheen, hair }
  }, [])

  const geo = useMemo(() => {
    const band = new THREE.TorusGeometry(1, 0.06, 18, 120, Math.PI) // around the back only
    const ear = new THREE.SphereGeometry(1, 32, 24)
    const hairCap = hairGeometry()
    const mustache = mustacheGeometry()
    return {
      head: headGeometry(),
      hairCap, mustache,
      neck: new THREE.CylinderGeometry(0.4, 0.5, 1.3, 64, 1, true),
      frame: bentBox(1.52, 0.5, 0.2, 0.09, 0.72),
      glass: bentBox(1.38, 0.38, 0.06, 0.03, 0.72, 0.1),
      strip: bentBox(1.0, 0.014, 0.01, 0.004, 0.72, 0.137),
      sheen: bentBox(1.3, 0.14, 0.004, 0.002, 0.72, 0.136),
      pod: new RoundedBoxGeometry(0.1, 0.16, 0.34, 4, 0.045),
      band, ear,
    }
  }, [])

  const waves = useMemo(() => WAVES.map((w) => {
    const g = new LineGeometry()
    g.setPositions(new Float32Array(N * 3))
    const col = new Float32Array(N * 3)
    const c = new THREE.Color()
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1)
      gradientAt(s, c).multiplyScalar(smooth(0, 0.3, s) * w.gain)
      col.set([c.r, c.g, c.b], i * 3)
    }
    g.setColors(col)
    const m = addOnto(new LineMaterial({ linewidth: w.width, vertexColors: true }))
    const line = new Line2(g, m)
    line.frustumCulled = false
    return { line, g, m, ...w }
  }), [])

  const sparks = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3))
    const m = addOnto(new THREE.PointsMaterial({ size: 0.09, map: dotTexture(), vertexColors: true }))
    const pts = new THREE.Points(g, m)
    pts.frustumCulled = false
    return { pts, seeds: Array.from({ length: PARTICLES }, (_, i) => [i / PARTICLES, Math.random() * 6.28, Math.random()]) }
  }, [])

  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl)
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    scene.environmentIntensity = 0.32
    const move = (e) => { pointer.current = { x: e.clientX / window.innerWidth - 0.5, y: e.clientY / window.innerHeight - 0.5 } }
    window.addEventListener('pointermove', move, { passive: true })
    return () => { window.removeEventListener('pointermove', move); env.dispose(); pm.dispose() }
  }, [gl, scene])

  // Frame the shot: wide enough for the waves on the left and the caption on the right.
  useEffect(() => {
    const aspect = size.width / size.height
    const need = narrow ? 4.2 : 6.6
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const dist = Math.max(narrow ? 7.4 : 4.9, need / 2 / (half * aspect))
    camera.position.set(narrow ? 0.2 : 0.4, 0.25, dist)
    camera.lookAt(narrow ? 0.2 : 0.4, 0.05, 0)
    camera.updateProjectionMatrix()
    waves.forEach((w) => w.m.resolution.set(size.width, size.height))
  }, [size, camera, waves, narrow])

  const tmp = useMemo(() => ({
    p0: new THREE.Vector3(), p1: new THREE.Vector3(), c: new THREE.Vector3(), v: new THREE.Vector3(),
    lens: new THREE.Vector3(), anchor: new THREE.Vector3(), col: new THREE.Color(),
  }), [])

  useFrame((_, dt) => {
    // Nothing plays until the real face is in, so the loop starts at the name call every time.
    if (!ready) { clock.current = 0; return }
    const t = (clock.current += Math.min(dt, 0.25))
    if (avatar) { resetRig(avatar.rig); poseRig(avatar.rig, avatar.scene, idlePose(t), Math.min(dt, 0.1)) }
    const lt = t % LOOP
    const h = head.current
    if (!h) return

    // Head: a slow breath of motion, plus a little toward the pointer.
    const pt = pointer.current
    h.rotation.y += (0.62 + 0.05 * Math.sin(t * 0.37) + pt.x * 0.25 - h.rotation.y) * 0.05
    h.rotation.x += (0.03 * Math.sin(t * 0.29) + pt.y * 0.12 - h.rotation.x) * 0.05
    h.position.y = 0.03 * Math.sin(t * 0.5)
    h.updateMatrixWorld()

    // Sound: each line runs from off-screen left to the pod on the headset's near temple.
    h.localToWorld(tmp.p1.copy(anchors.current.temple))
    const bell = isBell(t - TRAVEL * 0.5)
    for (const w of waves) {
      tmp.p0.set(-7.5, -0.5 + w.dy * 3, -2 + w.dz * 4)
      tmp.c.set(-3.2, 0.5 + w.dy, 0.4 + w.dz)
      const arr = w.g.attributes.instanceStart.data.array
      let prev = null
      for (let i = 0; i < N; i++) {
        const s = i / (N - 1)
        const a = loudness(t - s * TRAVEL) * w.gain
        const k = bell ? 40 : 26
        const wob = Math.sin(s * k * 2 * Math.PI * 0.5 - t * 9 + w.phase) + (bell ? 0 : 0.35 * Math.sin(s * 71 - t * 14 + w.phase))
        const taper = smooth(0, 0.12, s) * (1 - smooth(0.72, 1, s))
        const u = 1 - s
        tmp.v.set(
          u * u * tmp.p0.x + 2 * u * s * tmp.c.x + s * s * tmp.p1.x,
          u * u * tmp.p0.y + 2 * u * s * tmp.c.y + s * s * tmp.p1.y + a * wob * taper * 0.9,
          u * u * tmp.p0.z + 2 * u * s * tmp.c.z + s * s * tmp.p1.z,
        )
        if (prev !== null) { arr[prev] = tmp.v.x; arr[prev + 1] = tmp.v.y; arr[prev + 2] = tmp.v.z }
        if (i < N - 1) { const o = i * 6; arr[o] = tmp.v.x; arr[o + 1] = tmp.v.y; arr[o + 2] = tmp.v.z; prev = o + 3 }
      }
      w.g.attributes.instanceStart.data.needsUpdate = true
      w.m.opacity = 0.55 + loudness(t) * 0.8
    }

    // What has arrived at the headset right now drives the lens strip and the sparks.
    const arrived = loudness(t - TRAVEL)
    glow.current += (Math.min(1, arrived * 2.2) - glow.current) * 0.12
    parts.strip.opacity = 0.25 + glow.current * 0.75

    // Caption anchor: in front of the lens, out where the wearer is looking.
    h.localToWorld(tmp.lens.copy(anchors.current.lens))
    h.localToWorld(tmp.anchor.copy(anchors.current.lens).add(tmp.v.set(0.25, 0.1, 0.7)))
    const pos = sparks.pts.geometry.attributes.position.array
    const col = sparks.pts.geometry.attributes.color.array
    sparks.seeds.forEach(([seed, ph, sp], i) => {
      const q = (t * (0.45 + sp * 0.4) + seed) % 1
      const fade = Math.sin(Math.PI * q) * glow.current
      tmp.v.copy(tmp.lens).lerp(tmp.anchor, q)
      tmp.v.y += Math.sin(q * 6 + ph) * 0.08 * q
      tmp.v.z += Math.cos(q * 5 + ph) * 0.08 * q
      pos.set([tmp.v.x, tmp.v.y, tmp.v.z], i * 3)
      gradientAt(0.4 + q * 0.6, tmp.col).multiplyScalar(Math.max(0, fade))
      col.set([tmp.col.r, tmp.col.g, tmp.col.b], i * 3)
    })
    sparks.pts.geometry.attributes.position.needsUpdate = true
    sparks.pts.geometry.attributes.color.needsUpdate = true

    // Pin the caption card to the anchor (wide screens) and tell the page which words are showing.
    if (overlay.current && !narrow) {
      tmp.v.copy(tmp.anchor).project(camera)
      const x = (tmp.v.x * 0.5 + 0.5) * size.width
      const y = (-tmp.v.y * 0.5 + 0.5) * size.height
      overlay.current.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translateY(-50%)`
    }
    let state = { beat: -1, words: 0 }
    BEATS.forEach((b, i) => {
      const u = lt - b.at - TRAVEL
      if (u >= 0 && lt < b.at + b.len) state = { beat: i, words: b.words ? Math.min(b.words.length, Math.floor(u / WORD_EVERY) + 1) : 0 }
    })
    const key = `${state.beat}:${state.words}`
    if (key !== last.current) { last.current = key; onBeat(state) }
  })

  return (
    <>
      <ambientLight intensity={0.08} />
      <directionalLight position={[3, 4, 5]} intensity={1.7} />
      <directionalLight position={[-5, 1.5, -3]} intensity={2.2} color="#FF8A3D" />
      <directionalLight position={[5, 2.5, -4]} intensity={2.2} color="#8B6CFF" />
      <directionalLight position={[0, -3, 2]} intensity={0.35} color="#FF4F7B" />
      <group ref={head} position={[narrow ? 0.2 : -0.5, 0, 0]} rotation={[0, 0.62, 0]}>
        {avatar && <primitive object={avatar.scene} />}
        {failed && !avatar && <>
        <mesh geometry={geo.head} material={parts.skin} />
        <mesh geometry={geo.hairCap} material={parts.hair} />
        <mesh geometry={geo.mustache} material={parts.hair} />
        <mesh geometry={geo.neck} material={parts.skin} position={[0, -1.12, -0.12]} rotation={[0.16, 0, 0]} />
        {[-1, 1].map((s) => (
          <mesh key={s} geometry={geo.ear} material={parts.skin} position={[s * 0.79, -0.06, -0.06]} scale={[0.07, 0.2, 0.13]} />
        ))}
        <group position={[0, 0.12, 0.98]}>
          <mesh geometry={geo.frame} material={parts.alu} />
          <mesh geometry={geo.glass} material={parts.glass} />
          <mesh geometry={geo.strip} material={parts.strip} position={[0, -0.155, 0]} />
          <mesh geometry={geo.sheen} material={parts.sheen} position={[0, 0.095, 0]} />
        </group>
        {[-1, 1].map((s) => (
          <mesh key={s} geometry={geo.pod} material={parts.alu} position={[s * 0.7, 0.12, 0.5]} rotation={[0, s * -0.55, 0]} />
        ))}
        <mesh geometry={geo.band} material={parts.fabric} position={[0, 0.14, -0.02]} rotation={[-Math.PI / 2 + 0.18, 0, 0]} scale={[0.84, 1.0, 1]} />
        </>}
      </group>
      {ready && waves.map((w, i) => <primitive key={i} object={w.line} />)}
      {ready && <primitive object={sparks.pts} />}
    </>
  )
}

function Card({ beat, words }) {
  const b = BEATS[beat]
  if (b.kind === 'bell') {
    return (
      <div className="rounded-2xl p-px" style={{ background: ECLIPSE }}>
        <div className="flex items-center gap-3 rounded-[15px] bg-[#111113]/95 px-5 py-4">
          <span className="grid h-10 w-10 place-items-center rounded-full" style={{ background: ECLIPSE }}><BellRing size={19} className="text-black" /></span>
          <div className="text-left">
            <p className="text-lg font-semibold leading-tight text-white">{b.title}</p>
            <p className="text-sm text-zinc-400">{b.where} · just now</p>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-4 text-left shadow-2xl backdrop-blur-xl">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-400">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: ECLIPSE }} />
        {b.who} · {b.where}
        {b.name && words > 0 && (
          <span className="ml-1 rounded-full px-2 py-0.5 text-[10px] tracking-[0.12em] text-black" style={{ background: ECLIPSE }}>Your name</span>
        )}
      </div>
      <p className="mt-2 text-[clamp(1rem,1.5vw,1.35rem)] font-medium leading-snug text-white">
        {b.words.slice(0, words).map((w, i) => (
          <motion.span key={i} initial={{ opacity: 0, filter: 'blur(6px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} transition={{ duration: 0.35 }}>
            {w}{' '}
          </motion.span>
        ))}
        <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.15em] animate-pulse bg-white/70" />
      </p>
    </div>
  )
}

export default function HeroHeadset({ onReady }) {
  const box = useRef(null)
  const overlay = useRef(null)
  const [visible, setVisible] = useState(true)
  const [shown, setShown] = useState({ beat: -1, words: 0 })
  const [narrow, setNarrow] = useState(() => window.innerWidth < 720)

  // Stop drawing when the hero is scrolled away or the tab is hidden.
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.02 })
    if (box.current) io.observe(box.current)
    const resize = () => setNarrow(window.innerWidth < 720)
    window.addEventListener('resize', resize)
    return () => { io.disconnect(); window.removeEventListener('resize', resize) }
  }, [])

  const card = shown.beat >= 0 && (
    <motion.div key={shown.beat} initial={{ opacity: 0, y: 10, filter: 'blur(8px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: -12, filter: 'blur(8px)' }} transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}>
      <Card beat={shown.beat} words={shown.words} />
    </motion.div>
  )

  return (
    <div ref={box} className="relative h-full w-full">
      <div className="absolute inset-0" style={{
        maskImage: 'linear-gradient(to bottom, #000 52%, transparent 92%), linear-gradient(to right, transparent, #000 14%, #000 86%, transparent)',
        WebkitMaskImage: 'linear-gradient(to bottom, #000 52%, transparent 92%), linear-gradient(to right, transparent, #000 14%, #000 86%, transparent)',
        maskComposite: 'intersect', WebkitMaskComposite: 'source-in',
      }}>
        <Canvas frameloop={visible ? 'always' : 'never'} dpr={[1, 1.75]} camera={{ fov: 30, near: 0.1, far: 60 }}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          onCreated={() => requestAnimationFrame(() => onReady?.())}>
          <Scene onBeat={setShown} overlay={overlay} narrow={narrow} />
        </Canvas>
      </div>
      {narrow ? (
        <div className="pointer-events-none absolute inset-x-4 bottom-2 flex justify-center">
          <div className="w-full max-w-sm"><AnimatePresence mode="wait">{card}</AnimatePresence></div>
        </div>
      ) : (
        <div ref={overlay} className="pointer-events-none absolute left-0 top-0 w-[min(25rem,34vw)]" style={{ perspective: 900 }}>
          <div style={{ transform: 'rotateY(-14deg)', transformOrigin: 'left center' }}>
            <AnimatePresence mode="wait">{card}</AnimatePresence>
          </div>
        </div>
      )}
    </div>
  )
}
