// Luma's voice: the browser's built-in text to speech. Nothing is sent anywhere, and no API key is needed.
// One switch for Ask Lumen answers and hazard notes, remembered in this browser.
// Heads up: the laptop mic can hear this voice and turn it into captions, so use headphones
// or switch it off when you are demoing live captions.

const KEY = 'lumen_voice'
const HELLO = "Hi. I'm Luma. Ask me what the house heard."

// Mac and Chrome ship these. First match wins, so a demo laptop gets a steady English voice
// instead of whichever voice the browser lists first.
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

export const voiceSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window

export const voiceOn = () => {
  try { return localStorage.getItem(KEY) !== '0' } catch { return true }
}

export const setVoice = (on) => {
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* private window */ }
  if (!on && voiceSupported()) window.speechSynthesis.cancel()
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
  if (armed || !voiceSupported()) return
  armed = true
  const load = () => { picked = chooseVoice(window.speechSynthesis.getVoices()) }
  load()
  window.speechSynthesis.addEventListener?.('voiceschanged', load)
}

// Chrome pauses a long line around 15 seconds and never resumes it.
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
  u.onend = () => clearInterval(pulse)
  u.onerror = () => clearInterval(pulse)
  return u
}

// Speak now. Pass force to skip the 30s repeat guard (a tap on Hear Luma).
// Pass ignoreSwitch for demo sounds that should play even when Luma's voice is off.
// Returns false when there is nothing to say.
export function say(text, { force = false, ignoreSwitch = false } = {}) {
  if (!voiceSupported() || !text) return false
  if (!ignoreSwitch && !voiceOn()) return false
  const now = Date.now()
  if (!force && text === last && now - lastAt < 30000) return false
  last = text
  lastAt = now
  arm()
  const s = window.speechSynthesis
  if (s.paused) s.resume()
  const u = utterance(text)
  held = u // Chrome drops the line if nothing keeps the utterance alive.
  watch(text)
  // cancel() then speak() in the same turn is ignored. A fresh line can start immediately,
  // which is what a click needs. Replacing a line that is already playing waits one beat.
  if (s.speaking || s.pending) {
    s.cancel()
    setTimeout(() => {
      if (s.paused) s.resume()
      held = u
      s.speak(u)
    }, 60)
  } else {
    s.speak(u)
  }
  return true
}

// Call this inside a click, before any await. Chrome only allows speech that follows a tap,
// and an answer that arrives later counts once this page has spoken once.
export function prime() {
  if (!voiceSupported() || !voiceOn()) return
  const s = window.speechSynthesis
  if (s.speaking || s.pending) return
  arm()
  const u = new SpeechSynthesisUtterance(' ')
  u.volume = 0
  held = u
  s.speak(u)
}

export function greet() {
  return say(HELLO, { force: true })
}

export function speakNow(text) {
  return say(text, { force: true, ignoreSwitch: true })
}
