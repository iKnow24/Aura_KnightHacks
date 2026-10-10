import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

// The little "what's around you" view, in the spirit of a Tesla's driving visualization: you are
// the figure in the middle, walking when the phone feels you walk; people, bikes and cars the
// cameras see are placed around you; each camera's view is a soft cone (front = the phone in your
// hand, back = the phone on your bag). Only what a camera actually sees is drawn. Outside the
// cones is unknown, and stays empty.
//
// Figure: three.js's example "Xbot" (Mixamo), trimmed to its idle/walk/run clips.
// Cars and bikes are built here from simple shapes, all in one matte gray.
const MODEL = '/models/walker.glb'
const BG = '#111113'
const GRAY = '#8e8e96'
const ME = '#f4f4f5'
const DANGER = '#ef4444'
const SEEN_MS = 1500 // a thing not seen for this long fades away
const NEAR = 4 // m: a vehicle this close turns red
const SIDE = 0.65

// Real distance -> scene distance. Close things true to scale, far things pulled in, and anything
// farther than the view reaches parked at its edge, so a car 25 m back still shows up.
const show = (d, side) => Math.min(side === 'front' ? 7.5 : 5.5, d < 4 ? d : 4 + (d - 4) * 0.3)

function place(side, { bearing, dist }) {
  const s = show(dist, side), b = (bearing * Math.PI) / 180
  // Forward is -z. The bag camera faces backward, so its right is your left. Sideways offsets are
  // squeezed (SIDE) so a narrow corner view still holds a car one lane over.
  return side === 'front' ? [SIDE * s * Math.sin(b), -s * Math.cos(b)] : [-SIDE * s * Math.sin(b), s * Math.cos(b)]
}

// One soft radial gradient, reused for the camera cones and the shadows under things.
const glowTexture = (() => {
  let tex
  return () => {
    if (tex) return tex
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.55, 'rgba(255,255,255,0.45)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 128, 128)
    tex = new THREE.CanvasTexture(c)
    return tex
  }
})()

function Shadow({ size = 1 }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0.01} scale={size}>
      <circleGeometry args={[1, 24]} />
      <meshBasicMaterial map={glowTexture()} color="#000" transparent opacity={0.6} depthWrite={false} />
    </mesh>
  )
}

function Cone({ side, fov, live, radius }) {
  const mat = useRef()
  const span = (Math.min(fov, 120) * Math.PI) / 180
  const center = side === 'front' ? Math.PI / 2 : -Math.PI / 2
  useFrame((_, dt) => { if (mat.current) mat.current.opacity += ((live ? 0.16 : 0) - mat.current.opacity) * Math.min(1, dt * 3) })
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
      <circleGeometry args={[radius, 48, center - span / 2, span]} />
      <meshBasicMaterial ref={mat} map={glowTexture()} transparent opacity={0} depthWrite={false} />
    </mesh>
  )
}

// Lane dashes either side of you that slide past while you walk, so the figure reads as moving.
function Ground({ speed }) {
  const group = useRef()
  const dashes = useMemo(() => {
    const out = []
    for (const x of [-1.8, 1.8]) for (let z = -24; z <= 24; z += 2) out.push([x, z])
    return out
  }, [])
  useFrame((_, dt) => { if (group.current) group.current.position.z = (group.current.position.z + speed * dt) % 2 })
  return (
    <group ref={group}>
      {dashes.map(([x, z]) => (
        <mesh key={`${x},${z}`} rotation-x={-Math.PI / 2} position={[x, 0.005, z]}>
          <planeGeometry args={[0.08, 0.9]} />
          <meshBasicMaterial color="#3a3a41" />
        </mesh>
      ))}
    </group>
  )
}

function useFigure(color, jointColor) {
  const gltf = useLoader(GLTFLoader, MODEL, (l) => l.setMeshoptDecoder(MeshoptDecoder))
  return useMemo(() => {
    const scene = cloneSkinned(gltf.scene)
    const materials = []
    scene.traverse((o) => {
      if (!o.isMesh) return
      o.material = new THREE.MeshStandardMaterial({
        color: /Joints/.test(o.material.name) ? jointColor : color, roughness: 0.75, metalness: 0, transparent: true,
      })
      o.frustumCulled = false
      materials.push(o.material)
    })
    const mixer = new THREE.AnimationMixer(scene)
    const actions = Object.fromEntries(gltf.animations.map((c) => [c.name, mixer.clipAction(c)]))
    return { scene, mixer, actions, materials }
  }, [gltf, color, jointColor])
}

// Crossfade between idle / walk / run.
function useGait(fig, gait, rate = 1) {
  const current = useRef(null)
  useEffect(() => {
    const next = fig.actions[gait]
    if (!next || current.current === next) return
    next.reset().fadeIn(0.35).play()
    current.current?.fadeOut(0.35)
    current.current = next
  }, [fig, gait])
  useEffect(() => { if (current.current) current.current.timeScale = rate }, [rate, gait])
  useFrame((_, dt) => fig.mixer.update(Math.min(dt, 0.1)))
}

