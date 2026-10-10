import { useRef, useState } from 'react'
import { keepAwake } from '../lib/useBrain'

// A spare phone in a room. Streams 16 kHz mono audio to the brain.
// Browser audio "cleanup" is turned off on purpose: auto-gain and noise suppression
// distort loudness and can erase steady alarm beeps.
// TODO(vision): MediaPipe pose here, send keypoints (not video) as JSON for fall detection.

export default function Node() {
  const params = new URLSearchParams(location.search)
  const zone = params.get('zone') || 'living'
  const nodeId = params.get('id') || `${zone}-${Math.random().toString(36).slice(2, 6)}`
  const [status, setStatus] = useState('idle')
  const [level, setLevel] = useState(0)
  const wsRef = useRef()

  const start = async () => {
    await keepAwake()
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
    const ctx = new AudioContext({ sampleRate: 16000 })
    const src = ctx.createMediaStreamSource(mic)
    // ScriptProcessor is deprecated but works everywhere with zero setup. Fine for a hackathon.
    const proc = ctx.createScriptProcessor(4096, 1, 1)
    src.connect(proc)
    proc.connect(ctx.destination)

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/ws/node/${nodeId}?zone=${zone}`)
      ws.binaryType = 'arraybuffer'
      ws.onopen = () => setStatus('streaming')
      ws.onclose = () => { setStatus('reconnecting'); setTimeout(connect, 1000) }
      wsRef.current = ws
    }
    connect()

    proc.onaudioprocess = (e) => {
      const samples = e.inputBuffer.getChannelData(0)
      let sum = 0
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
      setLevel(Math.sqrt(sum / samples.length))
      if (wsRef.current?.readyState === 1) wsRef.current.send(new Float32Array(samples).buffer)
    }
  }

  const color = status === 'streaming' ? 'bg-green-600' : status === 'idle' ? 'bg-zinc-800' : 'bg-amber-600'
  return (
    <button onClick={status === 'idle' ? start : undefined} className={`grid h-full w-full place-items-center ${color}`}>
      <div className="text-center">
        <div className="text-4xl font-bold">{zone}</div>
        <div className="mt-2 text-xl">{status === 'idle' ? 'Tap to start listening' : status}</div>
        <div className="mx-auto mt-6 h-3 w-64 rounded bg-black/40">
          <div className="h-3 rounded bg-white" style={{ width: `${Math.min(100, level * 400)}%` }} />
        </div>
      </div>
    </button>
  )
}
