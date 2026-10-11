import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import AlertStack, { useAlerts } from '../lib/AlertToast'
import { detectFaces, loadFaces } from '../lib/faces'
import { FaceTracker } from '../lib/faceTracker'
import { lastTwoLines } from '../lib/captionText'
import SpatialCaptions from '../lib/SpatialCaptions'
import { pickSpeaker } from '../lib/speakerMatch'
import { Camera, CameraOff, Clapperboard, Download, Ellipsis, Footprints, GraduationCap, House, Lock, Zap } from 'lucide-react'
import Logo from '../lib/Logo'
import Recap from '../lib/Recap'
import Surround from '../lib/Surround'
import { api, keepAwake, useBrain } from '../lib/useBrain'
import { instantSupported, useLiveCaptions } from '../lib/useLiveCaptions'
import { getUser } from '../lib/user'
import { askMotion } from '../lib/walking'
import { alertText, SEVERITY_COLOR, ZONES, zoneLabel } from '../lib/zones'

// The wearer's phone, held up like a window: camera behind, and each line floats above the head of
// the person who said it (spatial captions). Lines no face can be matched to sit in a neutral spot
// at the bottom; the Movie look shows classic subtitles instead. The full transcript is still kept
// (download button, dashboard). Tap the screen for the control bar; it hides itself again.
// Talk to change modes: "switch mode", "lecture mode", "add a new mode" (then describe it).