function Me({ walking, cadence }) {
  const fig = useFigure(ME, '#a1a1aa')
  const gait = !walking ? 'idle' : cadence > 2.6 ? 'run' : 'walk'
  useGait(fig, gait, walking ? Math.min(1.4, Math.max(0.75, cadence / 1.8)) : 1)
  return (
    <group>
      <primitive object={fig.scene} rotation-y={Math.PI} />
      <Shadow size={0.7} />
    </group>
  )
}

// ---- other road users ----

let carParts
function carGeometry() {
  if (carParts) return carParts
  const body = new THREE.Shape()
  body.moveTo(-2.25, 0.32)
  body.lineTo(2.25, 0.32)
  body.quadraticCurveTo(2.36, 0.34, 2.33, 0.62)
  body.quadraticCurveTo(2.28, 0.92, 1.7, 0.98)
  body.lineTo(0.85, 1.04)
  body.quadraticCurveTo(0.3, 1.44, -0.05, 1.46)
  body.lineTo(-1.2, 1.46)
  body.quadraticCurveTo(-1.95, 1.42, -2.2, 1.0)
  body.quadraticCurveTo(-2.33, 0.7, -2.25, 0.32)
  const shell = new THREE.ExtrudeGeometry(body, { depth: 1.7, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.08, bevelSegments: 4, curveSegments: 12 })
  shell.translate(0, 0, -0.85)
  shell.rotateY(Math.PI / 2) // nose (+x) now points forward (-z)

  const win = new THREE.Shape()
  win.moveTo(0.78, 1.08)
  win.quadraticCurveTo(0.28, 1.38, -0.03, 1.4)
  win.lineTo(-1.15, 1.4)
  win.quadraticCurveTo(-1.8, 1.36, -2.05, 1.06)
  win.lineTo(0.78, 1.08)
  const glass = new THREE.ExtrudeGeometry(win, { depth: 1.9, bevelEnabled: false, curveSegments: 8 })
  glass.translate(0, 0, -0.95)
  glass.rotateY(Math.PI / 2)

  const wheel = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 20)
  wheel.rotateZ(Math.PI / 2)
  carParts = { shell, glass, wheel }
  return carParts
}

function Car({ mats, big }) {
  const { shell, glass, wheel } = carGeometry()
  return (
    <group scale={big ? [1.25, 1.7, 1.7] : 1}>
      <mesh geometry={shell} material={mats.body} />
      <mesh geometry={glass} material={mats.dark} />
      {[[-0.9, 1.45], [0.9, 1.45], [-0.9, -1.4], [0.9, -1.4]].map(([x, z]) => (
        <mesh key={`${x},${z}`} geometry={wheel} material={mats.dark} position={[x, 0.36, z]} />
      ))}
      <Shadow size={big ? 3.6 : 2.8} />
    </group>
  )
}

function Rod({ from, to, mat, r = 0.025 }) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to)
  const mid = a.clone().add(b).multiplyScalar(0.5)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
  return (
    <mesh position={mid} quaternion={q} material={mat}>
      <cylinderGeometry args={[r, r, a.distanceTo(b), 6]} />
    </mesh>
  )
}

function Bike({ mats }) {
  const back = [0, 0.36, 0.52], front = [0, 0.36, -0.52], seat = [0, 0.92, 0.18], head = [0, 0.95, -0.38], crank = [0, 0.38, 0]
  return (
    <group>
      {[back, front].map((p) => (
        <mesh key={p[2]} position={p} rotation-y={Math.PI / 2} material={mats.body}>
          <torusGeometry args={[0.33, 0.035, 8, 28]} />
        </mesh>
      ))}
      <Rod from={back} to={seat} mat={mats.body} />
      <Rod from={seat} to={crank} mat={mats.body} />
      <Rod from={crank} to={back} mat={mats.body} />
      <Rod from={seat} to={head} mat={mats.body} />
      <Rod from={head} to={front} mat={mats.body} />
      <Rod from={head} to={crank} mat={mats.body} />
      <Rod from={[-0.25, 1.05, -0.4]} to={[0.25, 1.05, -0.4]} mat={mats.body} />
      <Shadow size={0.9} />
    </group>
  )
}

function Person({ fig, moving }) {
  useGait(fig, moving ? 'walk' : 'idle')
  return (
    <group>
      <primitive object={fig.scene} rotation-y={Math.PI} />
      <Shadow size={0.6} />
    </group>
  )
}

function PersonTrack({ track }) {
  const fig = useFigure(GRAY, '#6b6b73')
  return <Track track={track} materials={fig.materials}>{(moving) => <Person fig={fig} moving={moving} />}</Track>
}

