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
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ECLIPSE } from '../ui/Timeline'

// Landing hero: a head in a headset. Sound travels in from the left as a waveform, enters the headset
// at the temple, and comes out in front of the lens as a caption card. A loop of three moments: a name
// called from the kitchen, the doorbell, someone talking. All built in code (no model files), the only
// color is the Eclipse gradient, used as rim light, the waveform and the strip under the lens.

const ORANGE = new THREE.Color('#FF8A3D')
const PINK = new THREE.Color('#FF4F7B')
const PURPLE = new THREE.Color('#8B6CFF')
const TRAVEL = 1.1 // seconds for sound to cross from the left edge to the headset
const LOOP = 17
const WORD_EVERY = 0.26

const BEATS = [
  { kind: 'speech', at: 0.3, len: 5.6, who: 'Dad', where: 'Kitchen', text: 'Maya, dinner’s ready. Come on down!', name: true },
  { kind: 'bell', at: 6.4, len: 4.3, title: 'Doorbell', where: 'Front door' },
  { kind: 'speech', at: 11.2, len: 5.4, who: 'Sam', where: 'Living room', text: 'It’s the package. I’ll grab it.' },
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
const isBell = (t) => { t = ((t % LOOP) + LOOP) % LOOP; return t > BEATS[1].at - 0.2 && t < BEATS[1].at + 3 }

// A rough, featureless head: a sphere pushed into shape (narrow jaw, fuller back, a nose under the lens).
function headGeometry() {
  const g = new THREE.SphereGeometry(1, 112, 84)
  const p = g.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const { x, y, z } = v
    let sx = 0.8, sy = 0.98, sz = 0.95
    if (y < 0) { sx *= 1 - 0.3 * y * y; sz *= 1 - (z < 0 ? 0.25 : 0.1) * y * y }
    if (z < 0 && y > -0.3) sz *= 1.07
    let X = x * sx, Y = y * sy, Z = z * sz
    const front = Math.max(0, z)
    const noseW = 0.07 + 0.05 * smooth(-0.05, -0.32, y)
    Z += 0.15 * front * Math.exp(-((x / noseW) ** 2)) * Math.exp(-(((y + 0.2) / 0.17) ** 2)) * (0.45 + 0.55 * smooth(0.05, -0.3, y))
    Z += 0.035 * front * Math.exp(-((x / 0.17) ** 2)) * Math.exp(-(((y + 0.53) / 0.06) ** 2)) // lips
    Z += 0.05 * front * Math.exp(-((x / 0.2) ** 2)) * Math.exp(-(((y + 0.78) / 0.1) ** 2)) // chin
    p.setXYZ(i, X, Y, Z)
  }
  g.deleteAttribute('normal')
  g.deleteAttribute('uv')
  const m = mergeVertices(g)
  m.computeVertexNormals()
  return m
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

function Scene({ onBeat, overlay, narrow }) {
  const { gl, scene, camera, size } = useThree()
  const head = useRef()
  const clock = useRef(0)
  const last = useRef('')
  const glow = useRef(0)
  const pointer = useRef({ x: 0, y: 0 })

  const parts = useMemo(() => {
    const skin = new THREE.MeshPhysicalMaterial({ color: '#2b2b30', roughness: 0.45, clearcoat: 0.35, clearcoatRoughness: 0.5 })
    const alu = new THREE.MeshPhysicalMaterial({ color: '#e6e6ea', metalness: 0.15, roughness: 0.28, clearcoat: 0.6, envMapIntensity: 1.4 })
    const glass = new THREE.MeshPhysicalMaterial({ color: '#0d0d11', metalness: 0.3, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 3 })
    const sheen = addOnto(new THREE.MeshBasicMaterial({ map: sheenTexture(), toneMapped: false, opacity: 0.5 }))
    const fabric = new THREE.MeshStandardMaterial({ color: '#18181b', roughness: 1 })
    const strip = addOnto(new THREE.MeshBasicMaterial({ map: gradientTexture(), toneMapped: false, opacity: 0.4 }))
    return { skin, alu, glass, fabric, strip, sheen }
  }, [])

  const geo = useMemo(() => {
    const band = new THREE.TorusGeometry(1, 0.06, 18, 120, Math.PI) // around the back only
    const ear = new THREE.SphereGeometry(1, 32, 24)
    return {
      head: headGeometry(),
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
    const t = (clock.current += Math.min(dt, 0.25))
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
    h.localToWorld(tmp.p1.set(-0.74, 0.12, 0.5))
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
    h.localToWorld(tmp.lens.set(0.15, 0.1, 1.05))
    h.localToWorld(tmp.anchor.set(0.4, 0.2, 1.75))
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
      <directionalLight position={[3, 4, 5]} intensity={1.1} />
      <directionalLight position={[-5, 1.5, -3]} intensity={5} color="#FF8A3D" />
      <directionalLight position={[5, 2.5, -4]} intensity={5} color="#8B6CFF" />
      <directionalLight position={[0, -3, 2]} intensity={0.6} color="#FF4F7B" />
      <group ref={head} position={[narrow ? 0.2 : -0.5, 0, 0]} rotation={[0, 0.62, 0]}>
        <mesh geometry={geo.head} material={parts.skin} />
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
      </group>
      {waves.map((w, i) => <primitive key={i} object={w.line} />)}
      <primitive object={sparks.pts} />
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
