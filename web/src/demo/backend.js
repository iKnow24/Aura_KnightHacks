// Demo mode: a fake brain that lives inside the page, for the hosted preview (GitHub Pages / Vercel).
// It replaces fetch('/api/...') and WebSocket('/ws/...') so every screen works with no server.
// Real detection (sound models, Whisper, OWLv2) still needs the brain on AMD or a laptop.
// Turned on by building with VITE_DEMO=1. In a normal build the whole file is dropped as dead code.
import { brainOrigin } from '../lib/brain'
import HISTORY from './history.json'

const now = () => Date.now() / 1000
const MODES = { watch: 'Watch (caregiver)', wearer: 'Home', lecture: 'Lecture', outside: 'Outside', night: 'Night' }

// A believable morning in the house, timestamps shifted so it always reads as "just now".
const MEMORY = [
  [-600, { type: 'sighting', zone: 'kitchen', item: 'wallet', confidence: 0.52 }],
  [-540, { type: 'speech', zone: 'living', text: "I'm heading out, back around six." }],
  [-480, { type: 'sighting', zone: 'hallway', item: 'keys', confidence: 0.38 }],
  [-400, { type: 'speech', zone: 'kitchen', text: 'Can you grab milk on the way home?' }],
  [-720, { type: 'sighting', zone: 'living', item: 'keys', confidence: 0.47 }],
  [-300, { type: 'sighting', zone: 'bedroom', item: 'glasses', confidence: 0.44 }],
  [-200, { type: 'speech', zone: 'wearer', text: 'Your appointment with Dr. Patel moved to Thursday at 2.', speaker: 1, to_you: true }],
  [-140, { type: 'speech', zone: 'wearer', text: 'Did you take the blue pill this morning?', speaker: 2, to_you: true }],
  [-60, { type: 'speech', zone: 'kitchen', text: "Dinner's ready, come eat!" }],
].map(([dt, e]) => ({ ...e, ts: now() + dt }))

const RECAP = {
  title: 'Lecture',
  summary: 'Photosynthesis turns light energy into chemical energy that the plant stores as glucose. Chlorophyll reflects green light, which is why leaves look green. The plant later uses that glucose for energy and growth.',
  points: [
    'Today we are covering photosynthesis and how plants make their own food.',
    'Chlorophyll reflects green light, which is exactly why leaves look green to us.',
    'Photosynthesis turns light energy into chemical energy that the plant stores as glucose.',
    'The plant takes in carbon dioxide and water, and releases oxygen as a byproduct.',
  ],
  map: {
    center: 'Lecture',
    branches: [
      { label: 'Photosynthesis', ts: now() - 300, details: ['Light energy becomes chemical energy stored as glucose.'] },
      { label: 'Light', ts: now() - 240, details: ['Chlorophyll reflects green light, so leaves look green.'] },
      { label: 'Glucose', ts: now() - 120, details: ['The plant uses glucose for energy and growth.'] },
    ],
  },
  quiz: [
    { q: 'Fill in the blank: Chlorophyll reflects green _____.', choices: ['energy', 'light', 'plant', 'glucose'], answer: 1 },
    { q: 'Fill in the blank: The plant releases _____ as a byproduct.', choices: ['glucose', 'oxygen', 'water', 'light'], answer: 1 },
  ],
  people: [],
  brain: 'rules',
}

const state = {
  mode: 'night',
  modes: { ...MODES },
  nodes: Object.fromEntries(['kitchen', 'bedroom', 'living', 'hallway'].map((z) => [z, { zone: z, last_seen: now() }])),
  events: [],
  memory: MEMORY,
}

const sockets = new Set()
const snapshot = () => ({ type: 'state', mode: state.mode, modes: state.modes, nodes: state.nodes, events: state.events })
const broadcast = (msg, roles) => sockets.forEach((s) => (!roles || roles.includes(s.role)) && s._recv(msg))

class FakeSocket {
  constructor(url) {
    this.readyState = 0
    this.role = String(url).match(/\/ws\/([a-z]+)/)?.[1] ?? 'node'
    sockets.add(this)
    setTimeout(() => { this.readyState = 1; this.onopen?.(); this._recv(snapshot()) }, 150)
  }
  _recv(msg) { if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(msg) }) }
  send() {}
  close() { this.readyState = 3; sockets.delete(this); this.onclose?.() }
}

