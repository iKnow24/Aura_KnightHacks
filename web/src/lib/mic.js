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
  // iPhones can ignore the 16 kHz request and record at 48 kHz. The brain expects 16 kHz,
  // so average down if needed (otherwise Whisper hears everyone at triple speed).
  const ratio = ctx.sampleRate / 16000
  const resample = (x) => {
    if (ratio === 1) return x
    const out = new Float32Array(Math.floor(x.length / ratio))
    for (let i = 0; i < out.length; i++) {
      let sum = 0, n = 0
      for (let j = Math.floor(i * ratio); j < Math.floor((i + 1) * ratio); j++) { sum += x[j]; n++ }
      out[i] = sum / n
    }
    return out
  }
  proc.onaudioprocess = (e) => {
    const samples = resample(e.inputBuffer.getChannelData(0))
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

// Records `seconds` of this device's mic as 16 kHz mono float32 (for the Voices page).
// onLevel gets the loudness while recording; returns the samples as base64.
export async function recordClip(seconds, onLevel) {
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  })
  const ctx = new AudioContext({ sampleRate: 16000 })
  const src = ctx.createMediaStreamSource(mic)
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  const ratio = ctx.sampleRate / 16000
  const chunks = []
  src.connect(proc)
  proc.connect(ctx.destination)
  proc.onaudioprocess = (e) => {
    const x = e.inputBuffer.getChannelData(0)
    const out = new Float32Array(Math.floor(x.length / ratio))
    let sum = 0
    for (let i = 0; i < out.length; i++) { out[i] = x[Math.floor(i * ratio)]; sum += out[i] * out[i] }
    chunks.push(out)
    onLevel?.(Math.sqrt(sum / out.length))
  }
  await new Promise((r) => setTimeout(r, seconds * 1000))
  proc.disconnect()
  mic.getTracks().forEach((t) => t.stop())
  ctx.close()
  const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of chunks) { all.set(c, at); at += c.length }
  const bytes = new Uint8Array(all.buffer)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
