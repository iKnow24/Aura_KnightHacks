import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { api, useBrain } from '../lib/useBrain'
import AlertIcon from '../lib/AlertIcon'
import AskLumen from '../lib/AskLumen'
import Conversation, { useCaptions } from '../lib/Conversation'
import QrPanel from '../lib/QrPanel'
import { Wordmark } from '../lib/Logo'
import { getUser, signOut } from '../lib/user'
import { alertText, SEVERITY_COLOR, ZONES, zoneLabel } from '../lib/zones'

const FAKES = [
  ['smoke_alarm', 'kitchen', 'critical'],
  ['doorbell', 'hallway', 'warning'],
  ['name_called', 'kitchen', 'warning'],
  ['fall', 'bedroom', 'critical'],
  ['timer', 'kitchen', 'warning'],
  ['car_horn', 'wearer', 'critical'],
  ['person_behind', 'behind', 'warning'],
]

// Room outlines behind the zone labels, drawn in the same 0-100 space as ZONES x/y.
const ROOMS = [
  'M3 5 H38 V46 H3 Z', // kitchen
  'M66 5 H97 V46 H66 Z', // bedroom
  'M38 5 H66 V46 H97 V74 H3 V46 H38 Z', // living room
  'M30 74 H70 V96 H30 Z', // hallway
]
const FloorPlan = () => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
    {ROOMS.map((d) => <path key={d} d={d} fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />)}
  </svg>
)

export default function Dashboard() {
  const [ripples, setRipples] = useState([])
  const [showQr, setShowQr] = useState(false)
  const user = getUser()
  const captions = useCaptions()
  const { state, connected } = useBrain('dashboard', (alert) => {
    setRipples((r) => [...r, alert])
    setTimeout(() => setRipples((r) => r.filter((x) => x.id !== alert.id)), 4000)
  }, (msg) => msg.type === 'caption' && captions.add(msg))
  const now = Date.now() / 1000

  return (
    <main className="grid min-h-full grid-cols-1 gap-4 overflow-x-hidden p-4 lg:grid-cols-[1fr_360px]">
      <section className="min-w-0">
        <header className="mb-3 flex flex-wrap items-center gap-3">
          <h1 className="flex items-center gap-3"><Wordmark size={13} /><span className="text-sm text-zinc-500">{user?.household ?? 'Home'}</span></h1>
          <span className={`glass flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${connected ? 'text-emerald-300' : 'text-red-300'}`}>
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-500'}`} />
            {connected ? 'Brain connected' : 'Brain offline'}
          </span>
          <button onClick={() => setShowQr((v) => !v)} className="glass ml-auto rounded-full px-4 py-1.5 text-sm font-medium hover:border-white/20">
            {showQr ? 'Hide' : 'Add phones'}
          </button>
          <select
            className="glass rounded-full px-3 py-1.5 text-sm font-medium"
            value={state.mode}
            onChange={(e) => api('/api/mode', { mode: e.target.value })}
          >
            {Object.entries(state.modes).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <button onClick={() => { signOut(); location.href = '/' }} className="text-sm text-zinc-500 hover:text-zinc-300">
            {user?.name} · Sign out
          </button>
        </header>

        {showQr && <QrPanel />}

        {/* Floor plan. Skeletons and zone status only: no live video, for privacy. */}
        <div className="glass relative aspect-[4/3] overflow-hidden sm:aspect-[16/10] rounded-xl">
          <FloorPlan />
          {Object.entries(ZONES).filter(([, z]) => z.map !== false).map(([id, z]) => {
            const node = Object.values(state.nodes).find((n) => n.zone === id)
            const alive = node && now - node.last_seen < 10
            return (
              <div key={id} className="absolute -translate-x-1/2 -translate-y-1/2 text-center" style={{ left: `${z.x}%`, top: `${z.y}%` }}>
                <div className={`mx-auto mb-2 h-2 w-2 rounded-full ${alive ? 'bg-emerald-400' : 'border border-zinc-600'}`} />
                <div className="text-sm font-medium">{z.label}</div>
                <div className={`text-xs ${alive ? 'text-emerald-300' : 'text-zinc-500'}`}>{alive ? 'node live' : 'no node'}</div>
              </div>
            )
          })}
          <AnimatePresence>
            {ripples.map((a) => {
              const z = ZONES[a.zone]
              if (!z || z.map === false) return null
              return (
                <motion.div
                  key={a.id}
                  className="pointer-events-none absolute rounded-full border-4"
                  style={{ left: `${z.x}%`, top: `${z.y}%`, borderColor: SEVERITY_COLOR[a.severity], width: 40, height: 40, marginLeft: -20, marginTop: -20 }}
                  initial={{ scale: 0.5, opacity: 1 }}
                  animate={{ scale: 6, opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1.5, repeat: 2 }}
                />
              )
            })}
          </AnimatePresence>
        </div>

        <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          <span className="shrink-0 self-center text-xs uppercase tracking-[0.2em] text-zinc-500">Demo alerts</span>
          {FAKES.map(([kind, zone, severity]) => (
            <button key={kind} onClick={() => api('/api/fake-alert', { kind, zone, severity })}
              className="glass flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-sm hover:border-white/20">
              <AlertIcon kind={kind} className="text-amber-300" /> {alertText(kind).text} <span className="text-zinc-500">{zoneLabel(zone)}</span>
            </button>
          ))}
          <button onClick={() => api('/api/memory/seed', {}).then(captions.reload)} className="glass shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm hover:border-white/20">
            Seed demo memory
          </button>
        </div>

        <div className="mt-4"><AskLumen /></div>
      </section>

      <aside className="min-w-0 space-y-4">
        <Conversation lines={captions.lines} />
        <div className="glass rounded-xl p-4">
        <h2 className="mb-3 font-semibold">Timeline</h2>
        <ul className="space-y-2">
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
      </aside>
    </main>
  )
}
