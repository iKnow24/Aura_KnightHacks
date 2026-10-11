// Luma's voice. Kokoro is an open speech model (Apache-2.0) that runs in the browser.
// Nothing is sent anywhere, and there is no API key. We call this voice Luma.
// The weights download once from Hugging Face (about 90 MB) and then stay on the laptop.
// Heads up: the laptop mic can hear this voice and turn it into captions, so use headphones
// or switch it off when you are demoing live captions.

const KEY = 'lumen_voice'
const HELLO = "Hi. I'm Luma. Ask me what the house heard."
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
// Kokoro's top American voice (graded A). On screen she is just Luma.
export const LUMA_VOICE = 'af_heart'

const PREFERRED = [
  'Samantha',
  'Google US English',
  'Google UK English Female',
  'Karen',
  'Moira',
  'Tessa',
  'Microsoft Aria',
  'Microsoft Jenny',
]

let last = ''
let lastAt = 0
let picked = null
let held = null
let pulse = 0
let armed = false
let useKokoro = false
let modelPromise = null
let token = 0
let ctx = null
let source = null
let status = 'idle'
let progress = 0
const listeners = new Set()

const notify = () => { for (const fn of listeners) fn({ status, progress }) }
const setStatus = (next) => { status = next; notify() }

export const voiceSupported = () => typeof window !== 'undefined'
  && !!(window.AudioContext || window.webkitAudioContext || window.speechSynthesis)

export const voiceOn = () => {
  try { return localStorage.getItem(KEY) !== '0' } catch { return true }
}

export function onVoiceStatus(fn) {
  fn({ status, progress })
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const setVoice = (on) => {
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* private window */ }
  if (!on) stopTalking()
}

const english = (v) => /^en([-_]|$)/i.test(v?.lang || '') || /english/i.test(v?.name || '')

export function chooseVoice(list) {
  if (!list?.length) return null
  const pool = list.some(english) ? list.filter(english) : list
  for (const name of PREFERRED) {
    const hit = pool.find((v) => (v.name || '').includes(name))
    if (hit) return hit
  }
  return pool.find((v) => /female/i.test(v.name || '')) || pool[0]
}

function arm() {
  if (armed || !window.speechSynthesis) return
  armed = true
  const load = () => { picked = chooseVoice(window.speechSynthesis.getVoices()) }
  load()
  window.speechSynthesis.addEventListener?.('voiceschanged', load)
}

function watch(text) {
  clearInterval(pulse)
  if ((text || '').length < 180) return
  pulse = setInterval(() => {
    const s = window.speechSynthesis
    if (!s?.speaking) { clearInterval(pulse); return }
    s.pause()
    s.resume()
  }, 10000)
}

function utterance(text) {
  const u = new SpeechSynthesisUtterance(text)
  u.rate = 1.02
  u.pitch = 1
  const v = picked || chooseVoice(window.speechSynthesis.getVoices())
  if (v) { u.voice = v; u.lang = v.lang || 'en-US' }
  else u.lang = 'en-US'
  u.onend = () => { clearInterval(pulse); if (status === 'speaking') setStatus(useKokoro ? 'ready' : 'idle') }
  u.onerror = () => clearInterval(pulse)
  return u
}

// The laptop's built-in voice. Used on a phone (so it does not download the model)
// and if Luma's model cannot be fetched.
function speakBrowser(text) {
  if (!window.speechSynthesis) return false
  arm()
  const s = window.speechSynthesis
  if (s.paused) s.resume()
  const u = utterance(text)
  held = u
  watch(text)
  setStatus('speaking')
  if (s.speaking || s.pending) {
    s.cancel()
    setTimeout(() => { if (s.paused) s.resume(); held = u; s.speak(u) }, 60)
  } else {
    s.speak(u)
  }
  return true
}

function audioCtx() {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return null
  if (!ctx) ctx = new Ctx()
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

function cut() {
  try { source?.stop() } catch { /* already stopped */ }
  source = null
}

function stopTalking() {
  token += 1
  cut()
  clearInterval(pulse)
  try { window.speechSynthesis?.cancel() } catch { /* no voice engine */ }
  if (status === 'speaking') setStatus(modelPromise ? 'ready' : 'idle')
}

// Stop the current line. Used when someone taps the mic so Luma is not talking over them.
export function hush() {
  stopTalking()
}

// The small quantized model sometimes spits out a single wild sample. Swap those
// for the sample before them so the line does not click.
function calm(samples) {
  const out = new Float32Array(samples.length)
  let prev = 0
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    if (!Number.isFinite(s) || s > 1 || s < -1) out[i] = prev
    else { out[i] = s; prev = s }
  }
  return out
}

