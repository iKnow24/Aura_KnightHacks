import { Maximize2, X } from 'lucide-react'
import { Component, lazy, Suspense, useEffect, useRef, useState } from 'react'
import { api, useBrain } from '../lib/useBrain'
import AlertIcon from '../lib/AlertIcon'
import AskLumen from '../lib/AskLumen'
import { useCameraWall, useLaptopCameras } from '../lib/CameraWall'
import History from '../lib/History'
import Story from '../lib/Story'
import Conversation, { useCaptions } from '../lib/Conversation'
import { Wordmark } from '../lib/Logo'
import { getUser, signOut } from '../lib/user'
const Avatar3D = lazy(() => import('../lib/Avatar3D'))
const SoundField = lazy(() => import('../lib/SoundField'))
import QrPanel from '../lib/QrPanel'
import { playDemoSound } from '../lib/demoSounds'
import { alertText, SEVERITY_COLOR, zoneLabel } from '../lib/zones'

const FAKES = [
  ['smoke_alarm', 'living', 'critical'],
  ['doorbell', 'living', 'warning'],
  ['name_called', 'living', 'warning'],
  ['fall', 'living', 'critical'],
  ['timer', 'living', 'warning'],
  ['car_horn', 'wearer', 'critical'],
  ['person_behind', 'behind', 'warning'],
  ['vehicle_behind', 'behind', 'critical'],
  ['spill', 'kitchen', 'warning'],
]

