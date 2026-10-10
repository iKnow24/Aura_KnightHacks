import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { SPEAKER_COLORS, ZONES } from './zones'

const who = (c) => (c.speaker ? `Person ${c.speaker}` : c.zone === 'wearer' ? 'Nearby' : ZONES[c.zone]?.label ?? c.zone)
const color = (c) => (c.speaker ? SPEAKER_COLORS[(c.speaker - 1) % SPEAKER_COLORS.length] : '#71717a')

// Live transcript of everything the house heard, newest at the bottom, in big readable text.
export function useCaptions() {
  const [lines, setLines] = useState([])
  useEffect(() => {
    fetch('/api/memory').then((r) => r.json())
      .then((m) => setLines(m.entries.filter((e) => e.type === 'speech')))
      .catch(() => {})
  }, [])
  // A line arrives once from Whisper, then again once the headset says who said it: merge by ts.
  const add = (c) => setLines((list) => {
    const i = list.findIndex((x) => x.ts === c.ts)
    return i < 0 ? [...list, c].slice(-40) : list.map((x, j) => (j === i ? { ...x, ...c } : x))
  })
  return { lines, add, reload: () => fetch('/api/memory').then((r) => r.json()).then((m) => setLines(m.entries.filter((e) => e.type === 'speech'))) }
}

export default function Conversation({ lines }) {
  const end = useRef()
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), [lines.length])
  return (
    <section className="glass flex max-h-[420px] flex-col rounded-xl p-4">
      <h2 className="font-semibold">Conversation</h2>
      <div className="mt-2 flex-1 space-y-3 overflow-y-auto pr-1">
        {lines.length === 0 && <p className="text-zinc-500">Nothing heard yet. Captions appear here as people talk.</p>}
        <AnimatePresence initial={false}>
          {lines.map((c) => (
            <motion.div key={c.ts} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-xl bg-zinc-900 px-3 py-2" style={{ borderLeft: `4px solid ${color(c)}`, boxShadow: c.to_you ? `0 0 0 1px ${color(c)}` : 'none' }}>
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <span className="font-semibold" style={{ color: color(c) }}>{who(c)}</span>
                {c.to_you && <span className="rounded-full px-1.5 font-bold text-black" style={{ background: color(c) }}>TO YOU</span>}
                <span className="ml-auto">{new Date(c.ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
              </div>
              <div className="text-xl leading-snug">{c.text}</div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={end} />
      </div>
    </section>
  )
}
