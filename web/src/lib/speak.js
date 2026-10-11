// Luma's voice on the dashboard: the browser's built-in text to speech (nothing is sent anywhere).
// One switch for Ask Lumen answers and hazard notes, remembered in this browser.
// Heads up: the laptop mic can hear this voice and turn it into captions, so use headphones
// or switch it off when you are demoing live captions.

const KEY = 'lumen_voice'
let last = ''
let lastAt = 0

export const voiceSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window

export const voiceOn = () => {
  try { return localStorage.getItem(KEY) !== '0' } catch { return true }
}

export const setVoice = (on) => {
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* private window */ }
  if (!on && voiceSupported()) window.speechSynthesis.cancel()
}

// Say a line. The same line is not repeated within 30 s, so a hazard that stays in view doesn't nag.
export function say(text) {
  if (!voiceSupported() || !voiceOn() || !text) return
  const now = Date.now()
  if (text === last && now - lastAt < 30000) return
  last = text
  lastAt = now
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.rate = 1.02
  window.speechSynthesis.speak(u)
}
