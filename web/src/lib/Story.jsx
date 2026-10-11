import { useEffect, useMemo, useState } from 'react'
import AlertIcon from './AlertIcon'
import { alertText, zoneLabel } from './zones'

// Under the live control center: a calendar of what this household went through, and a
// simple map of Orlando. Home is always there. Dr. Patel's office appears only when the
// history log actually has that call.

const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TZ = 'America/New_York'

const clock = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: TZ })

export default function Story() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [day, setDay] = useState(null)
  const [pin, setPin] = useState('home')

  useEffect(() => {
    fetch('/api/history').then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))).then((d) => {
      setData(d)
      const days = d.days || []
      setDay(days.at(-1)?.day ?? d.moments?.at(-1)?.day ?? null)
      if ((d.places || []).some((p) => p.id === 'clinic')) setPin('clinic')
    }).catch((e) => setError(`Couldn't load the calendar (${e.message}). Is the brain running?`))
  }, [])

  if (error) return <section className="glass mt-8 rounded-xl p-6 text-sm text-zinc-400">{error}</section>
  if (!data) return <section className="glass mt-8 h-64 animate-pulse rounded-xl" />

  return (
    <section className="mt-8 space-y-4">
      <header>
        <h2 className="text-lg font-semibold">What this household has been through</h2>
        <p className="mt-1 max-w-3xl text-sm text-zinc-400">
          Scroll the calendar for each day. The map is Orlando. The clinic pin is only there when the log has a call from the doctor’s office.
          {data.source === 'sample' && ' These two weeks are the made-up Maria household, with a slowdown planted on purpose.'}
          {data.source === 'databricks' && ' These rows are live from Databricks.'}
          {data.source === 'event_log' && ' These rows are this home’s own event log.'}
        </p>
      </header>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Calendar data={data} day={day} onDay={setDay} />
        <CityMap places={data.places || []} pin={pin} onPin={setPin} day={day} moments={data.moments || []} />
      </div>
      <DayList day={day} moments={data.moments || []} />
      {data.note && <p className="text-xs text-zinc-500">{data.note}</p>}
    </section>
  )
}

function Calendar({ data, day, onDay }) {
  const months = useMemo(() => buildMonths(data.days || [], data.moments || []), [data])
  if (months.length === 0) {
    return <div className="glass rounded-xl p-6 text-sm text-zinc-400">No days logged yet. Alerts land here as they happen.</div>
  }
  return (
    <div className="space-y-4">
      {months.map((month) => (
        <div key={month.key} className="glass rounded-xl p-4">
          <h3 className="mb-3 font-semibold">{month.label}</h3>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-widest text-zinc-500">
            {WEEK.map((w) => <div key={w}>{w}</div>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {month.cells.map((cell, i) => cell ? (
              <button key={cell.day} type="button" onClick={() => onDay(cell.day)} aria-pressed={day === cell.day}
                className={`min-h-14 rounded-lg px-1 py-1.5 text-left ${day === cell.day ? 'bg-zinc-100 text-ink' : 'bg-white/5 hover:bg-white/10'}`}>
                <div className="text-sm font-medium">{cell.date.getDate()}</div>
                <div className={`text-[10px] ${day === cell.day ? 'text-zinc-600' : 'text-zinc-400'}`}>
                  {cell.alerts ? `${cell.alerts} alert${cell.alerts === 1 ? '' : 's'}` : cell.clinic ? 'Clinic' : ''}
                </div>
              </button>
            ) : <div key={`pad-${month.key}-${i}`} />)}
          </div>
        </div>
      ))}
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

function CityMap({ places, pin, onPin, day, moments }) {
  const active = places.find((p) => p.id === pin) || places[0]
  const clinicToday = moments.some((m) => m.clinic && m.day === day)
  return (
    <div className="glass flex flex-col rounded-xl p-4">
      <h3 className="font-semibold">Orlando</h3>
      <p className="mb-3 text-xs text-zinc-500">A sketch of the city, not a street map. Pins come from the history log.</p>
      <div className="relative min-h-64 flex-1 overflow-hidden rounded-xl bg-black">
        <svg viewBox="0 0 100 80" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <path d="M8 50 C 20 38, 30 62, 48 48 S 70 30, 92 44" fill="none" stroke="rgb(255 255 255 / 0.18)" strokeWidth="1.2" />
          <path d="M18 18 C 30 28, 40 16, 55 24 S 78 40, 88 22" fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="0.8" />
          <ellipse cx="58" cy="58" rx="10" ry="4" fill="rgb(255 255 255 / 0.06)" />
          <text x="58" y="59" textAnchor="middle" fill="rgb(255 255 255 / 0.35)" fontSize="3">Lake</text>
          <text x="50" y="10" textAnchor="middle" fill="#f4f4f5" fontSize="4.5" fontWeight="600">Orlando</text>
        </svg>
        {places.map((p) => (
          <button key={p.id} type="button" onClick={() => onPin(p.id)} aria-pressed={pin === p.id}
            className="absolute -translate-x-1/2 -translate-y-full text-center" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
            <span className={`mx-auto block h-3 w-3 rounded-full border-2 border-white ${pin === p.id || (p.id === 'clinic' && clinicToday) ? 'bg-white' : 'bg-zinc-600'}`} />
            <span className="mt-1 block max-w-28 text-xs font-medium leading-tight">{p.name}</span>
          </button>
        ))}
      </div>
      {active && (
        <p className="mt-3 text-sm text-zinc-300">
          <span className="font-medium text-white">{active.name}</span>
          {' · '}{active.detail}
        </p>
      )}
    </div>
  )
}

function DayList({ day, moments }) {
  const rows = moments.filter((m) => m.day === day)
  return (
    <div className="glass rounded-xl p-4">
      <h3 className="font-semibold">{day ? new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : 'Pick a day'}</h3>
      <ul className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto">
        {rows.length === 0 && <li className="text-sm text-zinc-500">Nothing logged this day.</li>}
        {rows.map((m, i) => (
          <li key={`${m.time}-${m.kind}-${i}`} className="flex gap-3 rounded-lg bg-white/5 p-3 text-sm">
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
