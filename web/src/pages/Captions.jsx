import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import AlertStack, { useAlerts } from '../lib/AlertToast'
import Logo from '../lib/Logo'
import Recap from '../lib/Recap'
import { api, keepAwake, useBrain } from '../lib/useBrain'
import { instantSupported, useLiveCaptions } from '../lib/useLiveCaptions'
import { getUser } from '../lib/user'
import { alertText, SEVERITY_COLOR, ZONES, zoneLabel } from '../lib/zones'

// The wearer's phone, held up like a window: camera behind, a see-through captions panel on
// the right that keeps the whole conversation and scrolls back. Tap the screen for the control
// bar; it hides itself again. Talk to change modes: "switch mode", "lecture mode",
// "add a new mode" (then describe it). Lower the phone to look at someone and Lumen marks what
// you missed while you weren't reading.

const LISTENING_FOR = {
  wearer: ['timer', 'kettle', 'doorbell', 'knock', 'phone_ring', 'smoke_alarm', 'name_called'],
  lecture: ['name_called', 'smoke_alarm', 'phone_ring'],
  outside: ['car_horn', 'siren', 'vehicle', 'bike_bell', 'person_behind', 'name_called'],
}
const MAIN_MODES = ['wearer', 'lecture', 'outside']
const SPEAKER_COLORS = ['#fbbf24', '#38bdf8', '#a78bfa', '#34d399', '#f472b6', '#fb923c']
const speakerColor = (name) => SPEAKER_COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 7) % SPEAKER_COLORS.length]
const HIDE_BAR_MS = 4000
const DOWN_BETA = 35 // phone tilted flatter than this = you're looking at the person, not the screen

const SAMPLE = [
  'Okay everyone, today we are covering photosynthesis and how plants make their own food.',
  'Photosynthesis turns light energy into chemical energy that the plant stores as glucose.',
  'It happens inside the chloroplast, and the green pigment chlorophyll is what absorbs the light.',
  'Chlorophyll reflects green light, which is exactly why leaves look green to us.',
  'The plant takes in carbon dioxide and water, and releases oxygen as a byproduct.',
  'Later the plant uses that glucose for energy and for growth, so remember glucose is the payoff.',
  'For the exam, know the inputs, the outputs, and where in the cell photosynthesis happens.',
]

const clean = (t) => t.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim()

function Words({ text }) {
  return text.split(/\s+/).filter(Boolean).map((w, i) => (
    <motion.span key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>{w} </motion.span>
  ))
}

