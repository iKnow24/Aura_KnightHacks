import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { alertText, SEVERITY_COLOR, ZONES, zoneLabel } from './zones'

// The panel to the right of the headset figure. A small 3D room around the wearer:
// each live camera sits on its compass bearing, and a sound (a drop, a voice, something
// behind them) comes in as a beam from the camera that heard it. Bearings are degrees
// clockwise from the wearer's forward. Nothing here is a video frame.

const BLACK = new THREE.MeshStandardMaterial({ color: '#0a0a0c', roughness: 1 })

function spot(bearing, radius) {
  const a = (bearing * Math.PI) / 180
  return [Math.sin(a) * radius, -Math.cos(a) * radius]
}

function Label({ text, position }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 64
    const g = c.getContext('2d')
    g.font = '600 28px Manrope Variable, system-ui, sans-serif'
    const w = Math.min(500, g.measureText(text).width + 28)
    g.fillStyle = 'rgba(13,13,15,0.88)'
    g.beginPath()
    g.roundRect(256 - w / 2, 8, w, 48, 24)
    g.fill()
    g.fillStyle = '#f4f4f5'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, 256, 32)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [text])
  return (
    <sprite position={position} scale={[1.15, 0.15, 1]}>
      <spriteMaterial map={tex} transparent depthTest={false} />
    </sprite>
  )
}

// Wider at the far end, tilted down toward the wearer, so a sound behind them reads as behind.
function Beam({ bearing, color, text, lift = 0 }) {
  const a = (bearing * Math.PI) / 180
  const outer = new THREE.Vector3(Math.sin(a) * 1.05, 1.05, -Math.cos(a) * 1.05)
  const inner = new THREE.Vector3(Math.sin(a) * 0.38, 0.5, -Math.cos(a) * 0.38)
  const mid = outer.clone().add(inner).multiplyScalar(0.5)
  const dir = inner.clone().sub(outer)
  const len = dir.length()
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
  return (
    <group>
      <mesh position={mid} quaternion={q}>
        <cylinderGeometry args={[0.02, 0.07, len, 5]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Label text={text} position={[outer.x * 0.7, outer.y + 0.2 + lift, outer.z * 0.7]} />
    </group>
  )
}

function CameraMark({ bearing, radius = 1.35 }) {
  const [x, z] = spot(bearing, radius)
  return (
    <mesh position={[x, 0.18, z]}>
      <boxGeometry args={[0.1, 0.08, 0.14]} />
      <meshStandardMaterial color="#e4e4e7" roughness={0.4} />
    </mesh>
  )
}

function PersonMark({ bearing, slot = 0 }) {
  const [x, z] = spot(bearing, 1.05)
  const tangent = bearing + 90
  const [dx, dz] = spot(tangent, 0.22 * slot)
  return (
    <group position={[x + dx, 0, z + dz]}>
      <mesh position={[0, 0.72, 0]} material={BLACK}>
        <capsuleGeometry args={[0.07, 0.22, 3, 6]} />
      </mesh>
      <mesh position={[0, 1.05, 0]} material={BLACK}>
        <sphereGeometry args={[0.08, 10, 8]} />
      </mesh>
    </group>
  )
}

// On the body, not out in the room: back cam behind the person, security phone on the chest.
const ON_BODY = [
  ['behind', 0.7, 'Back cam'],
  ['drone', 0.42, 'Phone'],
]

export default function SoundField({ nodes, now, alerts, vision, direction }) {
  const cameras = Object.values(nodes || {}).filter((n) => now - n.last_seen < 10 && ZONES[n.zone]?.bearing != null)
  const heard = (alerts || []).filter((a) => ZONES[a.zone]?.bearing != null)
  const side = direction && now - direction.ts < 1.8 && ZONES[direction.zone]?.bearing != null ? direction : null
  const atCenter = side?.zone === 'wearer'
  const people = Object.values(vision || {}).filter((v) => now - v.ts < 15 && v.people > 0 && ZONES[v.zone]?.bearing != null)
  return (
    <Canvas dpr={[1, 1.5]} camera={{ position: [2.1, 2.6, 3.3], fov: 36 }} onCreated={({ camera }) => camera.lookAt(0, 0.65, 0)}>
      <color attach="background" args={['#0d0d0f']} />
      <hemisphereLight args={['#ffffff', '#18181b', 1.2]} />
      <directionalLight position={[2, 4, 2]} intensity={1.1} />
      <mesh rotation-x={-Math.PI / 2}>
        <circleGeometry args={[1.85, 64]} />
        <meshBasicMaterial color="#161618" />
      </mesh>
      <mesh position={[0, 0.85, 0]}>
        <capsuleGeometry args={[0.09, 0.34, 4, 8]} />
        <meshStandardMaterial color={atCenter ? '#f4f4f5' : '#d4d4d8'} roughness={0.6} />
      </mesh>
      <Label text={atCenter ? 'Headset' : 'You'} position={[0, 1.45, 0]} />
      {ON_BODY.map(([zone, radius, label]) => {
        const [x, z] = spot(ZONES[zone].bearing, radius)
        return (
          <group key={zone}>
            <CameraMark bearing={ZONES[zone].bearing} radius={radius} />
            <Label text={label} position={[x, 0.55, z]} />
          </group>
        )
      })}
      {cameras.filter((n) => n.zone !== 'wearer' && n.zone !== 'behind' && n.zone !== 'drone').map((n) => <CameraMark key={n.zone} bearing={ZONES[n.zone].bearing} />)}
      {side && !atCenter && <Beam bearing={ZONES[side.zone].bearing} color="#f4f4f5" text={side.zone === 'drone' ? 'Phone' : 'Back cam'} />}
      {people.map((v) => Array.from({ length: Math.min(v.people, 3) }, (_, i) => (
        <PersonMark key={`${v.node_id}-${i}`} bearing={ZONES[v.zone].bearing} slot={i - 1} />
      )))}
      {heard.map((a, i) => {
        const name = alertText(a.kind).text
        const where = zoneLabel(a.zone)
        const text = name.length > 22 ? `${name.slice(0, 20)}…` : `${name} · ${where}`
        return (
          <Beam key={a.id} bearing={ZONES[a.zone].bearing} color={SEVERITY_COLOR[a.severity] ?? '#f4f4f5'}
            text={text} lift={i * 0.22} />
        )
      })}
    </Canvas>
  )
}
