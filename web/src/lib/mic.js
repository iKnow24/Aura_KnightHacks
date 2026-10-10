// Streams this phone's mic to the brain as a node (16 kHz mono float32), same format as Node.jsx.
// The brain runs Whisper (captions that never leave our own server) and the sound detectors
// (car horns, sirens) on it. Returns a stop() function.
const wsUrl = (path) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`

export async function streamMic(zone = 'wearer', onLevel) {
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  })
  const ctx = new AudioContext({ sampleRate: 16000 })
  const src = ctx.createMediaStreamSource(mic)
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  let ws, closed = false
  const open = () => {
    ws = new WebSocket(wsUrl(`/ws/node/${zone}-${Math.random().toString(36).slice(2, 6)}?zone=${zone}`))
    ws.onclose = () => { if (!closed) setTimeout(open, 1000) }
  }
  open()
  src.connect(proc)
  proc.connect(ctx.destination)
  proc.onaudioprocess = (e) => {
    const samples = e.inputBuffer.getChannelData(0)
    if (onLevel) {
      let sum = 0
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
      onLevel(Math.sqrt(sum / samples.length))
    }
    if (ws.readyState === 1) ws.send(new Float32Array(samples).buffer)
  }
  return () => {
    closed = true
    ws.close()
    proc.disconnect()
    mic.getTracks().forEach((t) => t.stop())
    ctx.close()
  }
}