export default function Dashboard() {
  const [ripples, setRipples] = useState([])
  const [tab, setTab] = useState('live')
  const [previews, setPreviews] = useState({})
  const [vision, setVision] = useState({})
  const [direction, setDirection] = useState(null)
  const user = getUser()
  const captions = useCaptions()
  const { state, connected } = useBrain('dashboard', (alert) => {
    setRipples((r) => [...r, alert])
    setTimeout(() => setRipples((r) => r.filter((x) => x.id !== alert.id)), 12000)
  }, (msg) => {
    // caption_voice is the brain saying whose voice a line already on screen was; it merges by ts.
    if (msg.type === 'caption' || msg.type === 'caption_voice') captions.add(msg)
    // The main camera tile puts lines over the speaker's head (TalkingHeads.jsx).
    if (msg.type === 'caption' || msg.type === 'caption_partial' || msg.type === 'caption_voice') {
      window.dispatchEvent(new CustomEvent('lumen:caption', { detail: msg }))
    }
    if (msg.type === 'vision') setVision((v) => ({ ...v, [msg.node_id]: msg }))
    if (msg.type === 'direction') setDirection(msg)
    if (msg.type === 'camera_preview') setPreviews((previous) => {
      const fresh = Object.fromEntries(Object.entries(previous).filter(([, p]) => Date.now() / 1000 - p.ts < 5))
      return { ...fresh, [msg.node_id]: msg }
    })
  })
  const [now, setNow] = useState(Date.now() / 1000)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 2000)
    return () => clearInterval(timer)
  }, [])
  const heardRisk = useRef(0)
  useEffect(() => {
    const hot = Object.values(vision).filter((v) => v.risk && v.risk.level !== 'low')
    const top = hot.sort((a, b) => b.risk.score - a.risk.score)[0]
    if (!top || top.risk.score <= heardRisk.current) {
      if (!top) heardRisk.current = 0
      return
    }
    heardRisk.current = top.risk.score
    const why = top.risk.why || ''
    const kind = /fire|smoke/.test(why) ? 'smoke_alarm' : /lying/.test(why) ? 'fall' : /drink|cup|bottle/.test(why) ? 'spill' : 'car_horn'
    playDemoSound(kind, user?.name)
  }, [vision, user?.name])
  const laptop = useLaptopCameras()
  const wall = useCameraWall({ nodes: state.nodes, previews, now, connected, cams: laptop.cams, camError: laptop.error,
    onAskCameras: () => laptop.refresh(true), alert: ripples.at(-1) })

  const header = (
    <header className="mb-3 flex flex-wrap items-center gap-3">
      <h1 className="flex items-center gap-3"><Wordmark size={13} /><span className="text-sm text-zinc-500">{user?.household ?? 'Home'}</span></h1>
      <span className={`glass flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${connected ? 'text-emerald-300' : 'text-red-300'}`}>
        <span className={`h-2 w-2 rounded-full ${connected ? 'live-dot bg-emerald-400' : 'bg-red-500'}`} />
        {connected ? 'Brain connected' : 'Brain offline'}
      </span>
      <div className="glass flex rounded-full p-0.5 text-sm font-medium">
        {[['live', 'Live'], ['history', 'History']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} aria-pressed={tab === id}
            className={`rounded-full px-3 py-1 transition-colors ${tab === id ? 'bg-zinc-100 text-ink' : 'text-zinc-400 hover:text-zinc-200'}`}>
            {label}
          </button>
        ))}
      </div>
      <select
        className="glass ml-auto rounded-full px-3 py-1.5 text-sm font-medium"
        value={state.mode}
        onChange={(e) => api('/api/mode', { mode: e.target.value })}
      >
        {Object.entries(state.modes).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      <button onClick={() => { signOut(); location.href = import.meta.env.BASE_URL }} className="text-sm text-zinc-500 hover:text-zinc-300">
        {user?.name} · Sign out
      </button>
    </header>
  )

  if (tab === 'history') {
    return (
      <main className="dashboard h-full overflow-y-auto overflow-x-hidden p-4">
        {header}
        <History />
      </main>
    )
  }

  // Control center: main camera in the middle, a camera on each side, the headset wearer in 3D
  // bottom left, and the 3D sound field bottom right.
  return (
    <main className="dashboard h-full overflow-y-auto overflow-x-hidden p-4">
      {header}
      <QrPanel />
      {wall.full}

      <Stage title="Cameras" context="Every camera in the house, including the headset captions view. Tap a name to make it the main picture. Press 1 or 2 to swap a side camera in.">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {wall.switcher}
        </div>
        <div className="grid gap-3 lg:h-[min(74vh,780px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,2.3fr)_minmax(0,1fr)] lg:grid-rows-2">
          <div className="min-h-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">{wall.center}</div>
          <div className="min-h-0 lg:col-start-1 lg:row-start-1">{wall.left}</div>
          <div className="min-h-0 lg:col-start-3 lg:row-start-1">{wall.right}</div>
          <Stage title="Headset figure" context="The person in the headset, drawn in 3D from a laptop camera pointed at them. The other cameras stay on the wall above." className="min-h-0 lg:col-start-1 lg:row-start-2" fill>
            <Suspense fallback={<div className="glass h-full min-h-[200px] rounded-xl" />}><Avatar3D cams={laptop.cams} direction={direction} /></Suspense>
          </Stage>
          <Stage title="Sound around them" context="Each live camera sits around the wearer. A sound shows up as a beam from the camera that heard it." className="min-h-0 lg:col-start-3 lg:row-start-2" fill>
            <div className="glass relative h-full min-h-[200px] overflow-hidden rounded-xl">
              <Suspense fallback={<div className="h-full min-h-[200px]" />}>
                <SoundField nodes={state.nodes} now={now} alerts={ripples} vision={vision} direction={direction} />
              </Suspense>
            </div>
          </Stage>
        </div>
      </Stage>

      {/* Scene JSON from each camera (server/app/detectors/scene.py): labels only, the photos are already gone. */}
      <section className="glass mt-4 rounded-xl p-4">
        <h2 className="mb-3 font-semibold">Risk from the scene JSON</h2>
        {Object.values(vision).filter((v) => now - v.ts < 15).length === 0 && (
          <p className="text-lg text-zinc-300">Waiting for a camera. Each photo becomes a JSON file with a risk number.</p>
        )}
        <ul className="space-y-3">
          {Object.values(vision).filter((v) => now - v.ts < 15).map((v) => (
            <li key={v.node_id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-4xl font-semibold tabular-nums">{v.risk?.score ?? 0}</span>
              <span className="text-lg font-semibold uppercase">{v.risk?.level ?? 'low'}</span>
              <span className="text-lg">{zoneLabel(v.zone)} · {v.change || v.risk?.why || v.summary}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        <span className="shrink-0 self-center text-xs uppercase tracking-[0.2em] text-zinc-500">Demo alerts</span>
        {FAKES.map(([kind, zone, severity]) => (
          <button key={kind} onClick={() => { playDemoSound(kind, user?.name); api('/api/fake-alert', { kind, zone, severity }) }}
            className="glass flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-sm hover:border-white/20">
            <AlertIcon kind={kind} className="text-amber-300" /> {alertText(kind).text} <span className="text-zinc-500">{zoneLabel(zone)}</span>
          </button>
        ))}
        <button onClick={() => api('/api/memory/seed', {}).then(captions.reload)} className="glass shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm hover:border-white/20">
          Seed demo memory
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Stage title="Ask Lumen" context="Ask what was said or which alerts happened. This chat only reads memory. It never decides that an alert should fire." fill>
          <AskLumen className="h-[460px]" />
        </Stage>
        <aside className="min-w-0 space-y-4">
          <Stage title="What was said" context="The live transcript from the house, the same words the headset is captioning." fill>
            <Conversation lines={captions.lines} />
          </Stage>
          <Stage title="Timeline" context="Alerts as they happen, with the time someone saw them." fill>
          <div className="glass rounded-xl p-4">
          <h2 className="mb-3 font-semibold">Timeline</h2>
          <ul className="max-h-[420px] space-y-2 overflow-y-auto">
            {state.events.length === 0 && <li className="text-sm text-zinc-500">Quiet so far. Alerts land here with the time someone saw them.</li>}
            {[...state.events].reverse().map((e) => (
              <li key={e.id} className="flex gap-3 rounded-lg bg-zinc-900 p-2.5 text-sm">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg" style={{ background: `${SEVERITY_COLOR[e.severity]}26`, color: SEVERITY_COLOR[e.severity] }}><AlertIcon kind={e.kind} /></span>
                <div className="min-w-0">
                <div className="font-medium">{alertText(e.kind).text} <span className="text-zinc-400">· {zoneLabel(e.zone)}</span></div>
                <div className="tabular text-xs text-zinc-500">
                  {new Date(e.ts * 1000).toLocaleTimeString()} · {e.source}{e.routed === false ? ' · logged only' : ''}
                  {e.acked && <span className="text-green-400"> · ✓ seen {new Date(e.acked.ts * 1000).toLocaleTimeString()}</span>}
                </div>
                </div>
              </li>
            ))}
          </ul>
          </div>
          </Stage>
        </aside>
      </div>

      <Guard><Story /></Guard>
    </main>
  )
}

class Guard extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (!this.state.error) return this.props.children
    return <p className="glass mt-8 rounded-xl p-4 text-sm text-zinc-300">The calendar could not be drawn. The live view above is still on.</p>
  }
}

// One feature, with a full-screen view for the pitch. The line under the title is what to say about it.
function Stage({ title, context, children, className = '', fill = false }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  const button = (
    <button type="button" onClick={() => setOpen((v) => !v)}
      className="glass shrink-0 rounded-full p-1.5 text-zinc-300 hover:border-white/20"
      aria-label={open ? `Close ${title}` : `Show ${title} full screen`} title={open ? 'Close' : 'Full screen'}>
      {open ? <X size={14} /> : <Maximize2 size={14} />}
    </button>
  )
  if (!open && fill) {
    return (
      <div className={`relative h-full ${className}`}>
        <div className="absolute right-2 top-2 z-20">{button}</div>
        {children}
      </div>
    )
  }
  return (
    <div className={open ? 'fixed inset-0 z-50 flex flex-col bg-ink p-4' : className}>
      <div className={`flex items-start gap-3 ${open ? 'mb-3' : 'mb-2'}`}>
        {open && (
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-sm text-zinc-400">{context}</p>
          </div>
        )}
        <div className="ml-auto">{button}</div>
      </div>
      <div className={open ? 'min-h-0 flex-1 overflow-auto' : ''}>{children}</div>
    </div>
  )
}
