import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion'
import { Maximize2, RefreshCw, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { nodeSocket } from './audio'
import { loadDetector } from './surroundings'
import { assign, closeCameras, fillSlots, listCameras, localSource, openCamera, phoneSource } from './cameras'
import { attachMic } from './mic'
import HazardNote from './HazardNote'
import TalkingHeads from './TalkingHeads'
import { alertText, SEVERITY_COLOR, zoneLabel } from './zones'

const STORE = 'lumen.wall'
const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {} } catch { return {} } }
const save = (slots) => { try { localStorage.setItem(STORE, JSON.stringify(slots)) } catch { /* private window */ } }

// Laptop cameras, refreshed when one is plugged in or unplugged.
export function useLaptopCameras() {
  const [cams, setCams] = useState([])
  const [error, setError] = useState(null)
  const refresh = (ask = false) => listCameras(ask).then((c) => { setCams(c); setError(null) })
    .catch((e) => setError(e.name === 'NotAllowedError' ? 'Camera access was blocked. Allow it in the browser and try again.' : e.message))
  useEffect(() => {
    refresh(true)
    const md = navigator.mediaDevices
    md?.addEventListener?.('devicechange', refresh)
    return () => { md?.removeEventListener?.('devicechange', refresh); closeCameras() }
  }, [])
  return { cams, error, refresh }
}

// The control center's camera wall: one big main view and a camera on each side.
// Click a side camera (or press 1 / 2) to swap it into the main view; each tile's menu picks any source.
// The main view is a 3D stage wired to the brain: what OWLv2 sees on the AMD GPU (and how long it took)
// runs along its bottom, alerts light up its edge, and clicking it opens it full screen (Esc closes).
// Returns the three tiles plus the full-screen layer so the dashboard can place them in its own grid.
export function useCameraWall({ nodes, previews, now, connected, cams, camError, onAskCameras, alert }) {
  const sources = useMemo(() => {
    const phones = [...new Set(Object.entries(nodes).filter(([id, n]) => id !== 'mac-webcam' && now - n.last_seen < 10).map(([, n]) => n.zone))]
      .sort((a, b) => Number(b === 'wearer') - Number(a === 'wearer'))
      .map((zone) => ({ id: phoneSource(zone), label: phoneLabel(zone), zone }))
    // Laptop cameras first: on the demo the Mac webcam is the camera worth putting in the middle.
    return [...cams.map((c, i) => ({ id: localSource(c.id), label: i === 0 ? 'Mac webcam' : c.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, ''), deviceId: c.id })), ...phones]
  }, [nodes, now, cams])
  const ids = sources.map((s) => s.id)
  const [picked, setPicked] = useState(load)
  const slots = fillSlots(picked, ids)
  const choose = (slot, id) => setPicked(() => { const next = assign(slots, slot, id); save(next); return next })

  const [open, setOpen] = useState(false)
  const latest = useRef(slots)
  latest.current = slots
  const wearerId = sources.find((s) => s.zone === 'wearer')?.id
  const held = useRef(null)
  useEffect(() => {
    if (!wearerId) { held.current = null; return }
    if (held.current === wearerId || latest.current.center === wearerId) { held.current = wearerId; return }
    held.current = wearerId
    choose('center', wearerId)
  }, [wearerId])
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') setOpen(false)
      const side = { 1: 'left', 2: 'right' }[e.key]
      if (side && latest.current[side]) choose('center', latest.current[side])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const mainSource = sources.find((s) => s.id === slots.center)
  useEffect(() => { if (!mainSource) setOpen(false) }, [mainSource])
  const tile = (slot) => {
    const source = sources.find((s) => s.id === slots[slot])
    return (
      <Tile key={slot} slot={slot} source={source} sources={sources} onChoose={(id) => choose(slot, id)}
        alert={slot === 'center' ? alert : null} open={slot === 'center' && open} onOpen={() => setOpen(true)}
        onPromote={slot === 'center' || !source ? null : () => choose('center', source.id)}
        preview={source?.zone && latestPreview(previews, nodes, source.zone, now, connected)}
        empty={<Empty slot={slot} anySources={sources.length > 0} camError={camError} onAskCameras={onAskCameras} hasCams={cams.length > 0} />} />
    )
  }
  const full = createPortal(
    <AnimatePresence>
      {open && mainSource && <FullView key="full" source={mainSource} alert={alert} onClose={() => setOpen(false)}
        preview={mainSource.zone && latestPreview(previews, nodes, mainSource.zone, now, connected)} />}
    </AnimatePresence>, document.body)
  const switcher = (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Choose the main camera">
      {sources.map((s) => (
        <button key={s.id} type="button" onClick={() => choose('center', s.id)} aria-pressed={slots.center === s.id}
          className={`rounded-full px-3 py-1 text-sm font-medium ${slots.center === s.id ? 'bg-zinc-100 text-ink' : 'glass text-zinc-300 hover:border-white/20'}`}>
          {s.label}
        </button>
      ))}
    </div>
  )
  return { center: tile('center'), left: tile('left'), right: tile('right'), switcher, full }
}

