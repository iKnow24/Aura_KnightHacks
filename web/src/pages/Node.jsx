import { useEffect, useRef, useState } from 'react'
import { keepAwake } from '../lib/useBrain'
import { BONES, detectPose, loadPose } from '../lib/pose'

// A spare phone in a room. Streams 16 kHz mono audio and, unless ?pose=0, body keypoints
// at 10 fps for fall detection. Video never leaves the phone.
// Browser audio "cleanup" is turned off on purpose: auto-gain and noise suppression
// distort loudness and can erase steady alarm beeps.
// Mount the phone high (about 1.8 m) and angled down so a person on the floor stays in frame.

const POSE_FPS = 10

export default function Node() {
  const params = new URLSearchParams(location.search)
  const zone = params.get('zone') || 'living'
  const nodeId = params.get('id') || `${zone}-${Math.random().toString(36).slice(2, 6)}`
  const usePose = params.get('pose') !== '0'
  const [status, setStatus] = useState('idle')
  const [level, setLevel] = useState(0)
  const [personSeen, setPersonSeen] = useState(false)
  const [poseError, setPoseError] = useState(null)
  const wsRef = useRef()
  const videoRef = useRef()
  const canvasRef = useRef()
  const timers = useRef([])

  useEffect(() => () => timers.current.forEach(clearInterval), [])

  const send = (data) => wsRef.current?.readyState === 1 && wsRef.current.send(data)

  const startAudio = async () => {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
    const ctx = new AudioContext({ sampleRate: 16000 })
    const src = ctx.createMediaStreamSource(mic)
    // ScriptProcessor is deprecated but works everywhere with zero setup. Fine for a hackathon.
    const proc = ctx.createScriptProcessor(4096, 1, 1)
    src.connect(proc)
    proc.connect(ctx.destination)
    proc.onaudioprocess = (e) => {
      const samples = e.inputBuffer.getChannelData(0)
      let sum = 0
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
      setLevel(Math.sqrt(sum / samples.length))
      send(new Float32Array(samples).buffer)
    }
  }

  const startPose = async () => {
    try {
      const cam = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 640, height: 480 },
      })
      videoRef.current.srcObject = cam
      await videoRef.current.play()
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

  const start = async () => {
    await keepAwake()
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/ws/node/${nodeId}?zone=${zone}`)
      ws.binaryType = 'arraybuffer'
      ws.onopen = () => setStatus('streaming')
      ws.onclose = () => { setStatus('reconnecting'); setTimeout(connect, 1000) }
      wsRef.current = ws
    }
    connect()
    await startAudio()
    if (usePose) await startPose()
  }

  const color = status === 'streaming' ? 'bg-green-700' : status === 'idle' ? 'bg-zinc-800' : 'bg-amber-600'
  return (
    <div onClick={status === 'idle' ? start : undefined} className={`flex h-full w-full flex-col items-center justify-center gap-4 p-4 ${color}`}>
      <div className="text-4xl font-bold">{zone}</div>
      <div className="text-xl">{status === 'idle' ? 'Tap to start' : status}</div>
      <div className="h-3 w-64 rounded bg-black/40">
        <div className="h-3 rounded bg-white" style={{ width: `${Math.min(100, level * 400)}%` }} />
      </div>
      {usePose && (
        <div className={`relative w-64 overflow-hidden rounded-lg bg-black ${status === 'idle' ? 'hidden' : ''}`}>
          {/* Preview only, to aim the camera. It is never sent anywhere. */}
          <video ref={videoRef} playsInline muted className="w-full opacity-60" />
          <canvas ref={canvasRef} width={640} height={480} className="absolute inset-0 h-full w-full" />
          <div className="absolute left-2 top-2 rounded bg-black/60 px-2 text-xs">
            {poseError ? `pose off: ${poseError}` : personSeen ? '● person tracked' : '○ no person'}
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
