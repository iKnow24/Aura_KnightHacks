import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { ALERT_TEXT, ZONES } from './zones'

const SUGGESTIONS = ['Where are my keys?', 'What was the last thing said?', 'What happened while I was asleep?']
const Speech = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

const room = (z) => ZONES[z]?.label ?? z
const time = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

// "Ask Lumen": questions about the house, answered from what the phones heard and saw.
export default function AskLumen() {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [result, setResult] = useState(null)

  const ask = async (question) => {
    if (!question.trim()) return
    setQ(question)
    setBusy(true)
    try {
      const r = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) })
      setResult({ question, ...(await r.json()) })
    } catch {
      setResult({ question, answer: "Can't reach the brain right now.", evidence: [] })
    }
    setBusy(false)
  }

  // Voice input for people who'd rather speak than type (Chrome and Safari).
  const listen = () => {
    const rec = new Speech()
    rec.lang = 'en-US'
    rec.onresult = (e) => ask(e.results[0][0].transcript)
    rec.onend = () => setListening(false)
    setListening(true)
    rec.start()
  }

  return (
    <section className="rounded-2xl border border-zinc-800 p-4">
      <h2 className="font-semibold">Ask Lumen</h2>
      <form onSubmit={(e) => { e.preventDefault(); ask(q) }} className="mt-2 flex gap-2">
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="Where are my keys?"
          className="min-w-0 flex-1 rounded-lg bg-zinc-900 px-3 py-2 outline-none ring-amber-400 focus:ring-2"
        />
        {Speech && (
          <button type="button" onClick={listen} title="Ask by voice"
            className={`rounded-lg px-3 ${listening ? 'animate-pulse bg-red-500' : 'bg-zinc-800 hover:bg-zinc-700'}`}>🎙️</button>
        )}
        <button disabled={busy} className="rounded-lg bg-amber-400 px-4 font-semibold text-black disabled:opacity-50">
          {busy ? '…' : 'Ask'}
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => ask(s)} className="rounded-full bg-zinc-900 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800">{s}</button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {result && (
          <motion.div key={result.question + result.answer} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mt-4 rounded-xl bg-zinc-900 p-4">
            <div className="text-lg leading-snug">{result.answer}</div>
            {result.evidence?.length > 0 && (
              <ul className="mt-3 space-y-2">
                {result.evidence.map((e) => (
                  <li key={`${e.type}-${e.ts}`} className="flex items-center gap-3 text-sm text-zinc-400">
                    {e.thumb && <img src={e.thumb} alt={e.item} className="h-16 w-16 rounded-lg object-cover" />}
                    <span>
                      {e.type === 'sighting' && `📷 ${e.item} · ${room(e.zone)} · ${time(e.ts)}`}
                      {e.type === 'speech' && `💬 “${e.text}” · ${room(e.zone)} · ${time(e.ts)}`}
                      {e.type === 'alert' && `${ALERT_TEXT[e.kind]?.icon ?? '•'} ${ALERT_TEXT[e.kind]?.text ?? e.kind} · ${room(e.zone)} · ${time(e.ts)}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 text-xs text-zinc-600">{result.brain === 'claude' ? 'answered by Claude from the house log' : 'answered from the house log'}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