function ThingTrack({ track }) {
  const mats = useMemo(() => ({
    body: new THREE.MeshStandardMaterial({ color: GRAY, roughness: 0.55, metalness: 0.1, transparent: true }),
    dark: new THREE.MeshStandardMaterial({ color: '#26262b', roughness: 0.4, transparent: true }),
  }), [])
  return (
    <Track track={track} materials={[mats.body, mats.dark]} tint={mats.body}>
      {() => (track.kind === 'bike' ? <Bike mats={mats} /> : <Car mats={mats} big={track.kind === 'truck'} />)}
    </Track>
  )
}

// Glides a tracked thing to where the camera last saw it, turns it the way it's moving, fades it
// in when first seen and out when the camera loses it.
function Track({ track, materials, tint, children }) {
  const group = useRef()
  const [moving, setMoving] = useState(false)
  const color = useMemo(() => new THREE.Color(), [])
  useFrame((_, dt) => {
    const g = group.current
    if (!g) return
    const k = Math.min(1, dt * 4)
    const px = track.x, pz = track.z
    track.x += (track.tx - track.x) * k
    track.z += (track.tz - track.z) * k
    const vx = (track.x - px) / dt, vz = (track.z - pz) / dt
    const speed = Math.hypot(vx, vz)
    track.speed += (speed - track.speed) * Math.min(1, dt * 2)
    if (track.speed > 0.35) {
      const turn = Math.atan2(-vx, -vz) - g.rotation.y
      g.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * k // the short way round
    }
    if ((track.speed > 0.4) !== moving) setMoving(track.speed > 0.4)
    const want = performance.now() - track.seen < SEEN_MS ? 1 : 0
    track.fade += (want - track.fade) * Math.min(1, dt * (want ? 6 : 2))
    g.position.set(track.x, 0, track.z)
    for (const m of materials) m.opacity = track.fade
    if (tint) {
      const danger = track.kind !== 'person' && track.dist < NEAR
      tint.color.lerp(color.set(danger ? DANGER : GRAY), k)
    }
  })
  return <group ref={group}>{children(moving)}</group>
}

// Matches each new batch of detections to what's already on screen (same kind, nearest spot),
// so a car glides instead of popping, and drops things that faded out.
function Surroundings({ front, rear }) {
  const tracks = useRef([])
  const nextId = useRef(1)
  const [, bump] = useState(0)

  const ingest = (side, objects) => {
    const now = performance.now()
    const used = new Set()
    let added = false
    for (const o of objects) {
      const [x, z] = place(side, o)
      let best = null, bestD = 2.5
      for (const t of tracks.current) {
        if (t.side !== side || t.kind !== o.kind || used.has(t)) continue
        const d = Math.hypot(t.tx - x, t.tz - z)
        if (d < bestD) { bestD = d; best = t }
      }
      if (best) { used.add(best); Object.assign(best, { tx: x, tz: z, seen: now, dist: o.dist }) }
      else {
        tracks.current.push({ id: nextId.current++, side, kind: o.kind, x, z, tx: x, tz: z, seen: now, dist: o.dist, fade: 0, speed: 0 })
        added = true
      }
    }
    if (added) bump((n) => n + 1)
  }
  useEffect(() => ingest('front', front.objects), [front])
  useEffect(() => ingest('rear', rear.objects), [rear])

  useFrame(() => {
    const now = performance.now()
    const keep = tracks.current.filter((t) => now - t.seen < SEEN_MS + 1500 || t.fade > 0.02)
    if (keep.length !== tracks.current.length) { tracks.current = keep; bump((n) => n + 1) }
  })

  return tracks.current.map((t) => (t.kind === 'person' ? <PersonTrack key={t.id} track={t} /> : <ThingTrack key={t.id} track={t} />))
}

function Aim() {
  const { camera } = useThree()
  useEffect(() => { camera.lookAt(0, 0, -0.8) }, [camera])
  return null
}

export default function WalkScene({ walk, front, rear }) {
  const speed = walk.walking ? Math.max(1.0, walk.cadence * 0.7) : 0
  return (
    <Canvas dpr={[1, 2]} camera={{ position: [0, 10.5, 2.6], fov: 50, near: 0.1, far: 60 }} gl={{ antialias: true }}>
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 14, 26]} />
      <hemisphereLight args={['#ffffff', '#202024', 1.6]} />
      <directionalLight position={[3, 8, 4]} intensity={1.4} />
      <Aim />
      <Ground speed={speed} />
      <Cone side="front" fov={front.fov} live={front.live} radius={9} />
      <Cone side="rear" fov={rear.fov} live={rear.live} radius={7} />
      <Suspense fallback={null}>
        <Me walking={walk.walking} cadence={walk.cadence} />
        <Surroundings front={front} rear={rear} />
      </Suspense>
    </Canvas>
  )
}