function Radar({ recent }) {
  // Rear camera alerts glow at the bottom (behind you). One phone mic can't tell direction,
  // so sound alerts pulse the whole ring instead of pretending to point somewhere.
  return (
    <div className="relative aspect-square w-28">
      {[1, 0.6].map((s) => <div key={s} className="absolute rounded-full border border-white/20" style={{ inset: `${(1 - s) * 50}%` }} />)}
      <motion.div className="absolute inset-0 rounded-full" style={{ background: 'conic-gradient(transparent 0deg, #fbbf2433 40deg, transparent 60deg)' }}
        animate={{ rotate: 360 }} transition={{ duration: 4, repeat: Infinity, ease: 'linear' }} />
      <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400 shadow-[0_0_14px_#fbbf24]" />
      <AnimatePresence>
        {recent.map((a) => a.zone === 'behind' ? (
          <motion.div key={a.id} className="absolute bottom-0 left-1/2 -translate-x-1/2 text-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ filter: `drop-shadow(0 0 10px ${SEVERITY_COLOR[a.severity]})` }}>{alertText(a.kind).icon}</motion.div>
        ) : (
          <motion.div key={a.id} className="absolute inset-0 rounded-full border-4" style={{ borderColor: SEVERITY_COLOR[a.severity] }}
            initial={{ scale: 0.3, opacity: 1 }} animate={{ scale: 1.05, opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 1.2, repeat: 3 }} />
        ))}
      </AnimatePresence>
    </div>
  )
}

function useLookingDown(active) {
  const [down, setDown] = useState(false)
  useEffect(() => {
    if (!active) return
    const onTilt = (e) => { if (e.beta != null) setDown(Math.abs(e.beta) < DOWN_BETA) }
    window.addEventListener('deviceorientation', onTilt)
    return () => window.removeEventListener('deviceorientation', onTilt)
  }, [active])
  return down
}

export default function Captions() {
  const user = getUser()
  const { alerts, push, drop, ack } = useAlerts('wearer')
  const [started, setStarted] = useState(false)
  const [engine, setEngine] = useState(instantSupported ? 'instant' : 'private')
  const [camera, setCamera] = useState(null) // MediaStream or null
  const [bar, setBar] = useState(true)
  const [picker, setPicker] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState(null)
  const [segments, setSegments] = useState([])
  const [recap, setRecap] = useState(null)
  const [busy, setBusy] = useState(false)
  const [sim, setSim] = useState('')
  const [follow, setFollow] = useState(true)
  const [missedFrom, setMissedFrom] = useState(null) // id of the first line said while you looked away
  const [whisperOff, setWhisperOff] = useState(false)
  const scroller = useRef()
  const videoRef = useRef()
  const hideTimer = useRef()
  const lookingDown = useLookingDown(started)
  const downSince = useRef(null)

  const { state, connected } = useBrain('hud', push, (msg) => {
    if (msg.type === 'caption') captions.addRemote(msg)
    if (msg.type === 'ack') drop(msg.id)
  })
  const mode = state.modes[state.mode] ? state.mode : 'wearer'
  const realEngine = mode === 'outside' ? 'private' : engine
  const modeLabel = state.modes[mode] ?? 'Home'

  const switchMode = (key) => {
    api('/api/mode', { mode: key })
    if (key === 'lecture') setSegments([])
    setPicker(false); setAdding(false)
    flash(`${state.modes[key] ?? key} mode`)
  }
  const flash = (text) => { setNotice(text); setTimeout(() => setNotice((n) => (n === text ? null : n)), 3500) }

  const addMode = async (description) => {
    setAdding(false)
    flash('Setting up your mode…')
    const m = await api('/api/modes', { description })
    setPicker(false)
    flash(`${m.label} mode · watching for ${m.sound_kinds.map((k) => alertText(k).text.toLowerCase()).join(', ')}`)
  }

  // Voice commands. Returns true when the line was a command, so it stays out of the transcript.
  const command = (raw) => {
    const t = clean(raw)
    if (adding) { addMode(raw); return true }
    if (/\b(add|create|make)( a)? new mode\b/.test(t)) { setPicker(true); setAdding(true); return true }
    if (/\b(switch|change|show)( the)? modes?\b$|^(switch|change) mode/.test(t)) { setPicker(true); return true }
    if (picker && /\b(close|never mind|cancel)\b/.test(t)) { setPicker(false); setAdding(false); return true }
    const said = t.match(/\b(?:switch to|go to|lumen|start|turn on)\s+(?:the\s+)?([a-z]+(?: [a-z]+)?)\s+mode\b/)?.[1]
      ?? (picker ? t.replace(/ mode$/, '') : null)
    if (said) {
      const word = said === 'home' ? 'home' : said
      const key = Object.keys(state.modes).find((k) => k === word || state.modes[k].toLowerCase().includes(word))
      if (key) { switchMode(key); return true }
    }
    return false
  }

  const captions = useLiveCaptions({
    engine: realEngine,
    active: started,
    onFinal: (line) => {
      if (!line.zone && command(line.text)) return true
      if (line.zone && ZONES[line.zone]) return false // a room node: shown, but not part of the lecture
      if (mode === 'lecture') setSegments((s) => [...s, { text: line.text, ts: line.ts }])
      if (realEngine === 'instant' && !line.zone && user?.name && new RegExp(`\\b${user.name}\\b`, 'i').test(line.text)) {
        push({ id: `local-${Date.now()}`, kind: 'name_called', zone: 'wearer', severity: 'warning', ts: Date.now() / 1000 })
      }
      if (downSince.current && !missedFrom) setMissedFrom(line.id)
      return false
    },
  })

  // For rehearsing without a mic: window.lumenSay("switch mode") in the browser console.
  useEffect(() => { window.lumenSay = (t) => captions.addLine(t, { local: true }) })

  // Looking away and back: remember where you stopped reading.
  useEffect(() => {
    if (lookingDown) downSince.current = Date.now()
    else downSince.current = null
  }, [lookingDown])

  useEffect(() => {
    if (!started || realEngine !== 'private') return
    fetch('/api/memory').then((r) => r.json()).then((m) => setWhisperOff(m.models?.whisper === 'off')).catch(() => {})
  }, [started, realEngine])

  useEffect(() => {
    if (follow) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [captions.lines.length, captions.interim, sim, follow])

  useEffect(() => { if (videoRef.current) videoRef.current.srcObject = camera }, [camera])

  const showBar = () => {
    setBar(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setBar(false), HIDE_BAR_MS)
  }
  const toggleBar = () => (bar ? setBar(false) : showBar())

  const startCamera = async () => {
    try { setCamera(await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })) } catch { setCamera(null) }
  }
  const stopCamera = () => { camera?.getTracks().forEach((t) => t.stop()); setCamera(null) }

  const start = async () => {
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') await DeviceOrientationEvent.requestPermission().catch(() => {})
    await keepAwake()
    setStarted(true)
    startCamera()
    showBar()
  }

  const playSample = async () => {
    for (const sentence of SAMPLE) {
      const words = sentence.split(' ')
      for (let i = 1; i <= words.length; i++) { setSim(words.slice(0, i).join(' ')); await new Promise((r) => setTimeout(r, 90)) }
      setSim('')
      captions.addLine(sentence)
      await new Promise((r) => setTimeout(r, 350))
    }
  }

  const endLecture = async () => {
    setBusy(true)
    try { setRecap(await api('/api/recap', { segments, title: 'Lecture' })) } finally { setBusy(false) }
  }

  const download = () => {
    const text = captions.lines.map((l) => `[${new Date(l.ts * 1000).toLocaleTimeString()}] ${l.zone ? `${zoneLabel(l.zone)}: ` : ''}${l.text}`).join('\n')
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: 'lumen-transcript.txt' })
    a.click()
  }

  const jumpToMissed = () => {
    document.getElementById(`line-${missedFrom}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setFollow(false)
    setTimeout(() => setMissedFrom(null), 15000)
  }

  const onScroll = () => {
    const el = scroller.current
    setFollow(el.scrollTop + el.clientHeight >= el.scrollHeight - 60)
  }

  const recent = state.events.filter((e) => Date.now() / 1000 - e.ts < 20 && !e.acked).slice(-4)
  const live = sim || captions.interim
  const missedIndex = missedFrom ? captions.lines.findIndex((l) => l.id === missedFrom) : -1
  const missedCount = missedIndex >= 0 ? captions.lines.length - missedIndex : 0

  if (!started) {
    return (
      <main className="relative grid h-full place-items-center overflow-hidden p-6 text-center">
        <motion.div className="pointer-events-none absolute h-[480px] w-[480px] rounded-full bg-amber-500/15 blur-3xl"
          animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 4, repeat: Infinity }} />
        <div className="relative">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="mx-auto w-fit"><Logo size={72} /></motion.div>
          <h1 className="mt-4 text-4xl font-bold tracking-tight">Live captions</h1>
          <p className="mx-auto mt-2 max-w-xs text-zinc-400">Hold your phone up like a window. Words appear as they’re spoken, and Lumen watches the sounds around you.</p>
          <button onClick={start} className="mt-8 rounded-full bg-amber-400 px-8 py-3 text-lg font-semibold text-black">Start</button>
          {captions.lines.length > 0 && <p className="mt-3 text-xs text-zinc-500">{captions.lines.length} saved lines will be there when you start.</p>}
        </div>
      </main>
    )
  }

  return (
    <main className="relative h-full overflow-hidden bg-[radial-gradient(ellipse_at_top,#1c1917,#000_60%)]" onClick={toggleBar}>
      {camera && <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" />}
      <AlertStack alerts={alerts} onAck={ack} />

      {/* Top-left: who you are and what mode. Always visible, quiet. */}
      <div className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 flex max-w-[33%] items-center gap-2 overflow-hidden whitespace-nowrap rounded-full bg-black/40 px-3 py-1.5 text-sm backdrop-blur">
        <Logo size={18} />
        <span className="truncate font-medium">{modeLabel}</span>
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-green-400' : 'bg-red-500'}`} />
        {lookingDown && <span className="text-xs text-amber-300">· holding your place</span>}
      </div>
      {mode === 'outside' && <div className="absolute left-3 top-16 z-10"><Radar recent={recent} /></div>}

      <AnimatePresence>
        {notice && (
          <motion.div key={notice} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
            className="absolute left-3 top-[45%] z-20 max-w-[34%] rounded-2xl bg-black/70 p-3 text-sm backdrop-blur">{notice}</motion.div>
        )}
      </AnimatePresence>

      {/* Right: the see-through transcript. Scroll up for history; it stops following until you come back down. */}
      <section onClick={(e) => e.stopPropagation()}
        className={`absolute bottom-0 right-0 top-0 z-10 flex flex-col border-l border-white/10 bg-black/45 backdrop-blur-md ${camera ? 'w-[64%] rounded-l-3xl sm:w-[42%]' : 'w-full'}`}>
        <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
          {whisperOff && realEngine === 'private' && (
            <p className="mb-3 rounded-xl bg-amber-950/80 p-3 text-xs text-amber-200">Private captions need Whisper on the Lumen brain, and it isn’t running.{mode !== 'outside' && ' Switch to Instant.'}</p>
          )}
          {captions.error && <p className="mb-3 rounded-xl bg-red-950/80 p-3 text-xs text-red-200">{captions.error}</p>}
          {captions.lines.map((l, i) => {
            const speaker = l.zone && !ZONES[l.zone]
            const missed = missedIndex >= 0 && i >= missedIndex
            return (
              <motion.p id={`line-${l.id}`} key={l.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className={`mb-2.5 text-[17px] font-medium leading-snug ${missed ? 'border-l-2 border-amber-400 pl-2' : ''}`}>
                {l.zone && (
                  <span className="mr-1.5 align-middle text-xs font-semibold" style={{ color: speaker ? speakerColor(l.zone) : '#a1a1aa' }}>
                    {speaker ? l.zone : zoneLabel(l.zone)}
                  </span>
                )}
                {l.text}
              </motion.p>
            )
          })}
          {live && <p className="text-[17px] font-medium leading-snug text-amber-200/90"><Words text={live} /></p>}
          {!captions.lines.length && !live && (
            <p className="pt-10 text-center text-sm text-zinc-400">{captions.listening ? 'Listening… start talking.' : 'Starting the microphone…'}</p>
          )}
        </div>
        <AnimatePresence>
          {!lookingDown && missedCount > 0 && (
            <motion.button initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }} onClick={jumpToMissed}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-black shadow-lg">
              ↑ You missed {missedCount} line{missedCount > 1 ? 's' : ''}
            </motion.button>
          )}
          {!follow && missedCount === 0 && (
            <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setFollow(true)}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-zinc-800/90 px-4 py-2 text-sm">↓ Live</motion.button>
          )}
        </AnimatePresence>
      </section>

      {/* Left: mode picker. Opens by voice ("switch mode") or from the bar. */}
      <AnimatePresence>
        {picker && (
          <motion.aside onClick={(e) => e.stopPropagation()} initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className="absolute bottom-0 left-0 top-0 z-30 flex w-[72%] max-w-sm flex-col gap-2 bg-zinc-950/90 p-4 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-xl">
            <div className="text-xs uppercase tracking-widest text-amber-400">Modes</div>
            <p className="text-xs text-zinc-500">Say a mode’s name, or tap it.</p>
            {Object.entries(state.modes).filter(([k]) => k !== 'watch').map(([k, label]) => (
              <button key={k} onClick={() => switchMode(k)}
                className={`rounded-2xl px-4 py-3 text-left ${k === mode ? 'bg-amber-400 text-black' : 'bg-zinc-900'}`}>
                <div className="font-semibold">{label}</div>
                {LISTENING_FOR[k] && <div className={`text-xs ${k === mode ? 'text-black/70' : 'text-zinc-500'}`}>{LISTENING_FOR[k].map((x) => alertText(x).icon).join(' ')}</div>}
              </button>
            ))}
            {adding ? (
              <form className="mt-2 rounded-2xl border border-amber-400/50 p-3" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { addMode(draft); setDraft('') } }}>
                <div className="text-sm font-semibold">Describe your new mode</div>
                <p className="mt-1 text-xs text-zinc-400">Just say it: “cooking, and I’m waiting for a delivery.”</p>
                <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="or type it" className="mt-2 w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm outline-none" />
              </form>
            ) : (
              <button onClick={() => setAdding(true)} className="rounded-2xl border border-dashed border-zinc-700 px-4 py-3 text-left text-sm text-zinc-400">+ Add a new mode</button>
            )}
            <button onClick={() => { setPicker(false); setAdding(false) }} className="mt-auto text-sm text-zinc-500">Close</button>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Bottom control bar: tap the screen to show it, it hides itself. */}
      <AnimatePresence>
        {bar && (
          <motion.footer onClick={(e) => { e.stopPropagation(); showBar() }} initial={{ y: 100 }} animate={{ y: 0 }} exit={{ y: 100 }}
            transition={{ type: 'spring', stiffness: 400, damping: 36 }}
            className="absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 flex flex-wrap items-center gap-2 rounded-3xl bg-zinc-950/85 p-2 backdrop-blur-xl">
            <div className="flex rounded-full bg-zinc-900 p-1">
              {MAIN_MODES.map((k) => (
                <button key={k} onClick={() => switchMode(k)} className={`rounded-full px-3 py-1.5 text-sm ${mode === k ? 'bg-amber-400 font-semibold text-black' : 'text-zinc-400'}`}>
                  {{ wearer: '🏠', lecture: '🎓', outside: '🚶' }[k]}
                </button>
              ))}
              <button onClick={() => setPicker(true)} className="rounded-full px-3 py-1.5 text-sm text-zinc-400">⋯</button>
            </div>
            <button onClick={() => setEngine(engine === 'instant' ? 'private' : 'instant')} disabled={mode === 'outside'}
              className="rounded-full bg-zinc-900 px-3 py-2 text-sm">{realEngine === 'instant' ? '⚡ Instant' : '🔒 Private'}</button>
            <button onClick={camera ? stopCamera : startCamera} className="rounded-full bg-zinc-900 px-3 py-2 text-sm">{camera ? '📷 On' : '📷 Off'}</button>
            <button onClick={download} className="rounded-full bg-zinc-900 px-3 py-2 text-sm">⬇︎</button>
            {mode === 'lecture' && (
              <>
                <button onClick={playSample} className="rounded-full bg-zinc-900 px-3 py-2 text-sm">Sample</button>
                <button onClick={endLecture} disabled={busy || segments.length < 2}
                  className="rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-black disabled:opacity-40">{busy ? 'Making recap…' : 'Recap'}</button>
              </>
            )}
            {mode !== 'lecture' && LISTENING_FOR[mode] && (
              <span className="px-1 text-xs text-zinc-500">{LISTENING_FOR[mode].map((k) => alertText(k).icon).join(' ')}</span>
            )}
          </motion.footer>
        )}
      </AnimatePresence>

      {recap && <div onClick={(e) => e.stopPropagation()}><Recap recap={recap} start={segments[0]?.ts ?? Date.now() / 1000} onClose={() => setRecap(null)} /></div>}
    </main>
  )
}
