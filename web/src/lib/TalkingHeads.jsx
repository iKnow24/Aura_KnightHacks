import { useEffect, useRef, useState } from 'react'
import { detectFaces, loadFaces, toScreen } from './faces'
import { FaceTracker } from './faceTracker'
import { pickSpeaker } from './speakerMatch'
import SpatialCaptions from './SpatialCaptions'

// The dashboard's main laptop camera: what people say floats above the head of whoever said it,
// with their name. Same rules as /captions: no face recognition. The face that gets a line is the one
// whose mouth moved while it was being said (speakerMatch.js); the name comes from the voice
// (detectors/voices.py on the brain). Face tracking runs in this browser; no video leaves the laptop.
//
// Captions reach this component as window 'lumen:caption' events (Dashboard.jsx forwards them), so the
// camera wall doesn't need to know about the brain socket.

const FACE_MS = 66 // about 15 face checks a second
const HOLD_S = 6 // a line stays over a head this long
const LIVE_S = 1.5 // "talking right now" = mouth moving over the last 1.5 s

export default function TalkingHeads({ videoRef }) {
  const tracker = useRef(new FaceTracker())
  const tracksRef = useRef([])
  const [ids, setIds] = useState('')
  const [lines, setLines] = useState({}) // track id -> {text, ts, live}
  const names = useRef({}) // track id -> voice name ("Sharan", "Person 4") or a pinned name
  const pinned = useRef({}) // track id -> true when the presenter typed that name
  const [pick, setPick] = useState(null) // {id} while the presenter is naming a tapped face
  const [draft, setDraft] = useState('')
  const [, tick] = useState(0)

  useEffect(() => {
    let timer, dead = false, last = ''
    loadFaces().then(() => {
      if (dead) return
      timer = setInterval(() => {
        const v = videoRef.current
        if (!v || v.readyState < 2 || document.hidden) return
        const tracks = tracker.current.update(detectFaces(v, performance.now()), performance.now())
        tracksRef.current = tracks
        const key = tracks.map((t) => t.id).join(',')
        if (key !== last) { last = key; setIds(key) }
      }, FACE_MS)
    }).catch(() => {})
    return () => { dead = true; clearInterval(timer) }
  }, [videoRef])

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    // Whose mouth moved for this line? Whisper finishes a line a moment after the speaker stops,
    // so look back over roughly how long the words took to say.
    const who = (text, final) => {
      const now = performance.now()
      const words = text.split(/\s+/).length
      const span = final ? Math.min(9000, 1200 + words * 380) : LIVE_S * 1000
      const tracks = tracker.current.tracks.filter((x) => x.hits >= 3)
      // One face in view: a little mouth movement is enough (nobody to confuse it with).
      return pickSpeaker(tracks, now - span, now - (final ? 400 : 0), tracks.length === 1 ? { minTalk: 0.015 } : undefined)
    }
    const onCaption = (e) => {
      const msg = e.detail
      if (!msg?.text) return
      const final = msg.type === 'caption'
      const face = who(msg.text, final)
      if (!face) return
      // This face already has a different known voice: the line came from someone off camera.
      const had = names.current[face.id]
      if (final && msg.voice_known && had && had !== msg.voice && !had.startsWith('Person ')) return
      if (final && msg.voice && !pinned.current[face.id] && (msg.voice_known || !had)) names.current[face.id] = msg.voice
      setLines((l) => ({ ...l, [face.id]: { text: msg.text, ts: Date.now() / 1000, live: !final } }))
    }
    window.addEventListener('lumen:caption', onCaption)
    return () => { clearInterval(t); window.removeEventListener('lumen:caption', onCaption) }
  }, [])

  // Presenter pin: tap a face on the tile, type its name. It's a human's word, so it's marked "pinned"
  // and voice labels don't overwrite it. Tap the same face again to clear it.
  const onTap = (e) => {
    const v = videoRef.current
    const root = v?.parentElement
    if (!v || !root) return
    const rect = root.getBoundingClientRect()
    const px = e.clientX - rect.left, py = e.clientY - rect.top
    let hit = null
    for (const t of tracksRef.current) {
      const c = toScreen(v, root, t.x, t.y, 'contain')
      const r = Math.max(36, t.size * v.videoHeight * Math.min(root.clientWidth / v.videoWidth, root.clientHeight / v.videoHeight) * 0.6)
      const d = Math.hypot(c.left - px, c.top - py)
      if (d <= r && (!hit || d < hit.d)) hit = { id: t.id, d }
    }
    if (!hit) return
    if (pinned.current[hit.id]) {
      delete pinned.current[hit.id]
      delete names.current[hit.id]
      tick((n) => n + 1)
      return
    }
    setDraft(names.current[hit.id] ?? '')
    setPick({ id: hit.id })
  }
  const savePin = (e) => {
    e.preventDefault()
    const name = draft.trim().slice(0, 30)
    if (!pick || !name) return
    names.current[pick.id] = name
    pinned.current[pick.id] = true
    setPick(null)
    tick((n) => n + 1)
  }

  const now = Date.now() / 1000
  const visible = ids.split(',').filter(Boolean).map(Number)
  const bubbles = visible.flatMap((id) => {
    const line = lines[id] && now - lines[id].ts < HOLD_S ? lines[id] : null
    const name = names.current[id]
    if (!line && !name) return []
    const track = tracksRef.current.find((t) => t.id === id)
    // A known face with nothing new to say keeps a quiet name tag; a fresh line shows over it.
    const shown = name && pinned.current[id] ? `${name} · pinned` : name
    return [{ trackId: id, key: id, text: line?.text ?? '', live: line?.live, name: shown, color: track?.color ?? '#fff' }]
  })
  return (
    <>
      <div onClick={onTap} className="absolute inset-0 z-[14] cursor-pointer" aria-hidden="true" />
      <SpatialCaptions videoRef={videoRef} tracksRef={tracksRef} bubbles={bubbles} neutral={null} fit="contain" />
      {pick && (
        <form onSubmit={savePin} className="glass-dark absolute bottom-3 left-1/2 z-[30] flex -translate-x-1/2 items-center gap-2 rounded-2xl p-2 pl-3">
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Who is this?"
            aria-label="Name for this face" className="w-40 bg-transparent text-sm text-white outline-none placeholder:text-zinc-400" />
          <button type="submit" disabled={!draft.trim()} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-black disabled:opacity-40">Pin</button>
          <button type="button" onClick={() => setPick(null)} className="px-2 text-xs text-zinc-300">Cancel</button>
        </form>
      )}
    </>
  )
}