const LISTENING_FOR = {
  wearer: ['timer', 'kettle', 'doorbell', 'knock', 'phone_ring', 'smoke_alarm', 'name_called'],
  lecture: ['name_called', 'smoke_alarm', 'phone_ring'],
  outside: ['car_horn', 'siren', 'vehicle', 'bike_bell', 'person_behind', 'name_called'],
}
const MAIN_MODES = ['wearer', 'lecture', 'outside']
const HIDE_BAR_MS = 4000
const SPEECH_LEVEL = 0.02 // mic loudness that counts as speech (Private engine)
const HOLD_S = 5 // a spatial caption stays up this long after its last word
const FACE_MS = 66 // face tracking at about 15 frames a second
// "Hi, I'm Adam" / "my name is Adam". A capital letter is required after the weak cues ("I'm going"
// isn't a name); after "my name is" the recognizer's lowercase is trusted.
const NAME_RE = /\b(?:[Mm]y name's|[Nn]ame's|I'm|I am|[Cc]all me|[Tt]his is)\s+([A-Z][a-z]{2,})/
const MY_NAME_IS = /\bmy name is\s+([a-z]{3,})/i
const NOT_NAMES = new Set(['Going', 'Not', 'Just', 'Sure', 'Sorry', 'Good', 'Fine', 'Okay', 'So', 'Here', 'Really', 'Glad',
  'Done', 'Back', 'Trying', 'Looking', 'Talking', 'Very', 'The', 'From', 'Your', 'What', 'Lumen'])
export function nameIn(text) {
  const m = text.match(MY_NAME_IS)?.[1] ?? text.match(NAME_RE)?.[1]
  if (!m) return null
  const name = m[0].toUpperCase() + m.slice(1).toLowerCase()
  return NOT_NAMES.has(name) ? null : name
}

// Two transcripts of one sentence (Google on this phone, Whisper on the room phone): most words in common.
function sameWords(a, b) {
  const words = (t) => new Set(t.toLowerCase().match(/[a-z']+/g) ?? [])
  const x = words(a), y = words(b)
  const common = [...x].filter((w) => y.has(w)).length
  return common >= 3 && common / Math.max(x.size, y.size) >= 0.5
}

// Movie captions: how cinemas and streaming subtitles for deaf viewers (SDH) look. White sans,
// soft black outline, centered at the bottom, two lines at most, NAME: when we know who's talking,
// and [SOUNDS IN BRACKETS] for what you can't hear.
const CINEMA_TEXT = {
  fontFamily: 'Arial, Helvetica, sans-serif',
  color: '#fff',
  fontWeight: 600,
  fontSize: 'clamp(20px, 5.6vw, 36px)',
  lineHeight: 1.25,
  textShadow: '0 0 3px #000, 0 0 6px #000, 1px 1px 2px #000, -1px -1px 2px #000',
}
const CINEMA_HOLD_S = 5 // a subtitle stays up this long after the last word, then clears
const SOUND_CUE = {
  smoke_alarm: 'ALARM BLARING', doorbell: 'DOORBELL RINGS', timer: 'TIMER BEEPING', kettle: 'KETTLE WHISTLING',
  phone_ring: 'PHONE RINGING', knock: 'KNOCKING', alarm_clock: 'ALARM CLOCK RINGING', water_running: 'WATER RUNNING',
  dog_bark: 'DOG BARKING', car_horn: 'CAR HORN HONKS', siren: 'SIREN WAILING', vehicle: 'CAR APPROACHING',
  bike_bell: 'BIKE BELL RINGS', reversing: 'TRUCK REVERSING', glass_break: 'GLASS SHATTERS', baby_cry: 'BABY CRYING',
  name_called: 'SOMEONE CALLS YOUR NAME', person_behind: 'FOOTSTEPS BEHIND YOU', vehicle_behind: 'VEHICLE BEHIND YOU',
}

function tail(text, maxChars) {
  if (text.length <= maxChars) return text
  const cut = text.slice(-maxChars)
  return cut.slice(cut.indexOf(' ') + 1)
}

function CinemaCaptions({ lines, live, names, recent }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t) }, [])
  const last = lines[lines.length - 1]
  const fresh = last && Date.now() / 1000 - last.ts < CINEMA_HOLD_S
  const who = (l) => (l?.speaker && names[l.speaker.id]) || l?.voice || (l?.zone && !ZONES[l.zone] ? l.zone : null)
  const text = live || (fresh ? last.text : '')
  const speaker = live ? null : who(last)
  // About 2 lines' worth for this screen width, keeping the newest words.
  const perLine = Math.max(28, Math.floor(window.innerWidth / 11.5))
  const shown = tail(text, perLine * 2 - (speaker ? speaker.length + 2 : 0))
  const cues = recent.filter((a) => Date.now() / 1000 - a.ts < 6 && SOUND_CUE[a.kind])
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[11%] z-10 flex flex-col items-center gap-1 px-[6%] text-center">
      <AnimatePresence>
        {cues.slice(-1).map((a) => (
          <motion.div key={a.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ ...CINEMA_TEXT, fontStyle: 'italic' }}>
            [{SOUND_CUE[a.kind]}]
          </motion.div>
        ))}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        {shown && (
          <motion.div key={live ? 'live' : last.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }} style={CINEMA_TEXT} className="max-w-[36ch]">
            {speaker && <span>{speaker.toUpperCase()}: </span>}{shown}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

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

// Faces in the held-up phone's camera, tracked on the phone (no video or face data leaves it).
// Each stretch of speech is timed on the same clock as the camera, so a finished line is matched
// to the mouth that moved while it was being said (speakerMatch.js).
function useFaceTracks(videoRef, active, speechActive) {
  const tracker = useRef(new FaceTracker())
  const tracksRef = useRef([])
  const [ids, setIds] = useState('') // re-render only when someone enters or leaves
  const [liveSpeaker, setLiveSpeaker] = useState(null)
  const speechStart = useRef(null)
  const speaking = useRef(speechActive)
  speaking.current = speechActive
  useEffect(() => {
    if (!active) { tracksRef.current = []; setIds(''); return }
    let timer, dead = false, last = ''
    loadFaces().then(() => {
      if (dead) return
      timer = setInterval(() => {
        const v = videoRef.current
        if (!v || v.readyState < 2 || document.hidden) return
        const now = performance.now()
        const tracks = tracker.current.update(detectFaces(v, now), now)
        tracksRef.current = tracks
        const key = tracks.map((t) => t.id).join(',')
        if (key !== last) { last = key; setIds(key) }
        if (speaking.current()) speechStart.current ??= now
        // While words are still coming in: whose mouth is moving with them (null = not sure yet).
        const who = speechStart.current == null ? null : pickSpeaker(tracker.current.tracks, speechStart.current, now)?.id ?? null
        setLiveSpeaker((p) => (p === who ? p : who))
      }, FACE_MS)
    }).catch(() => {})
    return () => { dead = true; clearInterval(timer) }
  }, [active, videoRef])
  // A finished line: match it to the speech just heard, then start timing the next one.
  const claim = () => {
    const now = performance.now()
    const start = (speechStart.current ?? now - 4000) - 300
    speechStart.current = speaking.current() ? now : null
    setLiveSpeaker(null)
    return pickSpeaker(tracker.current.tracks, start, now)
  }
  return { tracksRef, ids, liveSpeaker, claim }
}

// What goes where in the spatial view. Wearer-mic lines matched to a face float over that face
// while it's in view; everything else, and anything not matched confidently, goes to the neutral
// spot. Only the last few seconds show; the transcript itself is kept (download, dashboard).
function spatialLayout({ lines, live, liveSpeaker, visible, names, events }) {
  const now = Date.now() / 1000
  const perLine = Math.max(24, Math.floor(Math.min(window.innerWidth * 0.78, 384) / 10.5))
  const fresh = lines.filter((l) => now - l.ts < HOLD_S)
  const label = (l) => (l.speaker && names[l.speaker.id]) || l.voice || (l.zone ? (ZONES[l.zone] ? zoneLabel(l.zone) : l.zone) : null)
  const bubbles = []
  for (const id of visible) {
    const talkingNow = !!live && liveSpeaker === id
    const own = fresh.findLast((l) => l.speaker?.id === id && !l.zone)
    const text = talkingNow ? live : own?.text
    if (!text) continue
    bubbles.push({ trackId: id, key: id, text: lastTwoLines(text, perLine), live: talkingNow, name: names[id] ?? own?.voice,
      color: own?.speaker.color ?? '#f4f4f5', toYou: !talkingNow && own?.speaker.toYou })
  }
  const placed = new Set(bubbles.map((b) => b.trackId))
  let neutral = null
  if (live && !placed.has(liveSpeaker)) neutral = { key: 'live', text: lastTwoLines(live, perLine + 8), live: true }
  else if (!live) {
    const last = fresh.at(-1)
    if (last && !(last.speaker && !last.zone && placed.has(last.speaker.id))) {
      neutral = { key: last.id, text: lastTwoLines(last.text, perLine + 8), name: label(last) }
    }
  }
  const sound = events.filter((a) => now - a.ts < 6 && SOUND_CUE[a.kind]).at(-1)
  return { bubbles, neutral, cue: sound && { key: sound.id, text: SOUND_CUE[sound.kind] } }
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

// True while the phone is held upright; updates when it rotates.
function usePortrait() {
  const query = '(orientation: portrait)'
  const [portrait, setPortrait] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const onChange = () => setPortrait(m.matches)
    m.addEventListener('change', onChange)
    return () => m.removeEventListener('change', onChange)
  }, [])
  return portrait
}

export default function Captions() {
  const portrait = usePortrait()
  const user = getUser()
  const { alerts, push, drop, ack } = useAlerts('wearer')
  const [started, setStarted] = useState(false)
  const [rearScene, setRearScene] = useState(null) // what the bag phone's camera sees, for the walking view
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
  const [whisperOff, setWhisperOff] = useState(false)
  const videoRef = useRef()
  const hideTimer = useRef()
  const lookingDown = useLookingDown(started)
  const lastInterim = useRef(0)
  const [names, setNames] = useState({}) // face track id -> name they said ("I'm Dana") or their voice is known by
  const linesRef = useRef([])
  // 'spatial' (captions over heads) or 'cinema' (movie subtitles). The old side panel is gone.
  const [look, setLook] = useState(() => { try { return localStorage.getItem('lumen_look') === 'cinema' ? 'cinema' : 'spatial' } catch { return 'spatial' } })
  const [, tick] = useState(0) // spatial captions expire on their own, so re-check twice a second
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(t) }, [])
  useEffect(() => { try { localStorage.setItem('lumen_look', look) } catch { /* private mode */ } }, [look])
  const levelRef = useRef(0)

  const { state, connected } = useBrain('hud', push, (msg) => {
    if (msg.type === 'caption') captions.addRemote(msg)
    if (msg.type === 'caption_partial' && !ZONES[msg.zone]) captions.addPartial(msg) // room nodes only get finished lines
    if (msg.type === 'scene' && msg.side === 'rear') setRearScene({ ...msg, at: Date.now() })
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
    if (/\b(movie|cinema|subtitles?) (mode|captions|style|view)\b/.test(t)) { setLook('cinema'); flash('🎬 Movie captions'); return true }
    if (/\b(normal|panel|transcript|regular|spatial) (mode|captions|style|view)\b/.test(t)) { setLook('spatial'); flash('Spatial captions'); return true }
    const said = t.match(/\b(?:switch to|go to|lumen|start|turn on)\s+(?:the\s+)?([a-z]+(?: [a-z]+)?)\s+mode\b/)?.[1]
      ?? (picker ? t.replace(/ mode$/, '') : null)
    if (said) {
      const word = said === 'home' ? 'home' : said
      const key = Object.keys(state.modes).find((k) => k === word || state.modes[k].toLowerCase().includes(word))
      if (key) { switchMode(key); return true }
    }
    return false
  }

  const faces = useFaceTracks(videoRef, started && !!camera,
    () => Date.now() - lastInterim.current < 700 || levelRef.current > SPEECH_LEVEL)

  const captions = useLiveCaptions({
    engine: realEngine,
    active: started,
    onFinal: (line) => {
      if (!line.zone && command(line.text)) return true
      if (line.zone && ZONES[line.zone]) { // a room node: shown, but not part of the lecture
        // Instant mode: the brain never hears this phone's mic, but the room phone heard the same sentence and
        // knows the voice. Put that name on the face whose lips moved for it.
        const mine = line.voiceKnown && linesRef.current.findLast((l) => !l.zone && l.speaker && line.ts - l.ts < 8 && sameWords(l.text, line.text))
        if (mine && names[mine.speaker.id] !== line.voice) { setNames((n) => ({ ...n, [mine.speaker.id]: line.voice })); flash(`👋 That's ${line.voice}`) }
        return false
      }
      if (!line.zone && camera) {
        const who = faces.claim()
        if (who) {
          line.speaker = who
          // A name they said ("my name is Dana"), else the name the brain knows their voice by.
          const said = nameIn(line.text) ?? (line.voiceKnown ? line.voice : null)
          if (said && names[who.id] !== said) {
            setNames((n) => ({ ...n, [who.id]: said }))
            flash(`👋 Met ${said}`)
          }
        }
      }
      if (mode === 'lecture') setSegments((s) => [...s, { text: line.text, ts: line.ts }])
      if (realEngine === 'instant' && !line.zone && user?.name && new RegExp(`\\b${user.name}\\b`, 'i').test(line.text)) {
        push({ id: `local-${Date.now()}`, kind: 'name_called', zone: 'wearer', severity: 'warning', ts: Date.now() / 1000 })
      }
      return false
    },
  })

  linesRef.current = captions.lines
  useEffect(() => { if (captions.interim) lastInterim.current = Date.now() }, [captions.interim])
  useEffect(() => { levelRef.current = captions.level }, [captions.level])

  // For rehearsing without a mic: window.lumenSay("switch mode") in the browser console.
  useEffect(() => { window.lumenSay = (t) => captions.addLine(t, { local: true }) })

  useEffect(() => {
    if (!started || realEngine !== 'private') return
    fetch('/api/memory').then((r) => r.json()).then((m) => setWhisperOff(m.models?.whisper === 'off')).catch(() => {})
  }, [started, realEngine])

  useEffect(() => { if (videoRef.current) videoRef.current.srcObject = camera }, [camera])

  const showBar = () => {
    setBar(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setBar(false), HIDE_BAR_MS)
  }
  const toggleBar = () => (bar ? setBar(false) : showBar())

  const startCamera = async () => {
    try { setCamera(await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })) } catch { setCamera(null) }
  }
  const stopCamera = () => { camera?.getTracks().forEach((t) => t.stop()); setCamera(null) }

  const start = async () => {
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') await DeviceOrientationEvent.requestPermission().catch(() => {})
    await askMotion()
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

  const recent = state.events.filter((e) => Date.now() / 1000 - e.ts < 20 && !e.acked).slice(-4)
  const live = sim || captions.interim
  const spatial = spatialLayout({ lines: captions.lines, live, liveSpeaker: camera ? faces.liveSpeaker : null,
    visible: camera ? faces.ids.split(',').filter(Boolean).map(Number) : [], names, events: state.events })

  if (!started) {
    return (
      <main className="relative grid h-full place-items-center overflow-hidden p-6 text-center">
        <div className="relative">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1 }} className="mx-auto w-fit"><Logo size={64} live /></motion.div>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight">Live captions</h1>
          <p className="mx-auto mt-2 max-w-xs text-zinc-400">Hold your phone up like a window. Words appear as they’re spoken, and Lumen watches the sounds around you.</p>
          <button onClick={start} className="mt-10 rounded-md bg-amber-400 px-12 py-3 font-semibold text-black">Start</button>
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
      <div className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 flex max-w-[33%] items-center gap-2 overflow-hidden whitespace-nowrap glass-dark rounded-full px-3 py-1.5 text-sm">
        <Logo size={18} />
        <span className="truncate font-medium">{modeLabel}</span>
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-green-400' : 'bg-red-500'}`} />
        {lookingDown && <span className="text-xs text-amber-300">· holding your place</span>}
      </div>
      {mode === 'outside' && <div className="absolute left-3 top-16 z-10"><Radar recent={recent} /></div>}
      {/* The walking view only shows in landscape; in portrait it would cover the people being captioned.
          Not mounted at all in portrait, so its 3D scene and object detector don't run for nothing. */}
      {camera && !portrait && <Surround videoRef={videoRef} active={started} rear={rearScene} raised={bar} />}

      <AnimatePresence>
        {notice && (
          <motion.div key={notice} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
            className="absolute left-3 top-[45%] z-20 max-w-[34%] glass-dark rounded-2xl p-3 text-sm">{notice}</motion.div>
        )}
      </AnimatePresence>

      {look === 'cinema' ? (
        <CinemaCaptions lines={captions.lines} live={live} names={names} recent={state.events} />
      ) : (
        <SpatialCaptions videoRef={videoRef} tracksRef={faces.tracksRef} bubbles={spatial.bubbles} cue={spatial.cue} raised={bar}
          neutral={spatial.neutral ?? (!captions.lines.length && !live
            ? { key: 'status', text: captions.listening ? 'Listening… start talking.' : 'Starting the microphone…' } : null)} />
      )}
      {/* Problems with the captions themselves, where they can't be missed. */}
      {(captions.error || (whisperOff && realEngine === 'private')) && (
        <p className="absolute inset-x-0 top-[max(3.5rem,calc(env(safe-area-inset-top)+3rem))] z-20 mx-auto w-fit max-w-[90%] glass-dark rounded-xl p-3 text-center text-sm text-amber-200">
          {captions.error ?? `Private captions need Whisper on the Lumen brain, and it isn’t running.${mode !== 'outside' ? ' Switch to Instant.' : ''}`}
        </p>
      )}

      {/* Left: mode picker. Opens by voice ("switch mode") or from the bar. */}
      <AnimatePresence>
        {picker && (
          <motion.aside onClick={(e) => e.stopPropagation()} initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className="absolute bottom-0 left-0 top-0 z-30 flex w-[72%] max-w-sm flex-col gap-2 glass-dark p-4 pt-[max(1rem,env(safe-area-inset-top))]">
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
            className="absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 flex flex-wrap items-center gap-2 glass-dark rounded-[28px] p-2">
            <div className="flex rounded-full bg-zinc-900 p-1">
              {MAIN_MODES.map((k) => (
                <button key={k} onClick={() => switchMode(k)} className={`rounded-full px-3 py-1.5 text-sm ${mode === k ? 'bg-amber-400 font-semibold text-black' : 'text-zinc-400'}`}>
                  {{ wearer: <House size={18} />, lecture: <GraduationCap size={18} />, outside: <Footprints size={18} /> }[k]}
                </button>
              ))}
              <button onClick={() => setPicker(true)} className="rounded-full px-3 py-1.5 text-sm text-zinc-400"><Ellipsis size={18} /></button>
            </div>
            <button onClick={() => setEngine(engine === 'instant' ? 'private' : 'instant')} disabled={mode === 'outside'}
              className="flex items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-2 text-sm">{realEngine === 'instant' ? <><Zap size={15} /> Instant</> : <><Lock size={15} /> Private</>}</button>
            <button onClick={camera ? stopCamera : startCamera} className="flex items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-2 text-sm">{camera ? <><Camera size={15} /> On</> : <><CameraOff size={15} /> Off</>}</button>
            <button onClick={() => setLook(look === 'cinema' ? 'panel' : 'cinema')} className={`rounded-full px-3 py-2 text-sm ${look === 'cinema' ? 'bg-white text-black' : 'bg-zinc-900'}`}><Clapperboard size={16} /></button>
            <button onClick={download} className="rounded-full bg-zinc-900 px-3 py-2 text-sm"><Download size={16} /></button>
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
