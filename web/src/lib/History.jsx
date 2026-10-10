import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { alertText, zoneLabel } from './zones'

// History tab: two weeks of alerts from GET /api/history (Databricks Gold tables, or the
// committed sample week when Databricks isn't set up). "Worth a call" is a change from her
// own normal, never a diagnosis.

const WARN = '#f59e0b'
const TZ = 'America/New_York' // the household's clock, same as the pipeline
const fmtDay = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const secs = (s) => (s == null ? '–' : `${s.toFixed(1)} s`)

export default function History() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/history').then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))).then(setData)
      .catch((e) => setError(`Couldn't load history (${e.message}). Is the brain running?`))
  }, [])

  if (error) return <div className="glass rounded-xl p-6 text-sm text-zinc-400">{error}</div>
  if (!data) return <div className="glass h-64 animate-pulse rounded-xl" />

  const { days, status: s } = data
  if (days.length === 0) {
    return (
      <div className="glass rounded-xl p-6 text-sm text-zinc-400">
        No alerts logged yet. Real alerts land here as they happen (test buttons are left out).
        <Source data={data} />
      </div>
    )
  }
  const week = days.slice(-7)
  const sum = (key, rows = week) => rows.reduce((n, d) => n + d[key], 0)
  const weekBefore = days.slice(-14, -7)

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="space-y-4">
      {s && <StatusBanner s={s} name={data.household} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Time to notice" value={secs(s?.median_seconds_this_week)} sub={`usual ${secs(s?.median_seconds_week_before)}`} warn={s?.median_seconds_this_week > 1.25 * s?.median_seconds_week_before} />
        <Stat label="Missed this week" value={s?.missed_this_week ?? '–'} sub={`${s?.missed_week_before ?? '–'} the week before`} warn={s?.flagged && s.missed_this_week > s.missed_week_before} />
        <Stat label="Alerts, last 7 days" value={sum('alerts')} sub="info alerts left out" />
        <Stat label="At night, last 7 days" value={sum('night_alerts')} sub={`${sum('missed_at_night')} missed (${sum('missed_at_night', weekBefore)} the week before)`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Typical time to notice" note="Median seconds from alert to tap, per day. Dashed line is her usual (the week before).">
          <LineChart days={days} usual={s?.median_seconds_week_before} />
        </Panel>
        <Panel title="Alerts per day" note="Each bar is a day. The amber part was missed (no tap within 5 minutes).">
          <Bars days={days} total="alerts" part="missed_alerts" partLabel="missed" />
        </Panel>
        <Panel title="Alerts at night" note="10 PM to 7 AM, when the bedroom strobe does the work.">
          <Bars days={days} total="night_alerts" part="missed_at_night" partLabel="missed at night" />
        </Panel>
        <Panel title="Recently missed">
          <ul className="space-y-1.5 text-sm">
            {data.missed.length === 0 && <li className="text-zinc-500">Nothing missed.</li>}
            {data.missed.map((m) => (
              <li key={m.time} className="flex items-baseline justify-between gap-3 border-b border-white/5 pb-1.5">
                <span>{alertText(m.kind).text} <span className="text-zinc-500">· {zoneLabel(m.zone)}</span></span>
                <span className="tabular shrink-0 text-xs text-zinc-500">
                  {new Date(m.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ })}{m.at_night ? ' · night' : ''}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Source data={data} />
    </motion.div>
  )
}

const SOURCES = {
  databricks: 'Live from Databricks',
  event_log: "This home's real events",
  sample: 'Sample household (planted decline), offline',
}

function Source({ data }) {
  return (
    <footer className="mt-4 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
      <span className="glass flex items-center gap-2 rounded-full px-3 py-1">
        <span className={`h-1.5 w-1.5 rounded-full ${data.source === 'sample' ? 'bg-zinc-500' : 'bg-emerald-400'}`} />
        {SOURCES[data.source] || data.source}
      </span>
      {data.note && <span>{data.note}</span>}
      {data.dashboard_url && (
        <a href={data.dashboard_url} target="_blank" rel="noreferrer" className="glass ml-auto rounded-full px-4 py-1.5 text-sm font-medium text-zinc-100 hover:border-white/20">
          Open Databricks dashboard ↗
        </a>
      )}
    </footer>
  )
}

function StatusBanner({ s, name }) {
  const who = name ? name[0].toUpperCase() + name.slice(1) : 'She'
  if (s.alerts_week_before != null && s.alerts_week_before < 20) {
    // Real data starts today: there is no "her normal" to compare with yet, so don't pretend.
    return (
      <div className="glass flex items-start gap-4 rounded-xl p-5">
        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-zinc-500" />
        <div>
          <div className="text-lg font-semibold">Learning her normal</div>
          <p className="mt-1 text-sm text-zinc-400">
            {`So far: ${s.alerts_this_week} alerts, ${s.missed_this_week} missed, typically noticed in ${secs(s.median_seconds_this_week)}. `}
            Lumen compares each week with the one before, so the "worth a call" check starts after a week of alerts.
          </p>
        </div>
      </div>
    )
  }
  return (
    <div className="glass flex items-start gap-4 rounded-xl p-5" style={s.flagged ? { borderColor: `${WARN}66` } : undefined}>
      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.flagged ? WARN : '#34d399' }} />
      <div>
        <div className="text-lg font-semibold">{s.flagged ? 'Worth a call' : 'Normal for her'}</div>
        <p className="mt-1 text-sm text-zinc-400">
          {s.flagged
            ? `${who} took ${s.pct_slower}% longer to notice alerts this week than her usual, and missed ${s.missed_this_week} (vs ${s.missed_week_before} the week before). A change from her normal, not a diagnosis.`
            : `Time to notice and missed alerts are in line with the week before.`}
        </p>
        <p className="mt-1 text-xs text-zinc-600">Last 7 days to {fmtDay(s.latest_day)} vs the 7 before</p>
      </div>
    </div>
  )
}

