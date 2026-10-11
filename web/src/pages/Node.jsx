import { useEffect, useRef, useState } from 'react'
import { nodeSocket, streamMic } from '../lib/audio'
import { api, keepAwake } from '../lib/useBrain'
import { BONES, detectPose, loadPose } from '../lib/pose'
import { loadDetector } from '../lib/surroundings'
import { createSpillWatch } from '../lib/spill'

// A spare phone in a room. Streams 16 kHz mono audio and, unless ?pose=0, body keypoints
// at 10 fps for fall detection. Unless ?items=0, it also sends one small still photo every
// SNAPSHOT_S seconds so the brain can remember where keys, wallet, glasses were last seen.
// Optional demo preview sends a small still each second to the dashboard, without saving it.
// Mount the phone high (about 1.8 m) and angled down so a person on the floor stays in frame.

const POSE_FPS = 10
const SNAPSHOT_S = 5

export default function Node() {
  const params = new URLSearchParams(location.search)
  const zone = params.get('zone') || 'living'
  const [nodeId] = useState(() => `${params.get('id') || zone}-${Math.random().toString(36).slice(2, 8)}`)
  const [preview, setPreview] = useState(false)
  const usePose = params.get('pose') !== '0'
  const useItems = params.get('items') !== '0'
  const useSpill = params.get('spill') !== '0'
  const useCamera = usePose || useItems || useSpill || preview
  const [status, setStatus] = useState('idle')
  const [level, setLevel] = useState(0)
  const [personSeen, setPersonSeen] = useState(false)
  const [poseError, setPoseError] = useState(null)
  const [spillNote, setSpillNote] = useState('')
  const [mode, setMode] = useState('?')
  const wsRef = useRef()
  const videoRef = useRef()
  const canvasRef = useRef()
  const timers = useRef([])
  const sessionRef = useRef(null)

  const cleanup = () => {
    const session = sessionRef.current
    if (session) { session.active = false; session.stopMic?.(); session.camera?.getTracks().forEach((t) => t.stop()) }
    sessionRef.current = null
    timers.current.forEach(clearInterval)
    timers.current = []
    wsRef.current?.close()
    wsRef.current = null
  }
  useEffect(() => cleanup, [])

  const send = (data) => wsRef.current?.send(data)

  const startCamera = async (session) => {
    try {
      const cam = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 640, height: 480 },
      })
      if (!session.active) { cam.getTracks().forEach((t) => t.stop()); return }
      session.camera = cam
      videoRef.current.srcObject = cam
      await videoRef.current.play()
      if (!session.active) return
      if (useItems) timers.current.push(setInterval(sendSnapshot, SNAPSHOT_S * 1000))
      if (preview) timers.current.push(setInterval(() => sendSnapshot('camera_preview'), 1000))
      if (useSpill) {
        const watch = createSpillWatch()
        let detector = null
        try { detector = await loadDetector() } catch { /* spill still runs, it just can't ignore people */ }
        timers.current.push(setInterval(() => {
          const v = videoRef.current
          if (!v || v.readyState < 2 || !session.active) return
          const now = performance.now()
          let boxes = []
          if (detector) {
            try {
              boxes = detector.detectForVideo(v, now).detections
                .filter((d) => d.categories[0]?.categoryName === 'person')
                .map((d) => d.boundingBox)
            } catch { /* one bad frame */ }
          }
          const hit = watch(v, boxes, now)
          if (session.active) setSpillNote(hit.status)
          if (hit.hit) send(JSON.stringify({ type: 'spill', score: hit.score, area: hit.area, ts: Date.now() / 1000 }))
        }, 250))
      }
      if (!usePose) return
      await loadPose()
      if (!session.active) return
      timers.current.push(setInterval(() => {
        const now = performance.now()
        const landmarks = detectPose(videoRef.current, now)
        setPersonSeen(!!landmarks)
        drawSkeleton(canvasRef.current, landmarks)
        send(JSON.stringify({ type: 'pose', ts: Date.now() / 1000, landmarks }))
      }, 1000 / POSE_FPS))
    } catch (e) {
      if (session.active) setPoseError(e.message || String(e))
    }
  }

  const sendSnapshot = (type = 'snapshot') => {
    const v = videoRef.current
    if (!v?.videoWidth) return
    const c = document.createElement('canvas')
    c.width = 640
    c.height = Math.round((640 * v.videoHeight) / v.videoWidth)
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
    send(JSON.stringify({ type, ts: Date.now() / 1000, jpeg: c.toDataURL('image/jpeg', 0.6) }))
  }

  const start = async () => {
    if (sessionRef.current) return
    const session = { active: true }
    sessionRef.current = session
    setStatus('starting')
    setPoseError(null)
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Open the shared HTTPS link to allow camera and microphone access.')
      }
      await keepAwake()
      if (!session.active) return
      const stopMic = await streamMic(send, setLevel)
      if (!session.active) { stopMic(); return }
      session.stopMic = stopMic
      wsRef.current = nodeSocket(nodeId, zone, (next) => { if (session.active) setStatus(next) }, (m) => {
        if (session.active && m.type === 'state') setMode(m.mode)
      })
      if (useCamera) await startCamera(session)
    } catch (e) {
      if (!session.active) return
      cleanup()
      setStatus('idle')
      setPoseError(e.name === 'NotAllowedError' ? 'Allow camera and microphone access in this browser, then try again.' : e.message || String(e))
    }
  }

  const color = status === 'streaming' ? 'bg-green-700' : status === 'idle' ? 'bg-zinc-800' : 'bg-amber-600'
  return (
    <div className={`flex min-h-full w-full flex-col items-center justify-center gap-4 p-4 ${color}`}>
      <div className="text-4xl font-bold">{zone}</div>
      <div className="text-xl">{status === 'idle' ? 'Tap to start' : status}</div>
      <div className="text-sm">Device: {nodeId}</div>
      {status === 'idle' && <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} />
        Show camera on laptop (demo, 1 image/sec)
      </label>}
      <button onClick={status === 'idle' ? start : () => { cleanup(); setStatus('idle'); setLevel(0); setPersonSeen(false); setSpillNote('') }}
        className="rounded-xl bg-white px-6 py-3 text-lg font-semibold text-black">
        {status === 'idle' ? 'Start camera and mic' : 'Stop'}
      </button>
      {poseError && <p role="alert" className="max-w-md text-center text-white">Camera / microphone: {poseError}. Audio continues if already connected.</p>}
      {status !== 'idle' && useSpill && mode !== '?' && mode !== 'wearer' && mode !== 'watch' && (
        <button onClick={() => api('/api/mode', { mode: 'wearer' })} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black">
          Spill alerts need Home mode (now {mode}). Switch to Home
        </button>
      )}
      <div className="h-3 w-64 rounded bg-black/40">
        <div className="h-3 rounded bg-white" style={{ width: `${Math.min(100, level * 400)}%` }} />
      </div>
      {useCamera && (
        <div className={`relative w-64 overflow-hidden rounded-lg bg-black ${status === 'idle' ? 'hidden' : ''}`}>
          {/* Local aiming view; laptop preview is a separate, explicit demo option. */}
          <video ref={videoRef} playsInline muted className="w-full opacity-60" />
          <canvas ref={canvasRef} width={640} height={480} className="absolute inset-0 h-full w-full" />
          <div className="absolute left-2 top-2 rounded bg-black/60 px-2 text-xs">
            {poseError ? 'Camera or pose unavailable' : !usePose ? '● camera on' : personSeen ? '● person tracked' : '○ no person'}
            {useSpill && spillNote ? ` · ${spillNote}` : ''}
          </div>
        </div>
      )}
    </div>
  )
}

function drawSkeleton(canvas, landmarks) {
  if (!canvas) return
  const g = canvas.getContext('2d')
  g.clearRect(0, 0, canvas.width, canvas.height)
  if (!landmarks) return
  g.strokeStyle = '#4ade80'
  g.lineWidth = 6
  for (const [a, b] of BONES) {
    g.beginPath()
    g.moveTo(landmarks[a][0] * canvas.width, landmarks[a][1] * canvas.height)
    g.lineTo(landmarks[b][0] * canvas.width, landmarks[b][1] * canvas.height)
    g.stroke()
  }
}
