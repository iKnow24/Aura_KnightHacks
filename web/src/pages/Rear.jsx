import { FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision'
import { useEffect, useRef, useState } from 'react'
import { keepAwake } from '../lib/useBrain'

// Outside mode: a second phone clipped to the back of a bag, camera facing behind you.
// It runs a small object detector on the phone itself and watches for people, bikes and cars
// that get bigger in frame fast (coming toward you). Only a one-line "approach" message goes
// to the brain; video never leaves the phone. The brain decides the alert (Outside mode only).
const WATCH = new Set(['person', 'bicycle', 'car', 'truck', 'bus', 'motorcycle'])
const FPS = 6
const MIN_AREA = 0.04 // ignore things far away (under 4% of the frame)
const GROWTH = 1.6 // 60% bigger within about a second = approaching
const COOLDOWN_MS = 4000

const wsUrl = (path) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`

async function loadDetector() {
  const files = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: '/mediapipe/efficientdet_lite0.tflite', delegate },
    runningMode: 'VIDEO', scoreThreshold: 0.45, maxResults: 6,
  })
  try { return await ObjectDetector.createFromOptions(files, options('GPU')) } catch { return ObjectDetector.createFromOptions(files, options('CPU')) }
}

export default function Rear() {
  const [status, setStatus] = useState('idle')
  const [mode, setMode] = useState('?')
  const [last, setLast] = useState(null)
  const videoRef = useRef()
  const canvasRef = useRef()
  const stopRef = useRef(() => {})

  useEffect(() => () => stopRef.current(), [])

  const start = async () => {
    setStatus('loading model…')
    await keepAwake()
    const detector = await loadDetector()
    const cam = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: 640, height: 480 } })
    videoRef.current.srcObject = cam
    await videoRef.current.play()

    let ws, closed = false
    const open = () => {
      ws = new WebSocket(wsUrl(`/ws/node/rear-${Math.random().toString(36).slice(2, 6)}?zone=behind`))
      ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'state') setMode(m.mode) }
      ws.onclose = () => { if (!closed) setTimeout(open, 1000) }
    }
    open()
    setStatus('watching behind you')

    const history = {} // label -> [{t, area}]
    const fired = {}
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
        const c = d.categories[0]
        if (!WATCH.has(c.categoryName)) continue
        const b = d.boundingBox
        const area = (b.width * b.height) / (v.videoWidth * v.videoHeight)
        if (area > (biggest[c.categoryName]?.area ?? 0)) biggest[c.categoryName] = { area, score: c.score }
        ctx.strokeStyle = '#fbbf24'
        ctx.lineWidth = 3
        ctx.strokeRect(b.originX, b.originY, b.width, b.height)
        ctx.fillStyle = '#fbbf24'
        ctx.font = '16px sans-serif'
        ctx.fillText(`${c.categoryName} ${Math.round(area * 100)}%`, b.originX + 4, b.originY + 18)
      }
      for (const [label, { area, score }] of Object.entries(biggest)) {
        const h = (history[label] = [...(history[label] ?? []), { t: now, area }].filter((x) => now - x.t < 1500))
        const old = h.find((x) => now - x.t > 800)
        if (old && area > MIN_AREA && area / old.area > GROWTH && now - (fired[label] ?? 0) > COOLDOWN_MS) {
          fired[label] = now
          setLast({ label, at: new Date().toLocaleTimeString() })
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'approach', label, score, area, ts: Date.now() / 1000 }))
        }
      }
    }, 1000 / FPS)

    stopRef.current = () => { closed = true; clearInterval(timer); ws.close(); cam.getTracks().forEach((t) => t.stop()) }
  }

  return (
    <main className="relative h-full bg-black">
      <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
      {status === 'idle' ? (
        <button onClick={start} className="absolute inset-0 grid place-items-center bg-black p-6 text-center">
          <div>
            <div className="text-2xl font-semibold">Rear guard</div>
            <p className="mt-2 text-zinc-400">Clip this phone to the back of your bag, camera facing behind you. Tap to start.</p>
          </div>
        </button>
      ) : (
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 p-4 text-sm">
          <div>● {status}</div>
          {mode !== 'outside' && mode !== '?' && <div className="text-amber-400">Alerts only go out in Outside mode (now: {mode}).</div>}
          {last && <div className="mt-1 text-zinc-300">Last: {last.label} approaching at {last.at}</div>}
        </div>
      )}
    </main>
  )
}
