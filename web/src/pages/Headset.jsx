import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { nodeSocket, streamMic } from '../lib/audio'
import { detectFaces, FaceTracker, loadFaces, toScreen } from '../lib/faces'
import { keepAwake, useBrain } from '../lib/useBrain'
import { alertText, SEVERITY_COLOR, ZONES, zoneLabel } from '../lib/zones'

// Camera passthrough with the HUD on top. Works on iOS and Android without WebXR.
// Default is one full-screen view (hand-held, or a headset you look through with both eyes at one image).
// "Headset" mode (?vr=1 or the toggle) draws it twice, one window per lens. The window is a centered
// square, not the whole half-screen: the lens magnifies the edges most, so filling the half-screen is
// what made the picture look like a fishbowl. We don't pre-distort the image (no WebGL shader), so a
// little bend at the window edges is expected.
// Direction uses 8 coarse sectors, not a precise arrow: indoor compass error is 15-30 degrees,
// and "glow on the left" that's right beats an arrow that's visibly wrong.
//
// Live captions: the headset mic streams to the brain as the "wearer" node, Whisper sends back
// each sentence, and it appears as a speech bubble over the head of the person whose lips were
// moving (see lib/faces.js). A bubble with a "to you" tag means they were facing the wearer.
// Speech from other rooms shows as a small line at the bottom with the room name.

const SPEECH_LEVEL = 0.02 // mic loudness that counts as "someone is talking"
const TALKING = 0.04 // lip movement that counts as "this face is talking"
const BUBBLE_MS = 7000

function useHeading() {
  const [heading, setHeading] = useState(0)
  const [offset, setOffset] = useState(0)
  const start = async () => {
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
      await DeviceOrientationEvent.requestPermission().catch(() => {})
    }
    const handler = (e) => {
      const h = e.webkitCompassHeading ?? (e.absolute ? 360 - e.alpha : null)
      if (h != null) setHeading(h)
    }
    window.addEventListener('deviceorientationabsolute', handler)
    window.addEventListener('deviceorientation', handler)
  }
  // "Recenter": whatever way you face now becomes forward (bearing 0).
  const recenter = () => setOffset(heading)
  return { heading: (heading - offset + 360) % 360, start, recenter }
}

