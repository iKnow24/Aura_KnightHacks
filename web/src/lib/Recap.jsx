import { motion } from 'framer-motion'
import { useState } from 'react'

// After a lecture: what it was about, a memory map anchored to *when* each idea came up,
// and a quick quiz. People remember by place and time, so every branch says when it was said.
const BRAIN = {
  local: 'Written by Lumen’s own model on our AMD GPU. Nothing left our server.',
  groq: 'Written by an open model on Groq.',
  xai: 'Written by Grok.',
  claude: 'Written by Claude.',
  rules: 'Built offline from your transcript, no AI model needed.',
}

function when(ts, start) {
  if (!ts) return null
  const mins = Math.max(0, Math.round((ts - start) / 60))
  const clock = new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return mins < 1 ? `${clock} · right at the start` : `${clock} · ${mins} min in`
}

function MindMap({ map, start }) {
  const [open, setOpen] = useState(0)
  const n = map.branches.length
  const R = 116
  const pos = map.branches.map((_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    return { x: 160 + R * Math.cos(a), y: 160 + R * Math.sin(a) }
  })
  const b = map.branches[open]
  return (
    <div>
      <svg viewBox="0 0 320 320" className="mx-auto w-full max-w-sm">
        {pos.map((p, i) => (
          <motion.line key={`l${i}`} x1="160" y1="160" x2={p.x} y2={p.y} stroke={i === open ? '#fbbf24' : '#3f3f46'} strokeWidth="2"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.15 * i, duration: 0.5 }} />
        ))}
        <circle cx="160" cy="160" r="46" fill="#292110" stroke="#fbbf24" strokeWidth="2" />
        <text x="160" y="164" textAnchor="middle" fill="#fff" fontSize="13" fontWeight="700">
          {map.center.length > 16 ? `${map.center.slice(0, 15)}…` : map.center}
        </text>
        {pos.map((p, i) => (
          <motion.g key={`n${i}`} onClick={() => setOpen(i)} style={{ cursor: 'pointer' }}
            initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15 * i + 0.3 }}>
            <circle cx={p.x} cy={p.y} r="34" fill={i === open ? '#fbbf24' : '#18181b'} stroke={i === open ? '#fbbf24' : '#52525b'} strokeWidth="2" />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="9" fontWeight="600" fill={i === open ? '#000' : '#e4e4e7'}>
              {map.branches[i].label.length > 12 ? `${map.branches[i].label.slice(0, 11)}…` : map.branches[i].label}
            </text>
          </motion.g>
        ))}
      </svg>
      {b && (
        <motion.div key={open} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-2 rounded-2xl bg-zinc-900 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-lg font-semibold">{b.label}</div>
            {when(b.ts, start) && <div className="text-xs text-amber-400">🕒 {when(b.ts, start)}</div>}
          </div>
          <ul className="mt-2 space-y-1 text-sm text-zinc-300">
            {b.details.map((d) => <li key={d}>“{d}”</li>)}
          </ul>
        </motion.div>
      )}
    </div>
  )
}

function Quiz({ quiz }) {
  const [i, setI] = useState(0)
  const [picked, setPicked] = useState(null)
  const [score, setScore] = useState(0)
  if (!quiz.length) return null
  if (i >= quiz.length) {
    return (
      <div className="rounded-2xl bg-zinc-900 p-5 text-center">
        <div className="text-4xl font-black">{score}/{quiz.length}</div>
        <button onClick={() => { setI(0); setScore(0); setPicked(null) }} className="mt-3 text-sm text-amber-400">Try again</button>
      </div>
    )
  }
  const q = quiz[i]
  const pick = (c) => {
    if (picked !== null) return
    setPicked(c)
    if (c === q.answer) setScore((s) => s + 1)
    setTimeout(() => { setPicked(null); setI((n) => n + 1) }, 1100)
  }
  return (
    <motion.div key={i} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="rounded-2xl bg-zinc-900 p-5">
      <div className="text-xs text-zinc-500">Question {i + 1} of {quiz.length}</div>
      <div className="mt-1 text-lg font-medium">{q.q}</div>
      <div className="mt-4 grid gap-2">
        {q.choices.map((c, ci) => {
          const state = picked === null ? '' : ci === q.answer ? 'bg-green-600 border-green-500' : ci === picked ? 'bg-red-600 border-red-500' : 'opacity-50'
          return (
            <button key={ci} onClick={() => pick(ci)} className={`rounded-xl border border-zinc-700 px-4 py-3 text-left capitalize transition ${state}`}>
              {c}
            </button>
          )
        })}
      </div>
    </motion.div>
  )
}

export default function Recap({ recap, start, onClose }) {
  return (
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
      className="fixed inset-0 z-30 overflow-y-auto bg-black/95 p-4 pb-16 backdrop-blur">
      <div className="mx-auto max-w-xl space-y-6">
        <header className="flex items-start justify-between gap-4 pt-2">
          <div>
            <div className="text-xs uppercase tracking-widest text-amber-400">Lecture recap</div>
            <h2 className="text-3xl font-bold tracking-tight">{recap.title}</h2>
          </div>
          <button onClick={onClose} className="rounded-full bg-zinc-800 px-4 py-2 text-sm">Done</button>
        </header>
        <p className="text-lg leading-relaxed text-zinc-200">{recap.summary}</p>
        {recap.points?.length > 0 && (
          <ul className="space-y-2">
            {recap.points.map((p) => <li key={p} className="flex gap-2 text-zinc-300"><span className="text-amber-400">●</span>{p}</li>)}
          </ul>
        )}
        {recap.map.branches.length > 0 && (
          <section>
            <h3 className="mb-2 font-semibold">Memory map <span className="text-sm font-normal text-zinc-500">tap a bubble</span></h3>
            <MindMap map={recap.map} start={start} />
          </section>
        )}
        {recap.quiz.length > 0 && (
          <section>
            <h3 className="mb-2 font-semibold">Quick quiz</h3>
            <Quiz quiz={recap.quiz} />
          </section>
        )}
        {recap.people?.length > 0 && (
          <section className="rounded-2xl border border-zinc-800 p-4 text-sm">
            <div className="font-semibold">Names you heard</div>
            <div className="mt-1 text-zinc-300">{recap.people.join(', ')}</div>
            <div className="mt-1 text-xs text-zinc-500">From what people said out loud, never from their faces.</div>
          </section>
        )}
        <p className="text-xs text-zinc-500">{BRAIN[recap.brain] ?? ''}</p>
      </div>
    </motion.div>
  )
}