// Newest preview from any phone in this room that's still connected.
function latestPreview(previews, nodes, zone, now, connected) {
  return Object.values(previews)
    .filter((p) => p.zone === zone && connected && nodes[p.node_id] && now - p.ts < 8)
    .sort((a, b) => b.ts - a.ts)[0]
}

const EASE = [0.2, 0.7, 0.2, 1]

function Tile({ slot, source, sources, onChoose, onPromote, preview, empty, alert, open, onOpen }) {
  const main = slot === 'center'
  const still = useReducedMotion()
  // Side cameras lean in toward the main view, like screens around a desk; they straighten on hover.
  const lean = still ? 0 : slot === 'left' ? 9 : slot === 'right' ? -9 : 0
  // The main view tilts a few degrees toward the mouse.
  const rx = useMotionValue(0), ry = useMotionValue(0)
  const tiltX = useSpring(rx, { stiffness: 120, damping: 18 }), tiltY = useSpring(ry, { stiffness: 120, damping: 18 })
  const move = (e) => {
    if (!main || still) return
    const r = e.currentTarget.getBoundingClientRect()
    ry.set(((e.clientX - r.left) / r.width - 0.5) * 5)
    rx.set(-((e.clientY - r.top) / r.height - 0.5) * 4)
  }
  const glow = alert ? SEVERITY_COLOR[alert.severity] : null
  return (
    <div className="relative h-full" style={{ perspective: 1400 }}>
      {main && <div aria-hidden className="pointer-events-none absolute -inset-x-4 -bottom-6 top-1/2 rounded-[40px] opacity-25 blur-[50px]"
        style={{ background: glow ?? 'linear-gradient(90deg, #FF8A3D, #FF4F7B 50%, #8B6CFF)' }} />}
      <motion.figure onMouseMove={move} onMouseLeave={() => { rx.set(0); ry.set(0) }}
        style={main ? { rotateX: tiltX, rotateY: tiltY } : undefined}
        initial={main ? false : { rotateY: lean }} animate={main ? undefined : { rotateY: lean }}
        whileHover={main || !source ? undefined : { rotateY: 0, scale: 1.015 }} transition={{ duration: 0.5, ease: EASE }}
        className={`group relative h-full min-h-0 overflow-hidden rounded-2xl border bg-black shadow-[0_30px_60px_-30px_rgb(0_0_0_/_0.9)] ${main ? 'min-h-[240px]' : 'min-h-[150px]'}`}
        >
        <div className="absolute inset-0 rounded-2xl transition-[box-shadow,border-color] duration-500"
          style={{ boxShadow: glow ? `inset 0 0 0 2px ${glow}, inset 0 0 60px ${glow}55` : 'inset 0 0 0 1px rgb(255 255 255 / 0.08)' }} />
        {!source ? empty
          : open ? <div className="absolute inset-0 grid place-items-center text-sm text-zinc-500">Showing full screen</div>
          : <Feed source={source} preview={preview} look={main} />}
        {onPromote && (
          <button onClick={onPromote} className="absolute inset-0 z-[1] cursor-pointer" aria-label={`Show ${source.label} in the main view`} />
        )}
        {main && source && !open && (
          <button onClick={onOpen} className="absolute inset-0 z-[1] cursor-zoom-in" aria-label={`Open ${source.label} full screen`} />
        )}
        <figcaption className="glass-dark absolute left-2 top-2 z-[2] flex max-w-[calc(100%-1rem)] items-center gap-2 rounded-full py-0.5 pl-1 pr-1 text-xs">
          {!main && <kbd className="rounded-full bg-zinc-800 px-1.5 text-[10px] text-zinc-400">{slot === 'left' ? 1 : 2}</kbd>}
          {source && <span className="live-dot ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />}
          <select value={source?.id ?? ''} onChange={(e) => onChoose(e.target.value)} aria-label={`${slot} camera`}
            className="min-w-0 max-w-44 truncate rounded-full bg-transparent py-0.5 font-medium outline-none">
            {!source && <option value="">No camera</option>}
            {sources.map((s) => <option key={s.id} value={s.id} className="bg-ink">{s.label}</option>)}
          </select>
        </figcaption>
        {main && source && !open && (
          <button onClick={onOpen} className="glass-dark absolute right-2 top-2 z-[2] flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium"
            title="Full screen" aria-label="Full screen">
            <Maximize2 size={13} /> Full screen
          </button>
        )}
        {main && <AlertBanner alert={alert} />}
      </motion.figure>
    </div>
  )
}

// The alert the brain just fired, across the top of the main view.
function AlertBanner({ alert }) {
  return (
    <AnimatePresence>
      {alert && (
        <motion.div key={alert.id} initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.4, ease: EASE }}
          className="glass-dark pointer-events-none absolute left-1/2 top-12 z-[3] -translate-x-1/2 rounded-full px-4 py-2 text-sm font-semibold"
          style={{ boxShadow: `0 0 0 1px ${SEVERITY_COLOR[alert.severity]}, 0 0 30px ${SEVERITY_COLOR[alert.severity]}88` }}>
          {alertText(alert.kind).text} <span className="font-normal text-zinc-400">· {zoneLabel(alert.zone)}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Full screen: the main camera fills the window. Faces, names, the headset box and the brain readout keep running.
function FullView({ source, preview, alert, onClose }) {
  const box = useRef()
  return (
    <motion.div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }} onClick={onClose}>
      <motion.div ref={box} initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.45, ease: EASE }} onClick={(e) => e.stopPropagation()}
        className="absolute inset-0 overflow-hidden bg-black sm:inset-4 sm:rounded-2xl sm:border sm:border-white/10">
        <Feed source={source} preview={preview} look />
        <AlertBanner alert={alert} />
        <div className="absolute inset-x-0 top-0 z-[3] flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent p-4">
          <span className="glass-dark flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium">
            <span className="live-dot h-2 w-2 rounded-full bg-emerald-400" /> {source.label}
          </span>
          <span className="hidden text-xs text-zinc-400 sm:inline">Esc to close</span>
          <button onClick={() => (document.fullscreenElement ? document.exitFullscreen() : box.current?.requestFullscreen?.())}
            className="glass-dark ml-auto rounded-full p-2" title="Fill the whole screen" aria-label="Fill the whole screen"><Maximize2 size={16} /></button>
          <button onClick={onClose} className="glass-dark rounded-full p-2" title="Close" aria-label="Close"><X size={16} /></button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function phoneLabel(zone) {
  if (zone === 'wearer') return '1 Headset'
  if (zone === 'behind') return 'Back cam'
  if (zone === 'Mic' || zone === 'mic') return '1 Mic'
  if (zone === 'drone') return 'Security camera'
  return `${zoneLabel(zone)} phone`
}

function Feed({ source, preview, look = false }) {
  return source.deviceId
    ? <LaptopFeed deviceId={source.deviceId} label={source.label} look={look} />
    : <PhoneFeed preview={preview} label={source.label} />
}

// A room phone. With its opt-in preview on, its camera; otherwise it is the room's ears, so show it listening.
function PhoneFeed({ preview, label }) {
  if (preview) return <img src={preview.jpeg} alt={`${label} camera`} className="absolute inset-0 h-full w-full object-contain" />
  if (label === '1 Headset') {
    return (
      <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-zinc-400">
        <p>Headset is connected.<br />Tap Start on the captions phone. The brain needs <code>LUMEN_DEMO_PREVIEW=1</code>.</p>
      </div>
    )
  }
  return (
    <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_60%,rgb(255_255_255_/_0.06),transparent_60%)]">
      <div className="text-center">
        <div className="flex h-10 items-end justify-center gap-1" aria-hidden>
          {[0.5, 0.9, 0.6, 1, 0.7, 0.4, 0.8].map((h, i) => (
            <span key={i} className="w-1 origin-bottom rounded-full bg-zinc-300/80"
              style={{ height: `${h * 100}%`, animation: `listen 1.1s ease-in-out ${i * 0.12}s infinite alternate` }} />
          ))}
        </div>
        <p className="mt-3 text-xs font-medium uppercase tracking-[0.3em] text-zinc-400">Listening</p>
      </div>
    </div>
  )
}

