import { AnimatePresence, motion } from 'framer-motion'
import { Mic, Send, Sparkles, Volume2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { hush, onVoiceStatus, prime, say, setVoice, voiceSupported, warmup } from './speak'
import { api } from './useBrain'

// "Ask Luma" on the wearer's screen: one tap, then talk. The answer comes from the house log
// (the same agent as Ask Lumen on the dashboard), shows as a card, and is said out loud.
// Tap to talk, not always listening. It never fires an alert.
const Speech = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

export default function LumaTalk({ liftBy = 0 }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [heard, setHeard] = useState(false)
  const [missed, setMissed] = useState(false)
  const [answer, setAnswer] = useState(null)
  const [voiceStatus, setVoiceStatus] = useState({ status: 'idle', progress: 0 })
  const recRef = useRef()

  useEffect(() => onVoiceStatus(setVoiceStatus), [])
  // The headset has to talk back, so start the voice download as soon as this page opens.
  useEffect(() => { warmup() }, [])

  const ask = async (text) => {
    const question = text.trim()
    if (!question || busy) return
    prime()
    warmup()
    setVoice(true)
    setQ('')
    setMissed(false)
    setBusy(true)
    setAnswer({ question, text: '…' })
    let reply
    try {
      reply = await api('/api/ask', { question })
    } catch {
      reply = { answer: "Can't reach the brain right now." }
    }
    const spoken = reply.answer || 'No answer.'
    setBusy(false)
    setAnswer({ question, text: spoken })
    say(spoken, { force: true })
  }

  const stopListen = () => {
    try { recRef.current?.stop() } catch { /* already stopped */ }
    setHeard(false)
  }

  // The mic tap is the moment the browser allows sound. Unlock it here, before she answers.
  const listen = () => {
    if (!Speech || busy) return
    hush()
    prime()
    warmup()
    setVoice(true)
    setMissed(false)
    const rec = new Speech()
    rec.lang = 'en-US'
    rec.onresult = (e) => {
      setHeard(false)
      setOpen(false)
      ask(e.results[0][0].transcript || '')
    }
    rec.onend = () => setHeard(false)
    rec.onerror = () => {
      setHeard(false)
      setMissed(true)
      setOpen(true)
    }
    recRef.current = rec
    setOpen(true)
    setHeard(true)
    try { rec.start() } catch {
      setHeard(false)
      setMissed(true)
    }
  }

  const toggle = (e) => {
    e.stopPropagation()
    if (heard || open) {
      stopListen()
      setOpen(false)
      return
    }
    if (Speech) listen()
    else { prime(); warmup(); setOpen(true) }
  }

  const label = heard ? 'Listening'
    : voiceStatus.status === 'speaking' ? 'Speaking'
      : voiceStatus.status === 'loading' ? 'Getting voice'
        : 'Ask Luma'

  return (
    <>
      <button onClick={toggle} aria-label={label}
        style={{ bottom: `calc(max(0.75rem, env(safe-area-inset-bottom)) + ${liftBy}px)` }}
        className={`glass-dark absolute right-3 z-30 flex h-12 items-center gap-2 rounded-full px-4 text-white ${heard ? 'ring-2 ring-white' : ''}`}>
        {heard ? <Mic size={18} /> : <Sparkles size={18} />}
        <span className="text-sm font-semibold">{label}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.form key="ask" onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); stopListen(); setOpen(false); ask(q) }}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ bottom: `calc(max(0.75rem, env(safe-area-inset-bottom)) + ${liftBy + 60}px)` }}
            className="glass-dark absolute right-3 z-30 flex w-[min(86vw,22rem)] items-center gap-2 rounded-full p-1.5 pl-4">
            <input autoFocus={!heard} value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={heard ? 'Listening…' : missed ? "Didn't catch that. Type it." : 'Ask Luma…'}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-500" />
            {Speech && (
              <button type="button" onClick={heard ? stopListen : listen} aria-label={heard ? 'Stop listening' : 'Talk to Luma'}
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
                    onClick={(e) => { e.stopPropagation(); prime(); warmup(); say(answer.text, { force: true }) }}
                    className="text-zinc-400"><Volume2 size={14} /></button>
                )}
                <X size={14} className="text-zinc-500" />
              </span>
            </div>
            <p className="mt-2 text-lg leading-snug">{answer.text}</p>
            {voiceStatus.status === 'loading' && <p className="mt-2 text-sm text-zinc-400">Getting Luma's voice{voiceStatus.progress ? ` ${voiceStatus.progress}%` : '…'} then she'll say this.</p>}
            {voiceStatus.status === 'speaking' && <p className="mt-2 text-sm text-zinc-400">Speaking…</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
