import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { openCamera } from './cameras'
import { makeRig, poseRig, resetRig, withIdle } from './avatarRig'
import { dressAsWearer } from './outfit'
import { detectPoseWorld, loadPose } from './pose'

// Bottom-left of the control center: the person in the headset, as a 3D figure that copies their
// pose. The laptop webcam faces them; MediaPipe finds 33 body points on this laptop and the figure's
// bones are turned to match. Video and body points stay in this browser tab.
//
// Figure: drop a Mixamo-rigged character exported from Blender (File > Export > glTF 2.0, .glb) at
// web/public/models/avatar.glb. Without it, the walker figure from the captions view is used, dressed
// in code (outfit.js) like the team member who wears the headset in the demo.
const MODELS = ['avatar.glb', 'walker.glb'].map((f) => `${import.meta.env.BASE_URL}models/${f}`)
const POSE_FPS = 20

async function loadFigure() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  for (const url of MODELS) {
    try { return { gltf: await loader.loadAsync(url), custom: url === MODELS[0] } } catch { /* next */ }
  }
  throw new Error('No 3D figure found')
}

function Figure({ poseRef }) {
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
        // Blender exports: hair, brows and lashes as cut-outs, everything else solid, so layers never flicker.
        for (const m of [o.material].flat()) {
          if (!custom || !m) continue
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
    }).catch((e) => console.warn('Avatar figure failed to load', e))
    return () => { live = false }
  }, [])

  useFrame(({ clock }, dt) => {
    if (!fig) return
    dt = Math.min(dt, 0.1)
    resetRig(fig.rig)
    fig.mixer.update(dt)
    // No idle clip in the file (the Blender avatar): stand relaxed and breathe, with the webcam on top.
    const lm = fig.hasIdle ? poseRef.current : withIdle(poseRef.current, clock.elapsedTime)
    poseRig(fig.rig, fig.scene, lm, dt)
  })
  return fig ? <primitive object={fig.scene} /> : null
}

export default function Avatar3D({ cams }) {
  const [deviceId, setDeviceId] = useState(() => { try { return localStorage.getItem('lumen.avatarCam') || '' } catch { return '' } })
  const [on, setOn] = useState(false)
  const [status, setStatus] = useState('Off')
  const video = useRef()
  const poseRef = useRef(null)
  const cam = cams.find((c) => c.id === deviceId) ?? cams[0]

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
          const lm = detectPoseWorld(video.current, performance.now())
          poseRef.current = lm
          if (!!lm !== seen) { seen = !!lm; setStatus(lm ? 'Tracking' : 'Looking for the person…') }
        }, 1000 / POSE_FPS)
      } catch (e) {
        if (live) setStatus(e.name === 'NotAllowedError' ? 'Camera blocked: allow it in the browser.' : `Camera: ${e.message || e}`)
      }
    })()
    return () => { live = false; clearInterval(timer); poseRef.current = null }
  }, [on, cam?.id])

  const pick = (id) => {
    setDeviceId(id)
    try { localStorage.setItem('lumen.avatarCam', id) } catch { /* private window */ }
  }

  return (
    <figure className="glass relative h-full min-h-[200px] overflow-hidden rounded-xl bg-[#0d0d0f]">
      <Canvas dpr={[1, 2]} camera={{ position: [0, 1.25, 3.4], fov: 32 }} onCreated={({ camera }) => camera.lookAt(0, 1.0, 0)}>
        <hemisphereLight args={['#ffffff', '#222226', 1.4]} />
        <directionalLight position={[2, 4, 3]} intensity={1.6} />
        <Figure poseRef={poseRef} />
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
      <p className="absolute bottom-2 left-3 text-xs text-zinc-400" aria-live="polite">{cam ? status : 'No laptop camera found'}</p>
    </figure>
  )
}