// The Mac webcam sends a still about once a second and its mic is analyzed like a room node.
// The video itself stays on this laptop.
function useMacMic(on) {
  useEffect(() => {
    if (!on) return
    const sock = nodeSocket('mac-webcam', 'living')
    let stopMic = () => {}
    let dead = false
    attachMic((buf) => sock.send(buf), null, null, { echoCancel: true }).then((stop) => { if (dead) stop(); else stopMic = stop }).catch(() => {})
    return () => { dead = true; stopMic(); sock.close() }
  }, [on])
}

function LaptopFeed({ deviceId, label, look }) {
  const video = useRef()
  const [error, setError] = useState(null)
  useMacMic(label === 'Mac webcam')
  const seen = useSeen(video, true)
  useEffect(() => {
    let live = true
    openCamera(deviceId).then((stream) => {
      if (!live || !video.current) return
      video.current.srcObject = stream
      video.current.play().catch(() => {})
    }, (e) => live && setError(e.message || String(e)))
    return () => { live = false }
  }, [deviceId])
  if (error) return <p className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-zinc-400">{label}: {error}</p>
  return <>
    <video ref={video} playsInline muted aria-label={`${label} camera`} className="absolute inset-0 h-full w-full object-contain" />
    {seen?.objects && <Highlights seen={seen} />}
    {look && seen !== 'off' && <BrainReadout seen={seen} />}
    {look && <TalkingHeads videoRef={video} />}
    {look && <HazardNote videoRef={video} />}
  </>
}

