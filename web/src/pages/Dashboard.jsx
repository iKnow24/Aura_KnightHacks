import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { api, useBrain } from '../lib/useBrain'
import { ALERT_TEXT, SEVERITY_COLOR, ZONES } from '../lib/zones'

const FAKES = [
  ['smoke_alarm', 'kitchen', 'critical'],
  ['doorbell', 'hallway', 'warning'],
  ['name_called', 'kitchen', 'warning'],
  ['fall', 'bedroom', 'critical'],
]

export default function Dashboard() {
  const [ripples, setRipples] = useState([])
  const { state, connected } = useBrain('dashboard', (alert) => {
    setRipples((r) => [...r, alert])
    setTimeout(() => setRipples((r) => r.filter((x) => x.id !== alert.id)), 4000)
  })
  const now = Date.now() / 1000

  return (
    <main className="grid min-h-full gap-4 p-4 lg:grid-cols-[1fr_360px]">
      <section>
        <header className="mb-3 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold">Lumen · Home</h1>
          <span className={`text-sm ${connected ? 'text-green-400' : 'text-red-400'}`}>
            ● {connected ? 'brain connected' : 'brain offline'}
          </span>
          <select
            className="ml-auto rounded bg-zinc-900 px-2 py-1"
            value={state.mode}
            onChange={(e) => api('/api/mode', { mode: e.target.value })}
          >
            {Object.entries(state.modes).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </header>

        {/* Floor plan. Skeletons and zone status only: no live video, for privacy. */}
        <div className="relative aspect-[16/10] rounded-2xl border border-zinc-800 bg-zinc-950">
          {Object.entries(ZONES).map(([id, z]) => {
            const node = Object.values(state.nodes).find((n) => n.zone === id)
            const alive = node && now - node.last_seen < 10
            return (
              <div key={id} className="absolute -translate-x-1/2 -translate-y-1/2 text-center" style={{ left: `${z.x}%`, top: `${z.y}%` }}>
                <div className="font-medium">{z.label}</div>
                <div className={`text-xs ${alive ? 'text-green-400' : 'text-zinc-600'}`}>{alive ? '● node live' : '○ no node'}</div>
              </div>
            )
          })}
          <AnimatePresence>
            {ripples.map((a) => {
              const z = ZONES[a.zone]
              if (!z) return null
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

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="self-center text-sm text-zinc-500">Fake alert:</span>
          {FAKES.map(([kind, zone, severity]) => (
            <button key={kind} onClick={() => api('/api/fake-alert', { kind, zone, severity })}
              className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700">
              {ALERT_TEXT[kind].icon} {ALERT_TEXT[kind].text} · {ZONES[zone].label}
            </button>
          ))}
        </div>
      </section>

      <aside className="rounded-2xl border border-zinc-800 p-4">
        <h2 className="mb-2 font-semibold">Timeline</h2>
        <ul className="space-y-2">
          {[...state.events].reverse().map((e) => (
            <li key={e.id} className="rounded-lg bg-zinc-900 p-2 text-sm" style={{ borderLeft: `4px solid ${SEVERITY_COLOR[e.severity]}` }}>
              <div>{ALERT_TEXT[e.kind]?.icon} {ALERT_TEXT[e.kind]?.text ?? e.kind} · {ZONES[e.zone]?.label ?? e.zone}</div>
              <div className="text-xs text-zinc-500">
                {new Date(e.ts * 1000).toLocaleTimeString()} · {e.source}{e.routed === false ? ' · logged only' : ''}
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </main>
  )
}
