import { Canvas, useFrame } from '@react-three/fiber'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { SEVERITY_COLOR, zoneLabel } from './zones'

// The caregiver dashboard's 3D view: the Gaussian splat scan of the home (same file as the captions
// Room view, set in public/splats/room.json), slowly turning, with a dot for each room a phone
// watches. When an alert comes in, that room's dot sends out rings in the alert's color.
const RoomSplat = lazy(() => import('./RoomSplat'))
const DIR = `${import.meta.env.BASE_URL}splats/`
const BG = '#0d0d0f'

// Text drawn once to a canvas and shown as a sprite that always faces the camera.
function Label({ text, position }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 256; c.height = 64
    const g = c.getContext('2d')
    g.font = '600 30px Manrope Variable, system-ui, sans-serif'
    const w = Math.min(248, g.measureText(text).width + 36)
    g.fillStyle = 'rgba(13,13,15,0.82)' // dark pill so the name reads on a white counter too
    g.beginPath(); g.roundRect(128 - w / 2, 8, w, 48, 24); g.fill()
    g.fillStyle = '#f4f4f5'; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(text, 128, 32)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [text])
  return (
    <sprite position={position} scale={[1.2, 0.3, 1]} renderOrder={12}>
      <spriteMaterial map={tex} transparent depthTest={false} />
    </sprite>
  )
}

// One ring that grows and fades three times, then stays gone.
function Ripple({ color }) {
  const mesh = useRef()
  const t = useRef(0)
  useFrame((_, dt) => {
    t.current += dt
    const k = (t.current % 1.5) / 1.5
    const done = t.current > 4.5
    mesh.current.scale.setScalar(0.2 + k * 1.6)
    mesh.current.material.opacity = done ? 0 : 1 - k
  })
  return (
    <mesh ref={mesh} rotation-x={-Math.PI / 2} renderOrder={11}>
      <ringGeometry args={[0.85, 1, 48]} />
      <meshBasicMaterial color={color} transparent depthTest={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

function Zone({ id, at, live, ripples }) {
  return (
    <group position={at}>
      <mesh renderOrder={11}>
        <sphereGeometry args={[0.07, 16, 12]} />
        {/* transparent so it draws after the splat (opaque things get painted over by it) */}
        <meshBasicMaterial color={live ? '#f4f4f5' : '#52525b'} transparent depthTest={false} />
      </mesh>
      <Label text={zoneLabel(id)} position={[0, 0.35, 0]} />
      {ripples.map((a) => <Ripple key={a.id} color={SEVERITY_COLOR[a.severity] ?? '#f4f4f5'} />)}
    </group>
  )
}

// Slow orbit around the room. Moving the camera (not the room) keeps the splat sorting correct.
function Orbit({ radius = 7.5, height = 6 }) {
  useFrame(({ camera, clock }) => {
    const a = clock.elapsedTime * 0.12
    camera.position.set(Math.sin(a) * radius, height, Math.cos(a) * radius)
    camera.lookAt(0, 0, 0)
  })
  return null
}

// `live`: zone ids with a phone online. `ripples`: alerts from the last few seconds.
export default function HomeScan({ live, ripples, onFail }) {
  const [zones, setZones] = useState({})
  useEffect(() => {
    fetch(`${DIR}room.json`).then((r) => r.json()).then((cfg) => setZones(cfg.zones ?? {})).catch(() => {})
  }, [])
  return (
    <Canvas dpr={[1, 1.5]} camera={{ position: [0, 6, 7.5], fov: 45, near: 0.1, far: 100 }}>
      <color attach="background" args={[BG]} />
      <Orbit />
      <Suspense fallback={null}><RoomSplat onFail={onFail} /></Suspense>
      {Object.entries(zones).map(([id, at]) => (
        <Zone key={id} id={id} at={at} live={live.has(id)} ripples={ripples.filter((a) => a.zone === id)} />
      ))}
    </Canvas>
  )
}
