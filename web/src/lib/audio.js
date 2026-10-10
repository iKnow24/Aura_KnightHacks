// Streams the phone mic to the brain as 16 kHz mono float32 chunks.
// cleanup=false turns off the browser's auto-gain and noise suppression: they distort loudness
// and can erase steady alarm beeps (room nodes). For speech near the wearer, cleanup helps.
export async function streamMic(send, onLevel, { cleanup = false } = {}) {
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: cleanup, noiseSuppression: cleanup, autoGainControl: cleanup },
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
    onLevel?.(Math.sqrt(sum / samples.length))
    send(new Float32Array(samples).buffer)
  }
  return () => { mic.getTracks().forEach((t) => t.stop()); ctx.close() }
}

// A node socket that reconnects on its own. Returns { send, close }.
export function nodeSocket(nodeId, zone, onStatus) {
  let ws, closed = false
  const connect = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/ws/node/${nodeId}?zone=${zone}`)
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => onStatus?.('streaming')
    ws.onclose = () => { if (closed) return; onStatus?.('reconnecting'); setTimeout(connect, 1000) }
  }
  connect()
  return {
    send: (data) => ws?.readyState === 1 && ws.send(data),
    close: () => { closed = true; ws?.close() },
  }
}
