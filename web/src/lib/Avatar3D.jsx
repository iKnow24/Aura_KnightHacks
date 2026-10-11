import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { openCamera } from './cameras'
import { isWalking, makeRig, poseRig, resetRig, withIdle } from './avatarRig'
import { dressAsWearer } from './outfit'
import { detectPeople, loadPose } from './pose'
import { ZONES } from './zones'

// Bottom-left of the control center: the person in the headset, as a 3D figure that copies their
// pose. The laptop webcam faces them; MediaPipe finds 33 body points on this laptop and the figure's
// bones are turned to match. Video and body points stay in this browser tab.
//
// Figure: drop a Mixamo-rigged character exported from Blender (File > Export > glTF 2.0, .glb) at
// web/public/models/avatar.glb. Without it, the walker figure from the captions view is used, dressed
// in code (outfit.js) like the team member who wears the headset in the demo.
const MODELS = ['avatar.glb', 'walker.glb'].map((f) => `${import.meta.env.BASE_URL}models/${f}`)
const POSE_FPS = 20
const LOOK_AT = new THREE.Vector3(0, 1.05, 0)
const INTRO_SECONDS = 4.6

// One full turn on open, then the same orbit is the user's to drag. Ease in and out so it
// settles facing the front instead of stopping mid-spin.
function smoothstep(t) {
  t = Math.min(1, Math.max(0, t))
  return 0.5 - 0.5 * Math.cos(Math.PI * t)
}

function Stage({ ready, onSettled }) {
  const { camera, gl } = useThree()
  const controls = useRef(null)
  const intro = useRef(0)
  const held = useRef(false)
  const told = useRef(false)

  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement)
    c.target.copy(LOOK_AT)
    c.enablePan = false
    c.enableDamping = false
    c.dampingFactor = 0.08
    c.minDistance = 2.3
    c.maxDistance = 5.4
    c.minPolarAngle = 0.35
    c.maxPolarAngle = Math.PI / 2 + 0.08
    controls.current = c
    const el = gl.domElement
    el.style.touchAction = 'none'
    el.style.cursor = 'grab'
    const grab = () => { held.current = true; el.style.cursor = 'grabbing' }
    const release = () => { el.style.cursor = 'grab' }
    el.addEventListener('pointerdown', grab)
    el.addEventListener('pointerup', release)
    return () => {
      el.removeEventListener('pointerdown', grab)
      el.removeEventListener('pointerup', release)
      c.dispose()
    }
  }, [camera, gl])

  useFrame((_, dt) => {
    const c = controls.current
    if (!c) return
    const settle = () => {
      if (told.current) return
      told.current = true
      c.enableDamping = true
      onSettled()
    }
    // Wait until the figure is on screen, or the turn finishes before anyone can see it.
    if (!ready) return
    const spinning = !held.current && intro.current < INTRO_SECONDS
    if (spinning) {
      intro.current += Math.min(dt, 0.05)
      const turn = smoothstep(intro.current / INTRO_SECONDS) * Math.PI * 2
      camera.position.set(Math.sin(turn) * 3.4, 1.25, Math.cos(turn) * 3.4)
      camera.lookAt(LOOK_AT)
      c.update()
      if (intro.current >= INTRO_SECONDS) settle()
      return
    }
    settle()
    c.update()
  })
  return null
}

async function loadFigure() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  for (const url of MODELS) {
    try { return { gltf: await loader.loadAsync(url), custom: url === MODELS[0] } } catch { /* next */ }
  }
  throw new Error('No 3D figure found')
}

