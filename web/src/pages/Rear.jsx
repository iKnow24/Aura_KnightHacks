import { useEffect, useRef, useState } from 'react'
import { cameraFov, isApproaching, loadDetector, measure, toObjects } from '../lib/surroundings'
import { api, keepAwake } from '../lib/useBrain'

// Outside mode: a second phone clipped to the back of a bag, camera facing behind you.
// It runs a small object detector on the phone itself and watches for people, bikes and cars
// that are getting closer. Only short JSON goes to the brain: an "approach" when something
// closes in (the brain decides the alert, Outside mode only), and a few times a second a
// "scene" list of what's back there for the wearer's walking-figure view.
// Video never leaves the phone.
const FPS = 6
const COOLDOWN_MS = 4000

const wsUrl = (path) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`

export default function Rear() {
  const [status, setStatus] = useState('idle')
  const [link, setLink] = useState('offline')
  const [mode, setMode] = useState('?')
  const [last, setLast] = useState(null)
  const [seen, setSeen] = useState([])
  const videoRef = useRef()
  const canvasRef = useRef()
  const stopRef = useRef(() => {})

  useEffect(() => () => stopRef.current(), [])

  const start = async () => {
    setStatus('loading model…')
    await keepAwake()
    let detector
    try {
      detector = await loadDetector()
    } catch (e) {
      setStatus(`model didn't load: ${e.message || e}`)
      return
    }
    let cam
    try {
      cam = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: 640, height: 480 } })
    } catch (e) {
      setStatus(`camera blocked: ${e.message || e}`)
      return
    }
    videoRef.current.srcObject = cam
    await videoRef.current.play()

    let ws, closed = false
    const open = () => {
      ws = new WebSocket(wsUrl(`/ws/node/rear-${Math.random().toString(36).slice(2, 6)}?zone=behind`))
      ws.onopen = () => setLink('connected')
      ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'state') setMode(m.mode) }
      ws.onclose = () => { if (!closed) { setLink('reconnecting'); setTimeout(open, 1000) } }
    }
    open()
    setStatus('watching behind you')

    const tracks = {} // label -> [{t, dist, area}]
    const fired = {}
    const startedAt = performance.now()
    const timer = setInterval(() => {
      const v = videoRef.current
      if (!v || v.readyState < 2) return
      const now = performance.now()
      const { detections } = detector.detectForVideo(v, now)
      const ctx = canvasRef.current.getContext('2d')
      canvasRef.current.width = v.videoWidth
      canvasRef.current.height = v.videoHeight
      ctx.clearRect(0, 0, v.videoWidth, v.videoHeight)
      const biggest = {}
      for (const d of detections) {
        const m = measure(d, v.videoWidth, v.videoHeight)
        if (!m) continue
        if (!biggest[m.label] || m.area > biggest[m.label].area) biggest[m.label] = m
        const b = m.box
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 3
        ctx.strokeRect(b.originX, b.originY, b.width, b.height)
        ctx.fillStyle = '#fff'
        ctx.font = '700 18px sans-serif'
        ctx.fillText(`${m.label} ${m.dist} m`, b.originX + 4, b.originY + 22)
      }
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'scene', objects: toObjects(detections, v.videoWidth, v.videoHeight), fov: cameraFov(v.videoWidth, v.videoHeight) }))
      }
      for (const label of Object.keys(tracks)) {
        const lastSample = tracks[label][tracks[label].length - 1]
        if (!biggest[label] && now - lastSample.t > 700) delete tracks[label]
      }
      const live = []
      for (const [label, m] of Object.entries(biggest)) {
        const samples = tracks[label] = [...(tracks[label] ?? []), { t: now, dist: m.dist, area: m.area }].filter((x) => now - x.t < 2000)
        const closing = samples.length >= 2 && samples[samples.length - 1].dist < samples[0].dist - 0.3
        live.push({ label, dist: m.dist, closing })
        const allowSudden = samples[0].t - startedAt > 2000
        if (isApproaching(label, samples, now, { allowSudden }) && now - (fired[label] ?? 0) > COOLDOWN_MS) {
          fired[label] = now
          setLast({ label, at: new Date().toLocaleTimeString() })
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'approach', label, score: m.score, area: m.area, ts: Date.now() / 1000 }))
        }
      }
      setSeen(live)
    }, 1000 / FPS)

    stopRef.current = () => { closed = true; clearInterval(timer); ws?.close(); cam.getTracks().forEach((t) => t.stop()) }
  }

  return (
    <main className="relative h-full bg-black text-white">
      <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
      {status === 'idle' ? (
        <button onClick={start} className="absolute inset-0 grid place-items-center bg-black p-6 text-center">
          <div>
            <div className="text-3xl font-semibold">Rear guard</div>
            <p className="mx-auto mt-3 max-w-sm text-lg text-zinc-300">Clip this phone to the back of the bag, camera facing behind you. Tap to start.</p>
          </div>
        </button>
      ) : (
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black via-black/80 to-transparent p-4 pb-16">
          <div className="text-lg font-semibold">● {status}</div>
          <div className="text-sm text-zinc-300">Brain {link}</div>
          {seen.length > 0 && (
            <div className="mt-2 text-lg font-semibold">
              {seen.map((s) => `${s.label} ${s.dist} m${s.closing ? ' · closing' : ''}`).join('   ')}
            </div>
          )}
          {mode !== 'outside' && mode !== '?' && (
            <div className="mt-2">
              <div className="text-base font-semibold">Alerts are off until Outside mode (now: {mode}).</div>
              <button onClick={() => api('/api/mode', { mode: 'outside' })} className="mt-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black">
                Switch to Outside
              </button>
            </div>
          )}
          {last && <div className="mt-2 text-base">Warned: {last.label} at {last.at}</div>}
        </div>
      )}
    </main>
  )
}
