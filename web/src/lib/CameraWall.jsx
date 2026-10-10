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
        : source.deviceId ? <LaptopFeed deviceId={source.deviceId} label={source.label} />
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

function LaptopFeed({ deviceId, label }) {
  const video = useRef()
  const [error, setError] = useState(null)
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
  return <video ref={video} playsInline muted aria-label={`${label} camera`} className="absolute inset-0 h-full w-full object-contain" />
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