const LIMB = [
  [11, 13], [13, 15], [12, 14], [14, 16], [11, 12], [11, 23], [12, 24],
  [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [0, 11], [0, 12],
]
const up = new THREE.Vector3(0, 1, 0)
const black = new THREE.MeshStandardMaterial({ color: '#0a0a0c', roughness: 1, side: THREE.DoubleSide })

function mpPoint(p) {
  return new THREE.Vector3(p[0], -p[1] + 0.95, -p[2])
}

// Other people in the same camera, drawn as solid black figures. No face, no color.
function Bystanders({ peopleRef }) {
  const limbs = useRef([])
  useFrame(() => {
    const people = (peopleRef.current || []).slice(1, 3)
    limbs.current.forEach((mesh, i) => {
      if (!mesh) return
      const person = people[Math.floor(i / LIMB.length)]
      const pair = LIMB[i % LIMB.length]
      if (!person || person.world[pair[0]][3] < 0.4 || person.world[pair[1]][3] < 0.4) {
        mesh.visible = false
        return
      }
      const a = mpPoint(person.world[pair[0]])
      const b = mpPoint(person.world[pair[1]])
      const side = (person.x - 0.5) * 1.7
      a.x += side
      b.x += side
      const mid = a.clone().add(b).multiplyScalar(0.5)
      const dir = b.clone().sub(a)
      const len = Math.max(0.04, dir.length())
      mesh.visible = true
      mesh.position.copy(mid)
      mesh.quaternion.setFromUnitVectors(up, dir.normalize())
      mesh.scale.set(1, len, 1)
    })
  })
  return (
    <group>
      {Array.from({ length: LIMB.length * 2 }, (_, i) => (
        <mesh key={i} ref={(el) => { limbs.current[i] = el }} material={black} visible={false}>
          <cylinderGeometry args={[0.035, 0.035, 1, 6]} />
        </mesh>
      ))}
    </group>
  )
}

function Figure({ poseRef, onReady, onGait }) {
  const [fig, setFig] = useState(null)
  useEffect(() => {
    let live = true
    loadFigure().then(({ gltf, custom }) => {
      if (!live) return
      const scene = cloneSkinned(gltf.scene)
      if (!custom) dressAsWearer(scene) // the walker figure, dressed like the person in the demo headset
      scene.traverse((o) => {
        if (!o.isMesh) return
        o.frustumCulled = false
        // Draw both sides of every surface so the back of the shirt and hair stay solid as you orbit.
        for (const m of [o.material].flat()) {
          if (!m) continue
          m.side = THREE.DoubleSide
          if (!custom) continue
          if (/hair|afro|eyebrow|eyelash/i.test(m.name)) Object.assign(m, { alphaTest: 0.45, transparent: false, depthWrite: true })
          else if (!/high-poly|cornea/i.test(m.name)) m.transparent = false
        }
      })
      // Same height on screen whatever the model's units (Blender/Mixamo exports often carry a 0.01 scale).
      scene.updateMatrixWorld(true)
      const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3())
      scene.scale.setScalar(1.75 / (size.y || 1.75))
      const mixer = new THREE.AnimationMixer(scene)
      const idle = gltf.animations.find((c) => /idle/i.test(c.name)) ?? gltf.animations[0]
      if (idle) mixer.clipAction(idle).play()
      setFig({ scene, mixer, rig: makeRig(scene), hasIdle: !!idle })
      onReady()
    }).catch((e) => console.warn('Avatar figure failed to load', e))
    return () => { live = false }
  }, [])

  const gait = useRef({})
  const wasWalking = useRef(false)
  useFrame(({ clock }, dt) => {
    if (!fig) return
    dt = Math.min(dt, 0.1)
    const walking = isWalking(poseRef.current, gait.current, dt)
    if (walking !== wasWalking.current) { wasWalking.current = walking; onGait?.(walking) }
    resetRig(fig.rig)
    fig.mixer.update(dt)
    // A walk cycle fills in the legs the camera cannot see. Tracked points still win, so a real step shows.
    const lm = (poseRef.current || walking || !fig.hasIdle) ? withIdle(poseRef.current, clock.elapsedTime, walking) : null
    poseRig(fig.rig, fig.scene, lm, dt)
  })
  return fig ? <primitive object={fig.scene} /> : null
}

function BodyMics() {
  return (
    <group>
      <mesh position={[0.14, 1.12, 0.18]}>
        <boxGeometry args={[0.07, 0.13, 0.016]} />
        <meshStandardMaterial color="#f4f4f5" roughness={0.35} />
      </mesh>
      <mesh position={[0, 1.28, -0.24]}>
        <boxGeometry args={[0.1, 0.045, 0.04]} />
        <meshStandardMaterial color="#d4d4d8" roughness={0.45} />
      </mesh>
    </group>
  )
}

function Heard({ bearing, atCenter }) {
  if (atCenter) {
    return (
      <mesh position={[0, 1.05, 0]}>
        <sphereGeometry args={[0.16, 16, 12]} />
        <meshBasicMaterial color="#f4f4f5" transparent opacity={0.35} />
      </mesh>
    )
  }
  if (bearing == null) return null
  const a = (bearing * Math.PI) / 180
  const dist = Math.abs(bearing) < 1 ? 0.55 : 0.85
  const from = new THREE.Vector3(Math.sin(a) * dist, 1.15, Math.cos(a) * dist)
  const to = new THREE.Vector3(0, 1.05, 0)
  const mid = from.clone().add(to).multiplyScalar(0.5)
  const dir = to.clone().sub(from)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
  return (
    <mesh position={mid} quaternion={q}>
      <cylinderGeometry args={[0.012, 0.045, dir.length(), 6]} />
      <meshBasicMaterial color="#f4f4f5" />
    </mesh>
  )
}