// Whenever a laptop camera is on screen: about once a second, send one small still to the brain
// (POST /api/look). The brain drops the photo and keeps the scene JSON. If the vision model is
// off, keep trying so it starts as soon as the model is there.
const LOOK_MS = 1000
// EfficientDet names -> the words the brain already watches for.
const BOX_LABELS = {
  cup: 'cup', bottle: 'bottle', 'wine glass': 'cup', 'cell phone': 'phone', remote: 'remote',
  person: 'person', knife: 'knife', laptop: 'laptop',
}

async function boxesOnCamera(video) {
  const detector = await loadDetector()
  const { detections } = detector.detectForVideo(video, performance.now())
  const w = video.videoWidth
  const h = video.videoHeight
  if (!w || !h) return []
  const objects = []
  for (const d of detections || []) {
    const cat = d.categories?.[0]
    const label = BOX_LABELS[cat?.categoryName]
    const b = d.boundingBox
    if (!label || !b) continue
    objects.push({
      label, score: cat.score,
      box: [b.originX / w, b.originY / h, (b.originX + b.width) / w, (b.originY + b.height) / h],
    })
  }
  return objects
}

function useSeen(video, on) {
  const [seen, setSeen] = useState(null)
  useEffect(() => {
    if (!on) return
    let live = true, busy = false
    const timer = setInterval(async () => {
      const v = video.current
      if (busy || !v?.videoWidth) return
      busy = true
      try {
        const c = document.createElement('canvas')
        c.width = 640
        c.height = Math.round((640 * v.videoHeight) / v.videoWidth)
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
        const r = await fetch('/api/look', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jpeg: c.toDataURL('image/jpeg', 0.6) }) })
        if (r.status === 503 || r.status === 404) {
          // The big vision model is on the AMD box. This Mac measures the boxes itself.
          const local = await fetch('/api/scene-boxes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ objects: await boxesOnCamera(v) }) })
          if (local.ok && live) setSeen({ ...(await local.json()), aspect: c.width / c.height })
          return
        }
        if (r.ok && live) setSeen({ ...(await r.json()), aspect: c.width / c.height })
      } catch { /* brain offline: try again next tick */ } finally { busy = false }
    }, LOOK_MS)
    return () => { live = false; clearInterval(timer); setSeen(null) }
  }, [on])
  return seen
}

