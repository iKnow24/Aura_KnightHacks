import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion'
import { Maximize2, RefreshCw, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { closeCameras, listCameras, localSource, openCamera, phoneSource } from './cameras'
import TalkingHeads from './TalkingHeads'
import { zoneLabel } from './zones'


// Laptop cameras, refreshed when one is plugged in or unplugged.
export function useLaptopCameras() {
  const [cams, setCams] = useState([])
  const [error, setError] = useState(null)
  const refresh = (ask = false) => listCameras(ask).then((c) => { setCams(c); setError(null) })
    .catch((e) => setError(e.name === 'NotAllowedError' ? 'Camera access was blocked. Allow it in the browser and try again.' : e.message))
  useEffect(() => {
    refresh()
    const md = navigator.mediaDevices
    md?.addEventListener?.('devicechange', refresh)
    return () => { md?.removeEventListener?.('devicechange', refresh); closeCameras() }
  }, [])
  return { cams, error, refresh }
}

const MAIN = 'lumen.stage'
const loadMain = () => { try { return localStorage.getItem(MAIN) } catch { return null } }
const saveMain = (id) => { try { localStorage.setItem(MAIN, id) } catch { /* private window */ } }

// The control center's camera stage: one big live view that tilts slightly toward the mouse, and every
// other source as a small angled card beside it. Click a card (or press 1-9) to put it on the stage;
// click the stage to open it full screen (Esc closes). Only sources that exist get a card: no empty boxes.
export function useCameraStage({ nodes, previews, now, connected, cams, camError, onAskCameras }) {
  const sources = useMemo(() => {
    const phones = [...new Set(Object.values(nodes).filter((n) => now - n.last_seen < 10).map((n) => n.zone))]
      .map((zone) => ({ id: phoneSource(zone), label: `${zoneLabel(zone)} phone`, zone }))
    // Laptop cameras first: on the demo, the Mac webcam is the camera worth looking at.
    return [...cams.map((c) => ({ id: localSource(c.id), label: c.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, ''), deviceId: c.id })), ...phones]
  }, [nodes, now, cams])
  const [picked, setPicked] = useState(loadMain)
  const [open, setOpen] = useState(false)
  const main = sources.find((s) => s.id === picked) ?? sources[0]
  const others = sources.filter((s) => s !== main)
  const show = (id) => { setPicked(id); saveMain(id) }
  const previewOf = (s) => s?.zone && latestPreview(previews, nodes, s.zone, now, connected)

  const latest = useRef(others)
  latest.current = others
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') setOpen(false)
      const next = latest.current[Number(e.key) - 1]
      if (next) show(next.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => { if (!main) setOpen(false) }, [main])

  const stage = !main
    ? <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
        <Empty anySources={false} hasCams={cams.length > 0} camError={camError} onAskCameras={onAskCameras} />
      </div>
    : open
      ? <div className="aspect-video rounded-2xl border border-white/5" />
      : <Stage key={main.id} source={main} preview={previewOf(main)} onOpen={() => setOpen(true)} />

  const side = others.map((s, i) => (
    <SideCard key={s.id} source={s} n={i + 1} preview={previewOf(s)} onShow={() => show(s.id)} />
  ))

  const full = createPortal(
    <AnimatePresence>
      {open && main && <FullView key="full" source={main} preview={previewOf(main)} onClose={() => setOpen(false)} />}
    </AnimatePresence>, document.body)

  return { stage, side, full, count: sources.length }
}

// Newest preview from any phone in this room that's still connected.
function latestPreview(previews, nodes, zone, now, connected) {
  return Object.values(previews)
    .filter((p) => p.zone === zone && connected && nodes[p.node_id] && now - p.ts < 5)
    .sort((a, b) => b.ts - a.ts)[0]
}

const EASE = [0.2, 0.7, 0.2, 1]

