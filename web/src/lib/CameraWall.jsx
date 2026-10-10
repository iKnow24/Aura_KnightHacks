import { Maximize2, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { assign, closeCameras, fillSlots, listCameras, localSource, openCamera, phoneSource } from './cameras'
import { zoneLabel } from './zones'

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
    refresh()
    const md = navigator.mediaDevices
    md?.addEventListener?.('devicechange', refresh)
    return () => { md?.removeEventListener?.('devicechange', refresh); closeCameras() }
  }, [])
  return { cams, error, refresh }
}

// The control center's camera wall: one big main view and a camera on each side.
// Click a side camera (or press 1 / 2) to swap it into the main view; each tile's menu picks any source.
// Returns the three tiles so the dashboard can place them in its own grid.
export function useCameraWall({ nodes, previews, now, connected, cams, camError, onAskCameras }) {
  const sources = useMemo(() => {
    const phones = [...new Set(Object.values(nodes).filter((n) => now - n.last_seen < 10).map((n) => n.zone))]
      .map((zone) => ({ id: phoneSource(zone), label: `${zoneLabel(zone)} phone`, zone }))
    return [...phones, ...cams.map((c) => ({ id: localSource(c.id), label: c.label, deviceId: c.id }))]
  }, [nodes, now, cams])
  const ids = sources.map((s) => s.id)
  const [picked, setPicked] = useState(load)
  const slots = fillSlots(picked, ids)
  const choose = (slot, id) => setPicked(() => { const next = assign(slots, slot, id); save(next); return next })

  const latest = useRef(slots)
  latest.current = slots
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return
      const side = { 1: 'left', 2: 'right' }[e.key]
      if (side && latest.current[side]) choose('center', latest.current[side])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const tile = (slot) => {
    const source = sources.find((s) => s.id === slots[slot])
    return (
      <Tile key={slot} slot={slot} source={source} sources={sources} onChoose={(id) => choose(slot, id)}
        onPromote={slot === 'center' || !source ? null : () => choose('center', source.id)}
        preview={source?.zone && latestPreview(previews, nodes, source.zone, now, connected)}
        empty={<Empty slot={slot} anySources={sources.length > 0} camError={camError} onAskCameras={onAskCameras} hasCams={cams.length > 0} />} />
    )
  }
  return { center: tile('center'), left: tile('left'), right: tile('right') }
}

// Newest preview from any phone in this room that's still connected.
function latestPreview(previews, nodes, zone, now, connected) {
  return Object.values(previews)
    .filter((p) => p.zone === zone && connected && nodes[p.node_id] && now - p.ts < 5)
    .sort((a, b) => b.ts - a.ts)[0]
}

function Tile({ slot, source, sources, onChoose, onPromote, preview, empty }) {
  const box = useRef()
  const main = slot === 'center'
  return (
    <figure ref={box} className={`glass group relative h-full min-h-0 overflow-hidden rounded-xl bg-black ${main ? 'min-h-[240px]' : 'min-h-[150px]'}`}>
      {!source ? empty
        : source.deviceId ? <LaptopFeed deviceId={source.deviceId} label={source.label} look={main} />
        : <PhoneFeed preview={preview} label={source.label} />}
      {onPromote && (
        <button onClick={onPromote} className="absolute inset-0 z-[1] cursor-pointer" aria-label={`Show ${source.label} in the main view`} />
      )}
      <figcaption className="glass-dark absolute left-2 top-2 z-[2] flex max-w-[calc(100%-1rem)] items-center gap-2 rounded-full py-0.5 pl-1 pr-1 text-xs">
        {!main && <kbd className="rounded-full bg-zinc-800 px-1.5 text-[10px] text-zinc-400">{slot === 'left' ? 1 : 2}</kbd>}
        <select value={source?.id ?? ''} onChange={(e) => onChoose(e.target.value)} aria-label={`${slot} camera`}
          className="min-w-0 max-w-44 truncate rounded-full bg-transparent py-0.5 font-medium outline-none">
          {!source && <option value="">No camera</option>}
          {sources.map((s) => <option key={s.id} value={s.id} className="bg-ink">{s.label}</option>)}
        </select>
      </figcaption>
      {main && source && (
        <button onClick={() => (document.fullscreenElement ? document.exitFullscreen() : box.current.requestFullscreen?.())}
          className="glass-dark absolute right-2 top-2 z-[2] rounded-full p-1.5" title="Full screen" aria-label="Full screen">
          <Maximize2 size={14} />
        </button>
      )}
    </figure>
  )
}

function PhoneFeed({ preview, label }) {
  if (preview) return <img src={preview.jpeg} alt={`${label} camera`} className="absolute inset-0 h-full w-full object-contain" />
  return (
    <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-zinc-400">
      <p>{label} is connected.<br />To see its camera, tick “Show camera on laptop” on the phone<br />(the brain needs <code>LUMEN_DEMO_PREVIEW=1</code>).</p>
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
