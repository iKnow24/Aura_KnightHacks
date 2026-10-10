import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import AlertStack, { useAlerts } from '../lib/AlertToast'
import Logo from '../lib/Logo'
import Recap from '../lib/Recap'
import { api, keepAwake, useBrain } from '../lib/useBrain'
import { instantSupported, useLiveCaptions } from '../lib/useLiveCaptions'
import { getUser } from '../lib/user'
import { alertText, SEVERITY_COLOR, zoneLabel } from '../lib/zones'

// The wearer's screen: live captions with Lumen's alerts on top. Works on its own in a phone,
// or held next to the headset. Three modes, one tap each:
//   Home     captions + the everyday sounds (timer, kettle, door) from the room phones
//   Lecture  captions only, nothing interrupts but a fire alarm; ends with a recap + quiz
//   Outside  street sounds from this phone's mic + the rear camera phone watching behind you
const TABS = [
  ['wearer', 'Home', '🏠'],
  ['lecture', 'Lecture', '🎓'],
  ['outside', 'Outside', '🚶'],
]

const LISTENING_FOR = {
  wearer: ['timer', 'kettle', 'doorbell', 'knock', 'phone_ring', 'smoke_alarm', 'water_running', 'name_called'],
  lecture: ['name_called', 'smoke_alarm', 'phone_ring'],
  outside: ['car_horn', 'siren', 'vehicle', 'bike_bell', 'reversing', 'person_behind', 'name_called'],
}

// For rehearsing the recap without a lecturer in the room.
const SAMPLE = [
  'Okay everyone, today we are covering photosynthesis and how plants make their own food.',
  'Photosynthesis turns light energy into chemical energy that the plant stores as glucose.',
  'It happens inside the chloroplast, and the green pigment chlorophyll is what absorbs the light.',
  'Chlorophyll reflects green light, which is exactly why leaves look green to us.',
  'The plant takes in carbon dioxide and water, and releases oxygen as a byproduct.',
  'Later the plant uses that glucose for energy and for growth, so remember glucose is the payoff.',
  'For the exam, know the inputs, the outputs, and where in the cell photosynthesis happens.',
]

function Words({ text }) {
  // Interim words fade up one by one as the recognizer hears them.
  return text.split(/\s+/).filter(Boolean).map((w, i) => (
    <motion.span key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
      {w}{' '}
    </motion.span>
  ))
}

function Radar({ recent }) {
  // You are the dot in the middle. Rear camera alerts glow at the bottom (behind you).
  // A single phone mic can't tell direction, so sound alerts pulse the whole ring instead
  // of pretending to point somewhere.
  return (
    <div className="relative mx-auto aspect-square w-56">
      {[1, 0.66, 0.33].map((s) => (
        <div key={s} className="absolute rounded-full border border-zinc-800" style={{ inset: `${(1 - s) * 50}%` }} />
      ))}
      <motion.div className="absolute inset-0 rounded-full" style={{ background: 'conic-gradient(from 0deg, transparent 0deg, #fbbf2422 40deg, transparent 60deg)' }}
        animate={{ rotate: 360 }} transition={{ duration: 4, repeat: Infinity, ease: 'linear' }} />
      <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400 shadow-[0_0_20px_#fbbf24]" />
      <div className="absolute left-1/2 top-1 -translate-x-1/2 text-[10px] text-zinc-600">ahead</div>
      <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] text-zinc-600">behind</div>
      <AnimatePresence>
        {recent.map((a) => {
          const color = SEVERITY_COLOR[a.severity]
          if (a.zone === 'behind') {
            return (
              <motion.div key={a.id} className="absolute bottom-[8%] left-1/2 -translate-x-1/2 text-3xl"
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                style={{ filter: `drop-shadow(0 0 12px ${color})` }}>
                {alertText(a.kind).icon}
              </motion.div>
            )
          }
          return (
            <motion.div key={a.id} className="absolute inset-0 rounded-full border-4" style={{ borderColor: color }}
              initial={{ scale: 0.3, opacity: 1 }} animate={{ scale: 1.05, opacity: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 1.2, repeat: 3 }} />
          )
        })}
      </AnimatePresence>
    </div>
  )
}