function Eye({ stream, alert, sector, people, bubbles, speaking, rooms, stereo }) {
  const ref = useRef()
  const box = useRef()
  useEffect(() => { if (ref.current && stream) ref.current.srcObject = stream }, [stream])
  const angle = sector * 45
  const at = (p) => (ref.current && box.current ? toScreen(ref.current, box.current, p.x, p.y) : { left: 0, top: 0 })
  const placed = bubbles.map((b) => ({ ...b, person: people.find((p) => p.id === b.speaker) }))
  const view = (
    <div ref={box} className={stereo ? 'relative aspect-square h-[86%] max-w-[94%] overflow-hidden rounded-[28px]' : 'relative h-full w-full overflow-hidden'}>
      <video ref={ref} autoPlay playsInline muted className="h-full w-full object-cover" />

      {/* "…" over a face whose lips move while the mic hears speech: instant feedback before the words arrive. */}
      {speaking && people.filter((p) => p.talk > TALKING && !placed.some((b) => b.person === p)).map((p) => (
        <motion.div key={`dots-${p.id}`} className="absolute -translate-x-1/2 -translate-y-full rounded-full px-3 py-1 text-xl font-bold"
          style={{ ...at(p), background: '#000c', border: `2px solid ${p.color}`, color: p.color, marginTop: -8 }}
          animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1, repeat: Infinity }}>•••</motion.div>
      ))}

      <AnimatePresence>
        {placed.filter((b) => b.person).map((b) => (
          <motion.div key={b.id} layout
            className="absolute w-max max-w-[80%] -translate-x-1/2 -translate-y-full rounded-2xl px-3 py-2 text-lg font-semibold leading-snug text-white"
            style={{ ...at(b.person), marginTop: -8, background: '#000d', border: `3px solid ${b.color}`,
              boxShadow: b.toYou ? `0 0 24px ${b.color}` : 'none' }}
            initial={{ opacity: 0, y: 10, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}>
            {b.toYou && <span className="mr-2 rounded-full px-2 text-xs font-bold text-black" style={{ background: b.color }}>TO YOU</span>}
            {b.text}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Captions with no visible speaker, and speech from other rooms. */}
      <div className="absolute inset-x-3 bottom-[8%] flex flex-col items-center gap-1">
        <AnimatePresence>
          {[...placed.filter((b) => !b.person), ...rooms].slice(-2).map((b) => (
            <motion.div key={b.id} className="max-w-full rounded-xl bg-black/80 px-3 py-1 text-center text-lg font-semibold text-white"
              style={{ borderLeft: `4px solid ${b.color ?? '#a1a1aa'}` }}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {b.room && <span className="mr-1 text-zinc-400">{b.room}:</span>}{b.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {alert && (
          <>
            <motion.div
              key="glow"
              className="pointer-events-none absolute inset-0"
              style={{ background: `radial-gradient(circle at ${50 + 50 * Math.sin((angle * Math.PI) / 180)}% ${50 - 50 * Math.cos((angle * Math.PI) / 180)}%, ${SEVERITY_COLOR[alert.severity]}cc, transparent 55%)` }}
              initial={{ opacity: 0 }} animate={{ opacity: [0.4, 1, 0.4] }} exit={{ opacity: 0 }}
              transition={{ duration: 1, repeat: Infinity }}
            />
            <motion.div key="label" className="absolute inset-x-0 bottom-[22%] text-center"
              initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }}>
              <span className="rounded-full bg-black/70 px-3 py-1 text-sm font-semibold">
                {alertText(alert.kind).icon} {alertText(alert.kind).text} · {zoneLabel(alert.zone)}
              </span>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
  return stereo ? <div className="grid h-full w-1/2 place-items-center">{view}</div> : view
}

export default function Headset() {
  const [stream, setStream] = useState(null)
  const [alert, setAlert] = useState(null)
  const [people, setPeople] = useState([])
  const [bubbles, setBubbles] = useState([])
  const [rooms, setRooms] = useState([])
  const [speaking, setSpeaking] = useState(false)
  const [stereo, setStereo] = useState(() => new URLSearchParams(location.search).has('vr'))
  const tracker = useRef(new FaceTracker())
  const node = useRef(null)
  const level = useRef(0)
  const detectVideo = useRef()
  const { heading, start, recenter } = useHeading()

  const expire = (setter, id) => setTimeout(() => setter((list) => list.filter((x) => x.id !== id)), BUBBLE_MS)
  useBrain('hud', (a) => {
    setAlert(a)
    navigator.vibrate?.([300, 100, 300])
    setTimeout(() => setAlert((cur) => (cur?.id === a.id ? null : cur)), 6000)
  }, (msg) => {
    if (msg.type !== 'caption') return
    const id = `${msg.ts}`
    if (msg.zone === 'wearer') {
      // Whoever moved their lips most while this was being said gets the bubble.
      const who = tracker.current.claim()
      setBubbles((list) => [...list, { id, text: msg.text, speaker: who?.id, color: who?.color ?? '#e4e4e7', toYou: who?.toYou }].slice(-2))
      expire(setBubbles, id)
      // Tell the brain who said it, so the dashboard and Ask Lumen know what was said *to you*.
      node.current?.send(JSON.stringify({ type: 'caption_meta', ts: msg.ts, speaker: who?.id ?? null, to_you: !!who?.toYou }))
      if (who?.toYou) navigator.vibrate?.(80)
    } else {
      setRooms((list) => [...list, { id, text: msg.text, room: ZONES[msg.zone]?.label ?? msg.zone }].slice(-2))
      expire(setRooms, id)
    }
  })

  useEffect(() => {
    if (!stream) return
    let timer, stop
    ;(async () => {
      node.current = nodeSocket(`headset-${Math.random().toString(36).slice(2, 6)}`, 'wearer')
      stop = await streamMic(node.current.send, (l) => { level.current = l }, { cleanup: true }).catch(() => null)
      detectVideo.current.srcObject = stream
      await detectVideo.current.play().catch(() => {})
      try { await loadFaces() } catch { return } // captions still work, just without bubbles over faces
      timer = setInterval(() => {
        const now = performance.now()
        const talking = level.current > SPEECH_LEVEL
        setSpeaking(talking)
        setPeople([...tracker.current.update(detectFaces(detectVideo.current, now), now, talking)].map((p) => ({ ...p })))
      }, 1000 / 15)
    })()
    return () => { clearInterval(timer); stop?.(); node.current?.close() }
  }, [stream])

  // Without a size the browser often hands back 640x480, which looks soft once it fills the screen.
  const SIZE = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }
  const [wide, setWide] = useState(false)

  const begin = async () => {
    await start()
    await keepAwake()
    setStream(await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', ...SIZE }, audio: false }))
    document.documentElement.requestFullscreen?.().catch(() => {})
  }

  // Ultra-wide shows more of the room but is softer in dim light, so it's a button, not the default.
  // Newer phones (Galaxy S2x, Pixel) expose it as zoom below 1x on the main camera; others list it as
  // a separate back camera, so we fall back to stepping through those.
  const toggleWide = async () => {
    const track = stream.getVideoTracks()[0]
    const zoom = track.getCapabilities?.().zoom
    if (zoom && zoom.min < 1) {
      await track.applyConstraints({ advanced: [{ zoom: wide ? 1 : zoom.min }] }).catch(() => {})
      setWide(!wide)
      return
    }
    const backs = (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'videoinput' && /back|rear|environment/i.test(d.label))
    if (backs.length < 2) return
    const now = backs.findIndex((d) => d.deviceId === track.getSettings().deviceId)
    const next = backs[(now + 1) % backs.length]
    const s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: next.deviceId }, ...SIZE }, audio: false }).catch(() => null)
    if (!s) return
    stream.getTracks().forEach((t) => t.stop())
    setStream(s)
    setWide((now + 1) % backs.length !== 0)
  }

  const bearing = alert ? (ZONES[alert.zone]?.bearing ?? 0) : 0
  // "Behind you" comes from the rear camera, which turns with you: always the bottom edge.
  const sector = alert?.zone === 'behind' ? 4 : Math.round(((bearing - heading + 360) % 360) / 45) % 8

  if (!stream) {
    return (
      <button onClick={begin} className="grid h-full w-full place-items-center text-2xl">
        Tap to start headset view
      </button>
    )
  }
  return (
    <div className="relative flex h-full bg-black" onDoubleClick={recenter}>
      <video ref={detectVideo} playsInline muted className="pointer-events-none absolute h-px w-px opacity-0" />
      <Eye stream={stream} alert={alert} sector={sector} people={people} bubbles={bubbles} speaking={speaking} rooms={rooms} stereo={stereo} />
      {stereo && <Eye stream={stream} alert={alert} sector={sector} people={people} bubbles={bubbles} speaking={speaking} rooms={rooms} stereo />}
      <div className="absolute right-3 top-3 flex gap-2 text-xs font-medium tracking-wide text-zinc-300">
        <button onClick={toggleWide} className="rounded-full bg-black/60 px-3 py-1">{wide ? '1x' : 'Wide'}</button>
        <button onClick={() => setStereo((v) => !v)} className="rounded-full bg-black/60 px-3 py-1">
          {stereo ? 'Single view' : 'Headset'}
        </button>
      </div>
    </div>
  )
}
