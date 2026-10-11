import { useEffect, useMemo, useState } from 'react'
import AlertIcon from './AlertIcon'
import { alertText, zoneLabel } from './zones'

// Under the live control center: a calendar of what this household went through, with the
// chosen day's alerts and moments beside it.

const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TZ = 'America/New_York'

const clock = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: TZ })

export default function Story() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [day, setDay] = useState(null)

  useEffect(() => {
    fetch('/api/history').then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))).then((d) => {
      setData(d)
      const days = d.days || []
      setDay(days.at(-1)?.day ?? d.moments?.at(-1)?.day ?? null)
    }).catch((e) => setError(`Couldn't load the calendar (${e.message}). Is the brain running?`))
  }, [])

  if (error) return <section className="glass mt-8 rounded-xl p-6 text-sm text-zinc-400">{error}</section>
  if (!data) return <section className="glass mt-8 h-64 animate-pulse rounded-xl" />

  return (
    <section className="mt-8 space-y-4">
      <header>
        <h2 className="text-lg font-semibold">What this household has been through</h2>
        <p className="mt-1 max-w-3xl text-sm text-zinc-400">
          Pick a day to see what happened. The bar under each date is how busy it was.
          {data.source === 'sample' && ' These two weeks are the made-up Maria household, with a slowdown planted on purpose.'}
          {data.source === 'databricks' && ' These rows are live from Databricks.'}
          {data.source === 'event_log' && ' These rows are this home’s own event log.'}
        </p>
      </header>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Calendar data={data} day={day} onDay={setDay} />
        <DayList day={day} moments={data.moments || []} />
      </div>
      {data.note && <p className="text-xs text-zinc-500">{data.note}</p>}
    </section>
  )
}

function Calendar({ data, day, onDay }) {
  const months = useMemo(() => buildMonths(data.days || [], data.moments || []), [data])
  if (months.length === 0) {
    return <div className="glass rounded-xl p-6 text-sm text-zinc-400">No days logged yet. Alerts land here as they happen.</div>
  }
  const most = Math.max(1, ...months.flatMap((m) => m.cells.map((c) => c?.alerts || 0)))
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] p-5 shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_30px_80px_-40px_rgb(0_0_0/0.9)] backdrop-blur-2xl sm:p-6">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
      <div className="space-y-7">
        {months.map((month) => (
          <div key={month.key}>
            <h3 className="mb-4 text-[15px] font-medium tracking-tight text-white">{month.label}</h3>
            <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
              {WEEK.map((w) => <div key={w}>{w}</div>)}
            </div>
            <div className="mt-2 grid grid-cols-7 gap-1.5">
              {month.cells.map((cell, i) => {
                if (!cell) return <div key={`pad-${month.key}-${i}`} />
                const on = day === cell.day
                return (
                  <button key={cell.day} type="button" onClick={() => onDay(cell.day)} aria-pressed={on}
                    className={`group relative flex aspect-square flex-col justify-between rounded-2xl border p-2 text-left transition duration-300 sm:aspect-[5/4] sm:p-2.5 ${on
                      ? 'border-white/70 bg-white text-black shadow-[0_10px_40px_-10px_rgb(255_255_255/0.45)]'
                      : 'border-white/[0.07] bg-white/[0.04] text-white hover:border-white/20 hover:bg-white/[0.08]'}`}>
                    <span className="text-sm font-medium tabular-nums sm:text-base">{cell.date.getDate()}</span>
                    <span className="block">
                      <span className={`hidden text-[10px] sm:block ${on ? 'text-zinc-600' : 'text-zinc-500'}`}>
                        {cell.alerts ? `${cell.alerts} alert${cell.alerts === 1 ? '' : 's'}` : cell.clinic ? 'Clinic' : ''}
                      </span>
                      <span className={`mt-1 block h-[3px] rounded-full ${on ? 'bg-black/10' : 'bg-white/[0.06]'}`}>
                        <span className={`block h-full rounded-full ${on ? 'bg-black/70' : 'bg-white/50'}`} style={{ width: `${Math.round((cell.alerts / most) * 100)}%` }} />
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function buildMonths(days, moments) {
  const info = new Map(days.map((d) => [d.day, d]))
  const clinicDays = new Set(moments.filter((m) => m.clinic).map((m) => m.day))
  for (const m of moments) if (!info.has(m.day)) info.set(m.day, { day: m.day, alerts: 0 })
  const keys = [...info.keys()].sort()
  if (!keys.length) return []
  const groups = new Map()
  for (const key of keys) {
    const date = new Date(`${key}T12:00:00`)
    const id = `${date.getFullYear()}-${date.getMonth()}`
    if (!groups.has(id)) groups.set(id, { key: id, label: date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), date, cells: [] })
    const row = info.get(key)
    groups.get(id).cells.push({
      day: key, date,
      alerts: moments.filter((m) => m.day === key && m.kind === 'alert').length || row.alerts || 0,
      clinic: clinicDays.has(key),
    })
  }
  return [...groups.values()].map((month) => {
    const pad = month.cells[0].date.getDay()
    return { ...month, cells: [...Array(pad).fill(null), ...month.cells] }
  })
}

function DayList({ day, moments }) {
  const rows = moments.filter((m) => m.day === day)
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 shadow-[inset_0_1px_0_rgb(255_255_255/0.08)] backdrop-blur-2xl lg:sticky lg:top-6">
      <h3 className="text-[15px] font-medium tracking-tight">{day ? new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : 'Pick a day'}</h3>
      <ul className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto">
        {rows.length === 0 && <li className="text-sm text-zinc-500">Nothing logged this day.</li>}
        {rows.map((m, i) => (
          <li key={`${m.time}-${m.kind}-${i}`} className="flex gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.04] p-3 text-sm">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 text-lg">
              {m.kind === 'alert' ? <AlertIcon kind={m.title} /> : <span className="text-xs font-semibold" aria-hidden="true">Dr</span>}
            </span>
            <div className="min-w-0">
              <div className="font-medium">
                {m.kind === 'alert' ? alertText(m.title).text : m.title}
                {m.kind === 'alert' && <span className="text-zinc-400"> · {zoneLabel(m.detail)}</span>}
                {m.missed && <span className="text-zinc-400"> · missed</span>}
              </div>
              {m.kind === 'said' && <p className="mt-0.5 text-zinc-300">“{m.detail}”</p>}
              <div className="tabular text-xs text-zinc-500">{clock(m.time)}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