export default function Captions() {
  const user = getUser()
  const { alerts, push, drop, ack } = useAlerts('wearer')
  const [started, setStarted] = useState(false)
  const [engine, setEngine] = useState(instantSupported ? 'instant' : 'private')
  const [segments, setSegments] = useState([])
  const [recap, setRecap] = useState(null)
  const [busy, setBusy] = useState(false)
  const [sim, setSim] = useState('')
  const scroller = useRef()

  const { state, connected } = useBrain('hud', push, (msg) => {
    if (msg.type === 'caption') captions.addRemote(msg)
    if (msg.type === 'ack') drop(msg.id)
  })
  const mode = TABS.some(([k]) => k === state.mode) ? state.mode : 'wearer'
  const realEngine = mode === 'outside' ? 'private' : engine

  const captions = useLiveCaptions({
    engine: realEngine,
    active: started,
    onFinal: (line) => {
      if (line.zone) return // another room's node, not the person in front of you
      if (mode === 'lecture') setSegments((s) => [...s, { text: line.text, ts: line.ts }])
      // The brain already listens for your name in Private mode; Instant mode checks here.
      if (realEngine === 'instant' && user?.name && new RegExp(`\\b${user.name}\\b`, 'i').test(line.text)) {
        push({ id: `local-${Date.now()}`, kind: 'name_called', zone: 'wearer', severity: 'warning', ts: Date.now() / 1000 })
      }
    },
  })

  // Private captions need Whisper running on the brain. Say so instead of waiting forever.
  const [whisperOff, setWhisperOff] = useState(false)
  useEffect(() => {
    if (!started || realEngine !== 'private') return
    fetch('/api/memory').then((r) => r.json()).then((m) => setWhisperOff(m.models?.whisper === 'off')).catch(() => {})
  }, [started, realEngine])

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }) },
    [captions.lines.length, captions.interim, sim])

  const start = async () => { await keepAwake(); setStarted(true) }
  const switchMode = (m) => { api('/api/mode', { mode: m }); if (m === 'lecture') setSegments([]) }

  const playSample = async () => {
    for (const sentence of SAMPLE) {
      const words = sentence.split(' ')
      for (let i = 1; i <= words.length; i++) {
        setSim(words.slice(0, i).join(' '))
        await new Promise((r) => setTimeout(r, 90))
      }
      setSim('')
      captions.addLine(sentence)
      await new Promise((r) => setTimeout(r, 350))
    }
  }

  const endLecture = async () => {
    setBusy(true)
    try { setRecap(await api('/api/recap', { segments, title: 'Lecture' })) } finally { setBusy(false) }
  }

  const recent = state.events.filter((e) => Date.now() / 1000 - e.ts < 20 && !e.acked).slice(-4)
  const live = sim || captions.interim
  const lines = captions.lines.slice(mode === 'lecture' ? -200 : -6)

  if (!started) {
    return (
      <main className="relative grid h-full place-items-center overflow-hidden p-6 text-center">
        <motion.div className="pointer-events-none absolute h-[480px] w-[480px] rounded-full bg-amber-500/15 blur-3xl"
          animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 4, repeat: Infinity }} />
        <div className="relative">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="mx-auto w-fit"><Logo size={72} /></motion.div>
          <h1 className="mt-4 text-4xl font-bold tracking-tight">Live captions</h1>
          <p className="mx-auto mt-2 max-w-xs text-zinc-400">Words as they’re spoken, and the sounds around you, on one screen.</p>
          <button onClick={start} className="mt-8 rounded-full bg-amber-400 px-8 py-3 text-lg font-semibold text-black">Start listening</button>
        </div>
      </main>
    )
  }

  return (
    <main className="flex h-full flex-col bg-[radial-gradient(ellipse_at_top,#1c1917,#000_60%)]">
      <AlertStack alerts={alerts} onAck={ack} />

      <header className="flex items-center gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <Logo size={26} />
        <span className="font-semibold">Lumen</span>
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-500'}`} title={connected ? 'connected' : 'offline'} />
        <div className="ml-auto flex rounded-full bg-zinc-900 p-1 text-sm">
          {['instant', 'private'].map((e) => (
            <button key={e} onClick={() => setEngine(e)} disabled={mode === 'outside'}
              className={`rounded-full px-3 py-1 capitalize ${realEngine === e ? 'bg-zinc-700' : 'text-zinc-500'}`}>
              {e === 'instant' ? '⚡ Instant' : '🔒 Private'}
            </button>
          ))}
        </div>
      </header>

      <nav className="mx-4 mt-4 grid grid-cols-3 gap-1 rounded-2xl bg-zinc-900/80 p-1">
        {TABS.map(([k, label, icon]) => (
          <button key={k} onClick={() => switchMode(k)} className="relative rounded-xl py-2 text-sm font-medium">
            {mode === k && <motion.span layoutId="tab" className="absolute inset-0 rounded-xl bg-amber-400" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />}
            <span className={`relative ${mode === k ? 'text-black' : 'text-zinc-400'}`}>{icon} {label}</span>
          </button>
        ))}
      </nav>

      {mode === 'outside' && <div className="mt-6"><Radar recent={recent} /></div>}

      <section ref={scroller} className={`flex-1 overflow-y-auto px-5 ${mode === 'lecture' ? 'pt-6' : 'flex flex-col justify-end pb-4'}`}>
        {whisperOff && realEngine === 'private' && (
          <p className="mb-4 rounded-xl bg-amber-950 p-3 text-sm text-amber-200">
            Private captions need Whisper on the Lumen brain, and it isn’t running here.{mode !== 'outside' && ' Switch to Instant.'}
          </p>
        )}
        {captions.error && <p className="mb-4 rounded-xl bg-red-950 p-3 text-sm text-red-200">{captions.error}</p>}
        <AnimatePresence initial={false}>
          {lines.map((l, i) => {
            const age = lines.length - 1 - i
            return (
              <motion.p key={l.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: mode === 'lecture' ? 1 : Math.max(0.25, 1 - age * 0.18), y: 0 }}
                className={`mb-3 font-medium leading-snug ${mode === 'lecture' ? 'text-xl text-zinc-200' : mode === 'outside' ? 'text-xl' : 'text-3xl'}`}>
                {l.zone && <span className="mr-2 rounded-full bg-zinc-800 px-2 py-0.5 align-middle text-xs text-zinc-400">{zoneLabel(l.zone)}</span>}
                {l.text}
              </motion.p>
            )
          })}
        </AnimatePresence>
        {live && (
          <p className={`font-medium leading-snug text-amber-200/80 ${mode === 'home' || mode === 'wearer' ? 'text-3xl' : 'text-xl'}`}><Words text={live} /></p>
        )}
        {!lines.length && !live && (
          <p className="text-center text-zinc-600">
            {captions.listening ? 'Listening… start talking.' : 'Starting the microphone…'}
          </p>
        )}
      </section>

      <footer className="border-t border-zinc-900 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        {mode === 'lecture' ? (
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap text-xs text-zinc-500">{segments.length} lines</span>
            <button onClick={playSample} className="ml-auto whitespace-nowrap rounded-full bg-zinc-800 px-3 py-2 text-sm">Sample</button>
            <button onClick={endLecture} disabled={busy || segments.length < 2}
              className="whitespace-nowrap rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-black disabled:opacity-40">
              {busy ? 'Making recap…' : 'End → Recap'}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-zinc-500">Watching for</span>
            {LISTENING_FOR[mode].map((k) => (
              <span key={k} className="rounded-full bg-zinc-900 px-2 py-1 text-xs text-zinc-300">{alertText(k).icon} {alertText(k).text}</span>
            ))}
          </div>
        )}
      </footer>

      {recap && <Recap recap={recap} start={segments[0]?.ts ?? Date.now() / 1000} onClose={() => setRecap(null)} />}
    </main>
  )
}
