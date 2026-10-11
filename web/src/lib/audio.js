// Streams the phone mic to the brain as 16 kHz mono float32 chunks.
// cleanup=false turns off the browser's auto-gain and noise suppression: they distort loudness
// and can erase steady alarm beeps (room nodes). For speech near the wearer, cleanup helps.
export async function streamMic(send, onLevel, { cleanup = false } = {}) {
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: cleanup, noiseSuppression: cleanup, autoGainControl: cleanup },
  })
  const ctx = new AudioContext({ sampleRate: 16000 })
  try { await ctx.resume() } catch (error) {
    mic.getTracks().forEach((t) => t.stop())
    ctx.close()
    throw error
  }
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
    // Some phones ignore the requested sample rate. The brain always expects 16 kHz.
    const ratio = ctx.sampleRate / 16000
    const out = new Float32Array(Math.floor(samples.length / ratio))
    for (let i = 0; i < out.length; i++) {
      let sum = 0, count = 0
      for (let j = Math.floor(i * ratio); j < Math.floor((i + 1) * ratio); j++) { sum += samples[j]; count++ }
      out[i] = sum / count
    }
    send(out.buffer)
  }
  return () => { proc.onaudioprocess = null; proc.disconnect(); src.disconnect(); mic.getTracks().forEach((t) => t.stop()); ctx.close() }
}

// A node socket that reconnects on its own. Returns { send, close }.
export function nodeSocket(nodeId, zone, onStatus, onMessage) {
  let ws, retry, heartbeat, closed = false
  const connect = () => {
    if (closed) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/ws/node/${encodeURIComponent(nodeId)}?zone=${encodeURIComponent(zone)}`)
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
      onStatus?.('streaming')
      heartbeat = setInterval(() => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'heartbeat' }))
      }, 3000)
    }
    ws.onmessage = (e) => { try { onMessage?.(JSON.parse(e.data)) } catch { /* not json */ } }
    ws.onclose = () => {
      clearInterval(heartbeat)
      if (closed) return
      onStatus?.('reconnecting')
      retry = setTimeout(connect, 1000)
    }
  }
  connect()
  return {
    send: (data) => ws?.readyState === 1 && ws.send(data),
    close: () => { closed = true; clearTimeout(retry); clearInterval(heartbeat); ws?.close() },
  }
}
