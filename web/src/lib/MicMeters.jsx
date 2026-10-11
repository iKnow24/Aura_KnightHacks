import { Ear } from 'lucide-react'
import { micName } from './zones'

// Which device hears the sound right now: one live bar per mic (mic_levels from the brain,
// twice a second) and the loudest one lit up and named. The brain's direction guess, when it
// has one, wins the highlight. Loudness only: no audio reaches this screen.
const QUIET = 0.01 // below this a mic is just room noise
const FULL = 0.25 // a bar is full at this loudness

export function heardBy(levels, direction) {
  if (direction && Date.now() / 1000 - direction.ts < 2.5) return direction.zone
  const [zone, level] = Object.entries(levels?.levels ?? {}).sort((a, b) => b[1] - a[1])[0] ?? []
  return level >= QUIET * 2 ? zone : null
}

export default function MicMeters({ levels, direction, compact = false }) {
  const fresh = levels && Date.now() / 1000 - levels.ts < 3
  const entries = fresh ? Object.entries(levels.levels).sort((a, b) => micName(a[0]).localeCompare(micName(b[0]))) : []
  const winner = fresh ? heardBy(levels, direction) : null

  if (compact) {
    if (!winner) return null
    return (
      <div className="glass-dark flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold text-amber-300">
        <Ear size={16} /> Heard by {micName(winner)}
      </div>
    )
  }

  return (
    <section className="glass rounded-xl p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><Ear size={18} /> Which device hears it</h2>
        <span className={`text-lg font-semibold ${winner ? 'text-amber-300' : 'text-zinc-500'}`}>
          {winner ? `Heard by: ${micName(winner)}` : entries.length ? 'Quiet' : 'No mics streaming yet'}
        </span>
      </div>
      <ul className="space-y-2">
        {entries.map(([zone, level]) => {
          const on = zone === winner
          const pct = Math.min(100, Math.round((Math.max(0, level - QUIET) / FULL) * 100))
          return (
            <li key={zone} className="flex items-center gap-3">
              <span className={`w-28 shrink-0 truncate text-sm ${on ? 'font-semibold text-amber-300' : 'text-zinc-300'}`}>{micName(zone)}</span>
              <div className="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800">
                <div className={`h-full rounded-full transition-[width] duration-300 ${on ? 'bg-amber-400' : 'bg-zinc-500'}`} style={{ width: `${pct}%` }} />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