// Along the bottom of the main view: what the brain saw in the last frame, on which GPU, how fast.
// Straight from POST /api/look (OWLv2 on the AMD box); nothing here is made up on the laptop.
function BrainReadout({ seen }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] flex items-end gap-3 bg-gradient-to-t from-black/75 to-transparent px-4 pb-3 pt-10 text-xs">
      <span className="flex items-center gap-2 font-medium uppercase tracking-[0.25em] text-zinc-400">
        <span className={`h-1.5 w-1.5 rounded-full ${seen ? 'live-dot bg-[#FF4F7B]' : 'bg-zinc-600'}`} /> Brain
      </span>
      {seen
        ? <>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">{seen.change || seen.summary || 'nothing new'}</span>
            <span className="tabular shrink-0 text-zinc-400">{seen.model} · {Math.round(seen.inference_ms)} ms{seen.device ? ` · ${seen.device}` : ''}</span>
          </>
        : <span className="text-zinc-500">waiting for the first frame from the AMD brain</span>}
    </div>
  )
}

// Boxes drawn in the same space as the video (object-contain), so they line up at any tile size.
// The white headset gets the bright outline: that's the person the demo is about.
function Highlights({ seen }) {
  const h = 1000 / seen.aspect
  const shown = (seen.objects || []).filter((o) => o.box && (o.label === 'headset' || o.label === 'person'))
  return (
    <svg viewBox={`0 0 1000 ${h}`} preserveAspectRatio="xMidYMid meet" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {shown.map((o, i) => {
        const [l, t, r, b] = o.box
        const hero = o.label === 'headset'
        return (
          <g key={i}>
            <rect x={l * 1000} y={t * h} width={(r - l) * 1000} height={(b - t) * h} rx="8" fill="none"
              stroke={hero ? '#fff' : 'rgb(255 255 255 / 0.35)'} strokeWidth={hero ? 4 : 2} vectorEffect="non-scaling-stroke"
              style={hero ? { filter: 'drop-shadow(0 0 6px rgb(255 255 255 / 0.8))' } : undefined} />
            {hero && <text x={l * 1000 + 6} y={Math.max(30, t * h - 8)} fill="#fff" fontSize="26" fontWeight="600">Headset · {Math.round(o.score * 100)}%</text>}
          </g>
        )
      })}
    </svg>
  )
}

function Empty({ slot, anySources, hasCams, camError, onAskCameras }) {
  return (
    <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-zinc-400">
      <div className="space-y-2">
        <p>{anySources ? 'Pick a camera from the menu.' : slot === 'center' ? 'No cameras yet. Add phones, or use this laptop’s cameras.' : 'No camera'}</p>
        {!hasCams && (slot === 'center' || camError) && (
          <button onClick={onAskCameras} className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-zinc-200 hover:border-white/20">
            <RefreshCw size={14} /> Use laptop cameras
          </button>
        )}
        {camError && <p role="alert" className="text-zinc-300">{camError}</p>}
      </div>
    </div>
  )
}