// The big view. A few degrees of tilt toward the mouse and a soft glow underneath give it depth.
function Stage({ source, preview, onOpen }) {
  const still = useReducedMotion()
  const rx = useMotionValue(0), ry = useMotionValue(0)
  const tiltX = useSpring(rx, { stiffness: 120, damping: 18 }), tiltY = useSpring(ry, { stiffness: 120, damping: 18 })
  const move = (e) => {
    if (still) return
    const r = e.currentTarget.getBoundingClientRect()
    ry.set(((e.clientX - r.left) / r.width - 0.5) * 6)
    rx.set(-((e.clientY - r.top) / r.height - 0.5) * 5)
  }
  const leave = () => { rx.set(0); ry.set(0) }
  return (
    <div className="relative" style={{ perspective: 1600 }}>
      <div aria-hidden className="pointer-events-none absolute -inset-x-6 -bottom-8 top-1/3 rounded-[40px] opacity-25 blur-[60px]"
        style={{ background: 'linear-gradient(90deg, #FF8A3D, #FF4F7B 50%, #8B6CFF)' }} />
      <motion.div layoutId={`cam-${source.id}`} onMouseMove={move} onMouseLeave={leave}
        initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
        style={{ rotateX: tiltX, rotateY: tiltY }} transition={{ duration: 0.55, ease: EASE }}
        className="group relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_40px_80px_-30px_rgb(0_0_0_/_0.9)]">
        <Feed source={source} preview={preview} look />
        <button onClick={onOpen} className="absolute inset-0 z-[1] cursor-zoom-in" aria-label={`Open ${source.label} full screen`} />
        <Label source={source} />
        <span className="glass-dark pointer-events-none absolute right-3 top-3 z-[2] flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium opacity-70 transition group-hover:opacity-100">
          <Maximize2 size={13} /> Full screen
        </span>
        {/* A thin sheen across the glass, like a screen catching the light. */}
        <span aria-hidden className="pointer-events-none absolute inset-0 z-[1] rounded-2xl"
          style={{ background: 'linear-gradient(120deg, rgb(255 255 255 / 0.06), transparent 35%)', boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.06)' }} />
      </motion.div>
    </div>
  )
}

// A smaller source, angled like a card on a shelf. It straightens up on hover; click to put it on the stage.
function SideCard({ source, n, preview, onShow }) {
  return (
    <div style={{ perspective: 1000 }}>
      <motion.button onClick={onShow} transition={{ duration: 0.45, ease: EASE }}
        initial={{ rotateY: -14 }} whileHover={{ rotateY: 0, scale: 1.02 }} animate={{ rotateY: -14 }}
        className="relative block aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-black text-left shadow-[0_24px_50px_-24px_rgb(0_0_0_/_0.9)]"
        aria-label={`Show ${source.label} on the main view`}>
        <Feed source={source} preview={preview} />
        <Label source={source} small n={n} />
      </motion.button>
    </div>
  )
}

function Label({ source, small, n }) {
  return (
    <span className={`glass-dark pointer-events-none absolute left-2 top-2 z-[2] flex max-w-[calc(100%-1rem)] items-center gap-2 rounded-full ${small ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1.5 text-xs'} font-medium`}>
      {n && <kbd className="rounded-full bg-white/10 px-1.5 text-[10px] text-zinc-300">{n}</kbd>}
      <span className="live-dot h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
      <span className="truncate">{source.label}</span>
    </span>
  )
}

// Full screen: the stage zooms out to fill the window. Faces, names and the headset box keep running.
function FullView({ source, preview, onClose }) {
  const box = useRef()
  return (
    <motion.div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }} onClick={onClose}>
      <motion.div ref={box} layoutId={`cam-${source.id}`} transition={{ duration: 0.55, ease: EASE }} onClick={(e) => e.stopPropagation()}
        className="absolute inset-0 overflow-hidden bg-black sm:inset-4 sm:rounded-2xl sm:border sm:border-white/10">
        <Feed source={source} preview={preview} look />
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

function Feed({ source, preview, look = false }) {
  return source.deviceId
    ? <LaptopFeed deviceId={source.deviceId} label={source.label} look={look} />
    : <PhoneFeed preview={preview} label={source.label} />
}

// A room phone. With its opt-in preview on, its camera; otherwise it is the room's ears, so show it listening.
function PhoneFeed({ preview, label }) {
  if (preview) return <img src={preview.jpeg} alt={`${label} camera`} className="absolute inset-0 h-full w-full object-contain" />
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

function LaptopFeed({ deviceId, label, look }) {
  const video = useRef()
  const [error, setError] = useState(null)
  const seen = useSeen(video, look)
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
    {seen && <Highlights seen={seen} />}
    {look && <TalkingHeads videoRef={video} />}
  </>
}

// Main laptop camera only: about once a second, send one small still to the brain (POST /api/look, OWLv2 on the
// AMD GPU) and get back what's in it. The brain drops the photo and keeps the scene JSON. Stops quietly if the
// brain has no vision model.
const LOOK_MS = 1000
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
        if (r.status === 503 || r.status === 404) clearInterval(timer)  // no vision model / demo site
        if (r.ok && live) setSeen({ ...(await r.json()), aspect: c.width / c.height })
      } catch { /* brain offline: try again next tick */ } finally { busy = false }
    }, LOOK_MS)
    return () => { live = false; clearInterval(timer); setSeen(null) }
  }, [on])
  return seen
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

function Empty({ anySources, hasCams, camError, onAskCameras }) {
  return (
    <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-zinc-400">
      <div className="space-y-2">
        <p>{anySources ? 'Pick a camera.' : 'No cameras yet. Add phones, or use this laptop’s cameras.'}</p>
        {!hasCams && (
          <button onClick={onAskCameras} className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-zinc-200 hover:border-white/20">
            <RefreshCw size={14} /> Use laptop cameras
          </button>
        )}
        {camError && <p role="alert" className="text-zinc-300">{camError}</p>}
      </div>
    </div>
  )
}