const Stat = ({ label, value, sub, warn }) => (
  <div className="glass rounded-xl p-4">
    <div className="text-xs uppercase tracking-[0.15em] text-zinc-500">{label}</div>
    <div className="tabular mt-1 flex items-center gap-2 text-2xl font-semibold">
      {value}{warn && <span className="text-xs font-medium" style={{ color: WARN }}>▲ up</span>}
    </div>
    <div className="text-xs text-zinc-500">{sub}</div>
  </div>
)

const Panel = ({ title, note, children }) => (
  <section className="glass rounded-xl p-4">
    <h3 className="font-semibold">{title}</h3>
    {note && <p className="mb-3 text-xs text-zinc-500">{note}</p>}
    {children}
  </section>
)

// Shared chart frame: 0-100 wide SVG, readout line above that follows hover/tap.
const W = 100, H = 46, PAD = 2

function Readout({ text, top }) {
  return (
    <div className="tabular mb-1 flex h-4 justify-between text-xs">
      <span className="text-zinc-300">{text}</span><span className="text-zinc-600">{top}</span>
    </div>
  )
}

function Axis({ days }) {
  return (
    <div className="tabular mt-1 flex justify-between text-[10px] text-zinc-600">
      <span>{fmtDay(days[0].day)}</span><span>{fmtDay(days[days.length - 1].day)}</span>
    </div>
  )
}

function LineChart({ days, usual }) {
  const [hover, setHover] = useState(null)
  const vals = days.map((d) => d.median_seconds_to_notice)
  const max = Math.max(...vals.filter((v) => v != null), usual ?? 0) * 1.15 || 1
  const x = (i) => PAD + (i * (W - 2 * PAD)) / Math.max(days.length - 1, 1)
  const y = (v) => H - (v / max) * H
  const pts = days.map((d, i) => (d.median_seconds_to_notice == null ? null : [x(i), y(d.median_seconds_to_notice)])).filter(Boolean)
  const h = hover != null ? days[hover] : null
  return (
    <div>
      <Readout text={h ? `${fmtDay(h.day)}: ${secs(h.median_seconds_to_notice)} to notice` : `Usual ${secs(usual)}`} top={`scale 0–${Math.round(max)} s`} />
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-36 w-full overflow-visible">
          {usual != null && <line x1="0" x2={W} y1={y(usual)} y2={y(usual)} stroke="rgb(255 255 255 / 0.3)" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
          <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="#f4f4f5" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} stroke="rgb(255 255 255 / 0.2)" vectorEffect="non-scaling-stroke" />}
        </svg>
        {/* Dots as HTML so they stay round on a stretched SVG. */}
        {days.map((d, i) => d.median_seconds_to_notice != null && (
          <span key={d.day} className="pointer-events-none absolute h-2 w-2 rounded-full border-2 border-[#0a0a0b] bg-zinc-100"
            style={{ left: `${x(i)}%`, top: `${(y(d.median_seconds_to_notice) / H) * 100}%`, transform: `translate(-50%,-50%) scale(${hover === i ? 1.5 : 1})` }} />
        ))}
        <HitStrip n={days.length} onHover={setHover} />
      </div>
      <Axis days={days} />
    </div>
  )
}

function Bars({ days, total, part, partLabel }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(...days.map((d) => d[total]), 1)
  const h = hover != null ? days[hover] : null
  return (
    <div>
      <Readout text={h ? `${fmtDay(h.day)}: ${h[total]} alerts, ${h[part]} ${partLabel}` : 'Tap a bar'} top={`scale 0–${max}`} />
      <div className="relative flex h-36 items-end gap-[2px]">
        {days.map((d, i) => (
          <div key={d.day} className="flex h-full flex-1 flex-col justify-end" style={{ opacity: hover == null || hover === i ? 1 : 0.5 }}>
            {d[part] > 0 && <div className="rounded-t-[4px]" style={{ height: `${(d[part] / max) * 100}%`, background: WARN }} />}
            <div className={`bg-zinc-500 ${d[part] > 0 ? 'mt-[2px]' : 'rounded-t-[4px]'}`} style={{ height: `${((d[total] - d[part]) / max) * 100}%` }} />
          </div>
        ))}
        <HitStrip n={days.length} onHover={setHover} />
      </div>
      <Axis days={days} />
      <div className="mt-2 flex gap-4 text-xs text-zinc-400">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-zinc-500" />Seen</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: WARN }} />Missed</span>
      </div>
    </div>
  )
}

// Invisible columns, one per day, bigger than the marks so hover and tap are easy.
const HitStrip = ({ n, onHover }) => (
  <div className="absolute inset-0 flex" onMouseLeave={() => onHover(null)}>
    {Array.from({ length: n }, (_, i) => (
      <div key={i} className="flex-1" onMouseEnter={() => onHover(i)} onClick={() => onHover(i)} />
    ))}
  </div>
)
