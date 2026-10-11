// Sounds for the dashboard's Demo alerts buttons. The click still sends the real alert
// to every screen. This only plays a short noise from the laptop so the room hears it too.
// Made with the browser's tone generator. No sound files.

let ctx

function audio() {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

function tone(freq, start, dur, { type = 'sine', gain = 0.18 } = {}) {
  const c = audio()
  const osc = c.createOscillator()
  const amp = c.createGain()
  osc.type = type
  osc.frequency.value = freq
  const t = c.currentTime + start
  amp.gain.setValueAtTime(0.0001, t)
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.02)
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(amp).connect(c.destination)
  osc.start(t)
  osc.stop(t + dur + 0.05)
}

function noise(start, dur, { gain = 0.25, freq = 400 } = {}) {
  const c = audio()
  const samples = Math.max(1, Math.floor(c.sampleRate * dur))
  const buffer = c.createBuffer(1, samples, c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = buffer
  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = freq
  const amp = c.createGain()
  const t = c.currentTime + start
  amp.gain.setValueAtTime(gain, t)
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(filter).connect(amp).connect(c.destination)
  src.start(t)
}

const PLAY = {
  smoke_alarm: () => {
    // Three beeps, the pattern a smoke alarm uses.
    for (let i = 0; i < 3; i++) tone(3100, i * 0.7, 0.4, { type: 'square', gain: 0.08 })
  },
  doorbell: () => {
    tone(880, 0, 0.35, { gain: 0.2 })
    tone(660, 0.4, 0.55, { gain: 0.2 })
  },
  name_called: (name) => {
    const line = new SpeechSynthesisUtterance(name ? `${name}` : 'Hey')
    line.rate = 1
    window.speechSynthesis?.cancel()
    window.speechSynthesis?.speak(line)
  },
  fall: () => noise(0, 0.35, { gain: 0.45, freq: 180 }),
  timer: () => {
    for (let i = 0; i < 4; i++) tone(1800, i * 0.28, 0.12, { type: 'square', gain: 0.08 })
  },
  car_horn: () => {
    tone(420, 0, 0.35, { type: 'sawtooth', gain: 0.12 })
    tone(440, 0.45, 0.4, { type: 'sawtooth', gain: 0.12 })
  },
  person_behind: () => {
    for (let i = 0; i < 4; i++) noise(i * 0.38, 0.12, { gain: 0.4, freq: 220 })
  },
  vehicle_behind: () => {
    noise(0, 1.1, { gain: 0.3, freq: 140 })
    tone(180, 0.1, 0.9, { type: 'sawtooth', gain: 0.06 })
  },
  spill: () => noise(0, 0.25, { gain: 0.35, freq: 2400 }),
}

export function playDemoSound(kind, name) {
  try {
    ;(PLAY[kind] ?? (() => tone(880, 0, 0.2)))(name)
  } catch {
    // A blocked speaker should still let the alert go out.
  }
}