function alert(kind, zone, severity = 'warning') {
  const a = { type: 'alert', id: `${Date.now()}`, kind, zone, severity, source: 'demo', confidence: 0.94, ts: now() }
  state.events = [...state.events, a].slice(-50)
  broadcast(a)
}

function caption(text, zone = 'kitchen') {
  const s = { type: 'speech', zone, text, ts: now() }
  state.memory.push(s)
  broadcast({ ...s, type: 'caption', id: `${s.ts}-${zone}` }, ['dashboard', 'hud'])
}

function answer(question) {
  const q = question.toLowerCase()
  const find = (pred) => [...state.memory].reverse().find(pred)
  if (/key|wallet|glass|phone/.test(q)) {
    const item = ['keys', 'wallet', 'glasses', 'phone'].find((i) => q.includes(i.replace(/s$/, ''))) ?? 'keys'
    const seen = find((e) => e.type === 'sighting' && e.item === item)
    if (seen) {
      const mins = Math.max(1, Math.round((now() - seen.ts) / 60))
      return { answer: `Your ${item} were last seen in the ${seen.zone}, ${mins} minutes ago.`, evidence: [seen], brain: 'rules' }
    }
  }
  if (/alert|alarm|door|happen/.test(q) && state.events.length) {
    const last = state.events.at(-1)
    return { answer: `${state.events.length} alert(s). Latest: ${last.kind.replace('_', ' ')} in the ${last.zone}.`, evidence: state.events.slice(-3), brain: 'rules' }
  }
  const said = state.memory.filter((e) => e.type === 'speech').slice(-3).reverse()
  return { answer: `“${said[0].text}”, in the ${said[0].zone}, just now.`, evidence: said, brain: 'rules' }
}

const routes = {
  'POST /api/fake-alert': (b) => (alert(b.kind, b.zone, b.severity), { ok: true }),
  'POST /api/fake-caption': (b) => (caption(b.text, b.zone), { ok: true }),
  'POST /api/ack': (b) => {
    const ack = { type: 'ack', id: b.id, by: b.by ?? 'demo', ts: now() }
    state.events = state.events.map((e) => (e.id === b.id ? { ...e, acked: { ts: ack.ts, by: ack.by } } : e))
    broadcast(ack)
    return ack
  },
  'POST /api/mode': (b) => ((state.mode = b.mode), broadcast(snapshot()), { mode: b.mode }),
  'POST /api/modes': (b) => {
    const key = (b.description || 'custom').toLowerCase().replace(/[^a-z]+/g, '_').slice(0, 16)
    state.modes[key] = b.description
    state.mode = key
    broadcast(snapshot())
    return { key, label: b.description, sound_kinds: ['smoke_alarm', 'doorbell', 'name_called'] }
  },
  'POST /api/recap': () => RECAP,
  'POST /api/ask': (b) => answer(b.question ?? ''),
  'POST /api/memory/seed': () => ({ entries: state.memory.length }),
  'GET /api/memory': () => ({ entries: state.memory, models: { whisper: 'off', items: 'ready', llm: 'ready' } }),
  'DELETE /api/memory': () => ((state.memory = []), { ok: true }),
  'GET /api/state': () => snapshot(),
  'GET /api/health': () => ({ ok: true, mode: state.mode, demo: true }),
  'GET /api/history': () => HISTORY,
  'POST /api/profile': () => ({ ok: true }),
  'POST /api/speech': () => ({ ok: true }),
  'POST /api/speech/tag': () => ({ ok: true }),
}

// ?brain=<address> means there's a real brain to talk to, so the fake one stays out of the way.
if (import.meta.env.VITE_DEMO && !brainOrigin()) {
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : input.url
    if (!raw.includes('/api/')) return realFetch(input, init)
    const path = new URL(raw, location.href).pathname.replace(/^.*(\/api\/)/, '$1')
    const handler = routes[`${(init.method || 'GET').toUpperCase()} ${path}`]
    let body = {}
    try { body = init.body ? JSON.parse(init.body) : {} } catch { /* not JSON: ignore */ }
    await new Promise((r) => setTimeout(r, path === '/api/recap' ? 900 : 200))
    if (!handler) return new Response(JSON.stringify({ detail: 'not in demo' }), { status: 404 })
    return new Response(JSON.stringify(handler(body)), { headers: { 'Content-Type': 'application/json' } })
  }
  window.WebSocket = FakeSocket
  window.lumenDemo = { alert, caption }
}
