import { useEffect, useRef, useState } from 'react'
import { nodeSocket, streamMic } from '../lib/audio'
import { keepAwake } from '../lib/useBrain'
import { BONES, detectPose, loadPose } from '../lib/pose'

// A spare phone in a room. Streams 16 kHz mono audio and, unless ?pose=0, body keypoints
// at 10 fps for fall detection. Unless ?items=0, it also sends one small still photo every
// SNAPSHOT_S seconds so the brain can remember where keys, wallet, glasses were last seen.
// Live video never leaves the phone; the brain keeps only a crop of each item it finds.
// Mount the phone high (about 1.8 m) and angled down so a person on the floor stays in frame.

const POSE_FPS = 10
const SNAPSHOT_S = 5

export default function Node() {
  const params = new URLSearchParams(location.search)
  const zone = params.get('zone') || 'living'
  const nodeId = params.get('id') || `${zone}-${Math.random().toString(36).slice(2, 6)}`
  const usePose = params.get('pose') !== '0'
  const useItems = params.get('items') !== '0'
  const useCamera = usePose || useItems
  const [status, setStatus] = useState('idle')
  const [level, setLevel] = useState(0)
  const [personSeen, setPersonSeen] = useState(false)
  const [poseError, setPoseError] = useState(null)
  const wsRef = useRef()
  const videoRef = useRef()
  const canvasRef = useRef()
  const timers = useRef([])

  useEffect(() => () => timers.current.forEach(clearInterval), [])

  const send = (data) => wsRef.current?.send(data)

  const startCamera = async () => {
    try {
      const cam = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 640, height: 480 },
      })
      videoRef.current.srcObject = cam
      await videoRef.current.play()
      if (useItems) timers.current.push(setInterval(sendSnapshot, SNAPSHOT_S * 1000))
      if (!usePose) return
      await loadPose()
      timers.current.push(setInterval(() => {
        const now = performance.now()
        const landmarks = detectPose(videoRef.current, now)
        setPersonSeen(!!landmarks)
        drawSkeleton(canvasRef.current, landmarks)
        send(JSON.stringify({ type: 'pose', ts: Date.now() / 1000, landmarks }))
      }, 1000 / POSE_FPS))
    } catch (e) {
      setPoseError(e.message || String(e))
    }
  }

  const sendSnapshot = () => {
    const v = videoRef.current
    if (!v?.videoWidth) return
    const c = document.createElement('canvas')
    c.width = 640
    c.height = Math.round((640 * v.videoHeight) / v.videoWidth)
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
    send(JSON.stringify({ type: 'snapshot', ts: Date.now() / 1000, jpeg: c.toDataURL('image/jpeg', 0.7) }))
  }

  const start = async () => {
    await keepAwake()
    wsRef.current = nodeSocket(nodeId, zone, setStatus)
    await streamMic(send, setLevel)
    if (useCamera) await startCamera()
  }

  const color = status === 'streaming' ? 'bg-green-700' : status === 'idle' ? 'bg-zinc-800' : 'bg-amber-600'
  return (
    <div onClick={status === 'idle' ? start : undefined} className={`flex h-full w-full flex-col items-center justify-center gap-4 p-4 ${color}`}>
      <div className="text-4xl font-bold">{zone}</div>
      <div className="text-xl">{status === 'idle' ? 'Tap to start' : status}</div>
      <div className="h-3 w-64 rounded bg-black/40">
        <div className="h-3 rounded bg-white" style={{ width: `${Math.min(100, level * 400)}%` }} />
      </div>
      {useCamera && (
        <div className={`relative w-64 overflow-hidden rounded-lg bg-black ${status === 'idle' ? 'hidden' : ''}`}>
          {/* Preview to aim the camera. Only a still every few seconds is sent, for item memory. */}
          <video ref={videoRef} playsInline muted className="w-full opacity-60" />
          <canvas ref={canvasRef} width={640} height={480} className="absolute inset-0 h-full w-full" />
          <div className="absolute left-2 top-2 rounded bg-black/60 px-2 text-xs">
            {poseError ? `camera off: ${poseError}` : !usePose ? '● watching for items' : personSeen ? '● person tracked' : '○ no person'}
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
