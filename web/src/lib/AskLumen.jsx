import { motion } from 'framer-motion'
import { Mic, Send, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { greet, hush, onVoiceStatus, prime, say, setVoice, voiceOn, voiceSupported, warmup } from './speak'
import { ALERT_TEXT, ZONES } from './zones'

const SUGGESTIONS = ['Where are my keys?', 'What was the last thing said?', 'What happened while I was asleep?']
const Speech = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
const STORE = 'lumen.chat'
const KEEP = 30 // messages kept in this browser

const room = (z) => ZONES[z]?.label ?? z
const time = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const load = () => { try { return JSON.parse(sessionStorage.getItem(STORE)) || [] } catch { return [] } }

// "Ask Lumen": a chat with the house agent, answered from what the phones heard and saw.
// The thread lives in this browser tab only (photos stripped), so a refresh keeps the conversation.
export default function AskLumen({ className = '' }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [thread, setThread] = useState(load)
  const [voice, setVoiceOn] = useState(voiceOn)
  const [voiceStatus, setVoiceStatus] = useState({ status: 'idle', progress: 0 })
  const list = useRef()

  const hear = (text) => {
    setVoice(true)
    setVoiceOn(true)
    prime()
    warmup()
    if (text) say(text, { force: true })
    else greet()
  }

  useEffect(() => onVoiceStatus(setVoiceStatus), [])
  useEffect(() => { if (voice) warmup() }, [voice])

  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight
    try {
      const light = thread.slice(-KEEP).map((m) => ({ ...m, evidence: m.evidence?.map(({ thumb, ...e }) => e) }))
      sessionStorage.setItem(STORE, JSON.stringify(light))
    } catch { /* private window */ }
  }, [thread])

  const ask = async (question) => {
    if (!question.trim() || busy) return
    prime()
    if (voiceOn()) warmup()
    setQ('')
    setBusy(true)
    setThread((t) => [...t, { from: 'you', text: question, ts: Date.now() / 1000 }])
    let reply
    try {
      const r = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) })
      reply = await r.json()
    } catch {
      reply = { answer: "Can't reach the brain right now.", evidence: [] }
    }
    if (voiceOn()) say(reply.answer, { force: true })
    setThread((t) => [...t, { from: 'lumen', text: reply.answer, evidence: reply.evidence, brain: reply.brain, ts: Date.now() / 1000 }])
    setBusy(false)
  }

  // Voice input for people who'd rather speak than type (Chrome and Safari).
  // Unlock sound on this tap. The answer arrives later, after she has stopped listening.
  const listen = () => {
    if (!Speech || busy) return
    hush()
    setVoice(true)
    setVoiceOn(true)
    prime()
    warmup()
    const rec = new Speech()
    rec.lang = 'en-US'
    rec.onresult = (e) => ask(e.results[0][0].transcript || '')
    rec.onerror = () => setListening(false)
    rec.onend = () => setListening(false)
    setListening(true)
    try { rec.start() } catch { setListening(false) }
  }

  return (
    <section className={`glass flex min-h-0 flex-col rounded-xl p-4 ${className}`}>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Messages · Ask Lumen</h2>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {voiceSupported() && (
            <>
              <button type="button" onClick={() => hear()}
                title="Play Luma's voice now"
                className="flex items-center gap-1 text-xs text-zinc-300 hover:text-white">
                <Volume2 size={14} /> {
                  voiceStatus.status === 'speaking' ? 'Speaking…'
                    : voiceStatus.status === 'loading' ? `Loading Luma${voiceStatus.progress ? ` ${voiceStatus.progress}%` : '…'}`
                      : 'Hear Luma'
                }
              </button>
              <button type="button" onClick={() => {
                const next = !voice
                setVoice(next)
                setVoiceOn(next)
                if (next) hear()
              }} title="Luma reads answers and hazard notes aloud"
                className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
                {voice ? <Volume2 size={14} /> : <VolumeX size={14} />} Voice {voice ? 'on' : 'off'}
              </button>
            </>
          )}
          {thread.length > 0 && <button onClick={() => setThread([])} className="text-xs text-zinc-500 hover:text-zinc-300">Clear</button>}
        </div>
      </div>

      <ol ref={list} className="mt-3 min-h-24 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
        {thread.length === 0 && <li className="text-sm text-zinc-500">Ask the house agent anything it heard or saw. Answers come from the house log. Tap Hear Luma to hear her. Her voice downloads once, then stays on this laptop.</li>}
        {thread.map((m, i) => (
          <motion.li key={`${m.ts}-${i}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${m.from === 'you' ? 'ml-auto bg-zinc-100 text-ink' : 'bg-zinc-900'}`}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 leading-snug">{m.text}</div>
              {m.from === 'lumen' && voiceSupported() && (
                <button type="button" aria-label="Hear this answer" title="Hear this answer"
                  onClick={() => hear(m.text)}
                  className="shrink-0 text-zinc-500 hover:text-white"><Volume2 size={14} /></button>
              )}
            </div>
            {m.evidence?.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {m.evidence.map((e) => (
                  <li key={`${e.type}-${e.ts}`} className="flex items-center gap-2 text-xs text-zinc-400">
                    {e.thumb && <img src={e.thumb} alt={e.item} className="h-12 w-12 rounded-lg object-cover" />}
                    <span>
                      {e.type === 'sighting' && `📷 ${e.item} · ${room(e.zone)} · ${time(e.ts)}`}
                      {e.type === 'speech' && `💬 “${e.text}” · ${room(e.zone)} · ${time(e.ts)}`}
                      {e.type === 'alert' && `${ALERT_TEXT[e.kind]?.icon ?? '•'} ${ALERT_TEXT[e.kind]?.text ?? e.kind} · ${room(e.zone)} · ${time(e.ts)}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {m.from === 'lumen' && <div className="mt-1 text-[11px] text-zinc-600">{m.brain && m.brain !== 'rules' ? 'Luma · ' : ''}{time(m.ts)}</div>}
          </motion.li>
        ))}
        {busy && <li className="w-fit rounded-2xl bg-zinc-900 px-3.5 py-2.5 text-zinc-400">…</li>}
      </ol>

      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => ask(s)} className="rounded-full bg-zinc-900 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800">{s}</button>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(q) }} className="mt-2 flex gap-2">
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder={listening ? 'Listening…' : 'Ask out loud or type. Luma talks back.'} aria-label="Message Lumen"
          className="min-w-0 flex-1 rounded-lg bg-zinc-900 px-3 py-2 outline-none ring-amber-400 focus:ring-2"
        />
        {Speech && (
          <button type="button" onClick={listen} title={listening ? 'Listening' : 'Ask by voice'} aria-label={listening ? 'Listening' : 'Ask by voice'}
            className={`rounded-lg px-3 ${listening ? 'animate-pulse bg-white text-black' : 'bg-zinc-800 hover:bg-zinc-700'}`}><Mic size={18} /></button>
        )}
        <button disabled={busy} aria-label="Send" className="rounded-lg bg-amber-400 px-3 font-semibold text-black disabled:opacity-50"><Send size={18} /></button>
      </form>
    </section>
  )
}
