import { AnimatePresence, motion } from 'framer-motion'
import { Mic, Send, Sparkles, Volume2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { prime, say, voiceSupported } from './speak'
import { api } from './useBrain'

// "Ask Luma" on the wearer's screen: tap, then talk or type. The answer comes from the house log
// (the same agent as Ask Lumen on the dashboard), shows as a card and is read aloud.
// Tap to talk, not always listening. It never fires an alert.
const Speech = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

export default function LumaTalk({ liftBy = 0 }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [heard, setHeard] = useState(false)
  const [answer, setAnswer] = useState(null)
  const recRef = useRef()

  const ask = async (text) => {
    const question = text.trim()
    if (!question || busy) return
    prime()
    setQ('')
    setBusy(true)
    setAnswer({ question, text: '…' })
    let reply
    try {
      reply = await api('/api/ask', { question })
    } catch {
      reply = { answer: "Can't reach the brain right now." }
    }
    setBusy(false)
    setAnswer({ question, text: reply.answer || 'No answer.' })
    say(reply.answer)
  }

  const listen = () => {
    if (!Speech) return
    const rec = new Speech()
    rec.lang = 'en-US'
    rec.onresult = (e) => { setOpen(false); ask(e.results[0][0].transcript) }
    rec.onend = () => setHeard(false)
    rec.onerror = () => setHeard(false)
    recRef.current = rec
    setHeard(true)
    rec.start()
  }

  return (
    <>
      <button onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }} aria-label="Ask Luma"
        style={{ bottom: `calc(max(0.75rem, env(safe-area-inset-bottom)) + ${liftBy}px)` }}
        className="glass-dark absolute right-3 z-30 flex h-12 w-12 items-center justify-center rounded-full text-white">
        <Sparkles size={20} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.form key="ask" onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); setOpen(false); ask(q) }}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ bottom: `calc(max(0.75rem, env(safe-area-inset-bottom)) + ${liftBy + 60}px)` }}
            className="glass-dark absolute right-3 z-30 flex w-[min(86vw,22rem)] items-center gap-2 rounded-full p-1.5 pl-4">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask Luma…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-500" />
            {Speech && (
              <button type="button" onClick={listen} aria-label="Talk to Luma"
                className={`flex h-9 w-9 items-center justify-center rounded-full ${heard ? 'bg-white text-black' : 'bg-zinc-900'}`}><Mic size={16} /></button>
            )}
            <button className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900" aria-label="Send"><Send size={16} /></button>
          </motion.form>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {answer && (
          <motion.div key={answer.question + answer.text} onClick={(e) => { e.stopPropagation(); if (!busy) setAnswer(null) }}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="glass-dark absolute inset-x-3 top-[max(3.5rem,calc(env(safe-area-inset-top)+3rem))] z-30 mx-auto max-w-md rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="text-xs uppercase tracking-widest text-zinc-400">Luma · {answer.question}</div>
              <span className="flex shrink-0 items-center gap-2">
                {voiceSupported() && answer.text && answer.text !== '…' && (
                  <button type="button" aria-label="Hear this answer" title="Hear this answer"
                    onClick={(e) => { e.stopPropagation(); say(answer.text, { force: true }) }}
                    className="text-zinc-400"><Volume2 size={14} /></button>
                )}
                <X size={14} className="text-zinc-500" />
              </span>
            </div>
            <p className="mt-2 text-lg leading-snug">{answer.text}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