async function playRaw(raw) {
  const audio = audioCtx()
  const samples = raw?.audio
  if (!audio || !samples?.length) return Promise.resolve()
  if (audio.state !== 'running') audio.resume()
  const calmSamples = calm(samples)
  const rate = raw.sampling_rate || 24000
  const buffer = audio.createBuffer(1, calmSamples.length, rate)
  buffer.copyToChannel(calmSamples, 0)
  const src = audio.createBufferSource()
  src.buffer = buffer
  src.connect(audio.destination)
  source = src
  setStatus('speaking')
  src.start()
  const seconds = calmSamples.length / rate
  return new Promise((resolve) => {
    const done = () => resolve()
    src.onended = done
    // If the laptop blocked the sound, don't leave the button saying Speaking.
    setTimeout(done, (seconds + 0.4) * 1000)
  })
}

function pieces(text) {
  const parts = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text]
  return parts.map((s) => s.trim()).filter(Boolean).slice(0, 4)
}

function loadModel() {
  if (modelPromise) return modelPromise
  progress = 0
  setStatus('loading')
  modelPromise = (async () => {
    // Some machines advertise WebGPU but never start it, and Kokoro then waits forever.
    // Plain WebAssembly is the same voice and actually finishes.
    try { Object.defineProperty(navigator, 'gpu', { configurable: true, get: () => undefined }) } catch { /* already set */ }
    // The web build talks to Hugging Face. The node build is for scripts only.
    const { KokoroTTS } = await import('kokoro-js')
    const tts = await KokoroTTS.from_pretrained(MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p) => {
        if (p?.status === 'progress' && typeof p.progress === 'number') {
          progress = Math.max(progress, Math.round(p.progress))
          setStatus('loading')
        }
      },
    })
    if (status === 'loading') setStatus('ready')
    return tts
  })().catch((err) => {
    console.warn('Luma voice failed to load', err)
    modelPromise = null
    progress = 0
    setStatus('failed')
    throw err
  })
  return modelPromise
}

// Start the download before the first question. The dashboard and the headset both call this.
export function warmup() {
  if (typeof window === 'undefined') return
  useKokoro = true
  loadModel().catch(() => {})
}

async function speakKokoro(id, text) {
  let tts
  try {
    tts = await loadModel()
  } catch {
    if (id === token) speakBrowser(text)
    return
  }
  if (id !== token) return
  setStatus('speaking')
  try {
    let any = false
    for (const part of pieces(text)) {
      if (id !== token) return
      const audio = await tts.generate(part, { voice: LUMA_VOICE, speed: 1 })
      if (id !== token) return
      if (!audio?.audio?.length) continue
      any = true
      await playRaw(audio)
    }
    if (id !== token) return
    if (!any) speakBrowser(text)
    else if (status === 'speaking') setStatus('ready')
  } catch (err) {
    console.warn('Luma voice failed', err)
    if (id === token) speakBrowser(text)
  }
}

// Say a line. The same line is not repeated within 30 s, so a hazard that stays in view doesn't nag.
// force skips that guard (a tap on Hear Luma). ignoreSwitch is for a demo sound with the voice switch off.
export function say(text, { force = false, ignoreSwitch = false } = {}) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim()
  if (!voiceSupported() || !cleaned) return false
  if (!ignoreSwitch && !voiceOn()) return false
  const now = Date.now()
  if (!force && cleaned === last && now - lastAt < 30000) return false
  last = cleaned
  lastAt = now
  prime()
  const id = ++token
  cut()
  try { window.speechSynthesis?.cancel() } catch { /* no voice engine */ }
  if (useKokoro) speakKokoro(id, cleaned)
  else speakBrowser(cleaned)
  return true
}

// Call this inside a click, before any await, so the laptop is allowed to play sound later.
export function prime() {
  if (typeof window === 'undefined') return
  const audio = audioCtx()
  if (!audio) return
  // A silent blip inside the tap unlocks sound, so the real line can play
  // a few seconds later when the voice model finishes.
  const buffer = audio.createBuffer(1, 1, audio.sampleRate)
  const src = audio.createBufferSource()
  src.buffer = buffer
  src.connect(audio.destination)
  try { src.start() } catch { /* already unlocking */ }
}

export function greet() {
  return say(HELLO, { force: true })
}

export function speakNow(text) {
  return say(text, { force: true, ignoreSwitch: true })
}