export default function Avatar3D({ cams, direction = null }) {
  const [deviceId, setDeviceId] = useState(() => { try { return localStorage.getItem('lumen.avatarCam') || '' } catch { return '' } })
  const [on, setOn] = useState(false)
  const [status, setStatus] = useState('Off')
  const [hint, setHint] = useState('')
  const [figureReady, setFigureReady] = useState(false)
  const video = useRef()
  const poseRef = useRef(null)
  const peopleRef = useRef([])
  const cam = cams.find((c) => c.id === deviceId) ?? cams[0]
  const fresh = direction && Date.now() / 1000 - direction.ts < 1.8 && ZONES[direction.zone]
  const atCenter = fresh && direction.zone === 'wearer'
  const bearing = fresh && !atCenter ? ZONES[direction.zone].bearing : null
  const sideName = !fresh ? '' : direction.zone === 'wearer' ? 'Headset' : direction.zone === 'drone' ? 'Phone' : 'Back cam'

  useEffect(() => {
    if (!on || !cam) return
    let live = true, timer
    setStatus('Starting camera…')
    ;(async () => {
      try {
        const stream = await openCamera(cam.id)
        if (!live) return
        video.current.srcObject = stream
        await video.current.play().catch(() => {})
        setStatus('Loading body tracking…')
        await loadPose()
        if (!live) return
        setStatus('Looking for the person…')
        let seen = null
        timer = setInterval(() => {
          const people = detectPeople(video.current, performance.now())
          peopleRef.current = people
          const lm = people[0]?.world ?? null
          poseRef.current = lm
          if (!!lm !== seen) { seen = !!lm; setStatus(lm ? 'Tracking' : 'Looking for the person…') }
        }, 1000 / POSE_FPS)
      } catch (e) {
        if (live) setStatus(e.name === 'NotAllowedError' ? 'Camera blocked: allow it in the browser.' : `Camera: ${e.message || e}`)
      }
    })()
    return () => { live = false; clearInterval(timer); poseRef.current = null; peopleRef.current = [] }
  }, [on, cam?.id])

  const pick = (id) => {
    setDeviceId(id)
    try { localStorage.setItem('lumen.avatarCam', id) } catch { /* private window */ }
  }

  return (
    <figure className="glass relative h-full min-h-[200px] overflow-hidden rounded-xl bg-[#0d0d0f]">
      <Canvas dpr={[1, 2]} camera={{ position: [0, 1.25, 3.4], fov: 32 }} onCreated={({ camera }) => camera.lookAt(LOOK_AT)}>
        <Stage ready={figureReady} onSettled={() => setHint('Drag to turn')} />
        <hemisphereLight args={['#ffffff', '#222226', 1.4]} />
        <directionalLight position={[2, 4, 3]} intensity={1.6} />
        <Figure poseRef={poseRef} onReady={() => setFigureReady(true)} onGait={(walking) => setStatus(walking ? 'Walking' : 'Tracking')} />
        <Bystanders peopleRef={peopleRef} />
        <BodyMics />
        <Heard bearing={bearing} atCenter={atCenter} />
        <mesh rotation-x={-Math.PI / 2}><circleGeometry args={[0.9, 48]} /><meshBasicMaterial color="#18181b" /></mesh>
      </Canvas>
      {/* Small self-view so the person can see they're in frame. */}
      <video ref={video} playsInline muted aria-hidden="true"
        className={`absolute bottom-2 right-2 w-20 -scale-x-100 rounded-md border border-white/10 bg-black ${on ? '' : 'hidden'}`} />
      <figcaption className="glass-dark absolute left-2 top-2 flex max-w-[calc(100%-1rem)] items-center gap-2 rounded-full py-0.5 pl-3 pr-1 text-xs">
        <span className="font-medium">Headset wearer</span>
        {cams.length > 1 && (
          <select value={cam?.id ?? ''} onChange={(e) => pick(e.target.value)} aria-label="Avatar camera"
            className="min-w-0 max-w-32 truncate rounded-full bg-transparent text-zinc-400 outline-none">
            {cams.map((c) => <option key={c.id} value={c.id} className="bg-ink">{c.label}</option>)}
          </select>
        )}
        <button onClick={() => setOn((v) => !v)} disabled={!cam}
          className="rounded-full bg-zinc-100 px-2.5 py-0.5 font-semibold text-ink disabled:opacity-40">
          {on ? 'Stop' : 'Start'}
        </button>
      </figcaption>
      {fresh && <p className="pointer-events-none absolute left-0 right-0 top-12 text-center text-sm font-semibold">{sideName}</p>}
      <p className="pointer-events-none absolute bottom-7 left-0 right-0 text-center text-xs text-zinc-500">{hint}</p>
      <p className="absolute bottom-2 left-3 text-xs text-zinc-400" aria-live="polite">{cam ? status : 'No laptop camera found'}</p>
    </figure>
  )
}
