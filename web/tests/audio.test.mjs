import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nodeSocket, streamMic } from '../src/lib/audio.js'

test('48 kHz phone audio reaches the brain at 16 kHz and Stop releases the mic', async () => {
  let stopped = false, closed = false
  const processor = { connect() {}, disconnect() {} }
  const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const contextBefore = globalThis.AudioContext
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped = true } }] }) },
  } })
  globalThis.AudioContext = class {
    sampleRate = 48000
    resume() { return Promise.resolve() }
    createMediaStreamSource() { return { connect() {}, disconnect() {} } }
    createScriptProcessor() { return processor }
    close() { closed = true }
  }
  try {
    let sent
    const stop = await streamMic((data) => { sent = new Float32Array(data) })
    processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array([1, 2, 3, 4, 5, 6]) } })
    assert.deepEqual([...sent], [2, 5])
    stop()
    assert.equal(stopped, true)
    assert.equal(closed, true)
    assert.equal(processor.onaudioprocess, null)
  } finally {
    if (navigatorBefore) Object.defineProperty(globalThis, 'navigator', navigatorBefore)
    else delete globalThis.navigator
    globalThis.AudioContext = contextBefore
  }
})

test('closing a disconnected node cancels retry and cannot reopen its socket', () => {
  const originals = Object.fromEntries(['WebSocket', 'location', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'].map((k) => [k, globalThis[k]]))
  const sockets = []
  let retry, cancelled = false
  globalThis.location = { protocol: 'https:', host: 'demo.example' }
  globalThis.WebSocket = class {
    readyState = 0
    constructor(url) { this.url = url; sockets.push(this) }
    close() { this.onclose?.() }
  }
  globalThis.setTimeout = (callback) => { retry = callback; return 123 }
  globalThis.clearTimeout = (id) => { if (id === 123) cancelled = true }
  globalThis.setInterval = () => 456
  globalThis.clearInterval = () => {}
  try {
    const socket = nodeSocket('phone 1', 'living room')
    assert.match(sockets[0].url, /phone%201\?zone=living%20room$/)
    sockets[0].onclose()
    socket.close()
    assert.equal(cancelled, true)
    retry() // Even an already queued retry must not revive a stopped phone.
    assert.equal(sockets.length, 1)
  } finally {
    Object.assign(globalThis, originals)
  }
})
