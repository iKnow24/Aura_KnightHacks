import { useEffect, useRef, useState } from 'react'
import { clockKnown, serverToPerf } from './clock'
import { detectFaces, loadFaces } from './faces'
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
const HISTORY_MS = 15000 // how far back faceTracker.js keeps mouth movement

export default function TalkingHeads({ videoRef }) {
  const tracker = useRef(new FaceTracker())
  const tracksRef = useRef([])
  const [ids, setIds] = useState('')
  const [lines, setLines] = useState({}) // track id -> {text, ts, live}
  const [loose, setLoose] = useState(null) // a line with no face yet: shown once, not stuck at the page bottom
  const names = useRef({}) // track id -> voice name ("Sharan", "Person 4")
  const lineTrack = useRef({}) // caption id -> track id, so a late voice name finds the right face
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
    const who = (msg, final) => {
      const now = performance.now()
      let [start, end] = [null, null]
      if (msg.start_ts && msg.end_ts && clockKnown()) {
        // The brain timed the words themselves, so look at exactly that stretch of mouth movement.
        start = serverToPerf(msg.start_ts)
        end = Math.min(now, serverToPerf(msg.end_ts))
      }
      if (start == null || end - start < 250 || now - end > HISTORY_MS) {
        // No usable timing (older brain, or the line is older than our face history): guess from
        // how long the words take to say.
        const words = msg.text.split(/\s+/).length
        start = now - (final ? Math.min(9000, 1200 + words * 380) : LIVE_S * 1000)
        end = now - (final ? 400 : 0)
      }
      const tracks = tracker.current.tracks.filter((x) => x.hits >= 3)
      // One face in view: a little mouth movement is enough (nobody to confuse it with).
      return pickSpeaker(tracks, start, end, tracks.length === 1 ? { minTalk: 0.015 } : undefined)
    }
    const onCaption = (e) => {
      const msg = e.detail
      if (!msg) return
      // The name of the voice lands a moment after the words (caption_voice): put it on the same face.
      if (msg.type === 'caption_voice') {
        const id = lineTrack.current[msg.id]
        if (!id || !msg.voice) return
        const had = names.current[id]
        // This face already has a different known voice: the line came from someone off camera.
        if (msg.voice_known && had && had !== msg.voice && !had.startsWith('Person ')) return
        if (msg.voice_known || !had) { names.current[id] = msg.voice; tick((n) => n + 1) }
        return
      }
      if (!msg.text) return
      const final = msg.type === 'caption'
      let face = who(msg, final)
      const tracks = tracker.current.tracks.filter((x) => x.hits >= 3)
      if (!face && tracks.length === 1) face = tracks[0]
      if (!face) {
        setLoose({ key: msg.id ?? msg.text, text: msg.text, name: msg.voice, live: !final, ts: Date.now() / 1000 })
        return
      }
      setLoose(null)
      // Only the last 20 lines need remembering; a voice name arrives within a second of its line.
      if (final && msg.id) lineTrack.current = Object.fromEntries(Object.entries({ [msg.id]: face.id, ...lineTrack.current }).slice(0, 20))
      // This face already has a different known voice: the line came from someone off camera.
      const had = names.current[face.id]
      if (final && msg.voice_known && had && had !== msg.voice && !had.startsWith('Person ')) return
      if (final && msg.voice && (msg.voice_known || !had)) names.current[face.id] = msg.voice
      setLines((l) => ({ ...l, [face.id]: { text: msg.text, ts: Date.now() / 1000, live: !final } }))
    }
    window.addEventListener('lumen:caption', onCaption)
    return () => { clearInterval(t); window.removeEventListener('lumen:caption', onCaption) }
  }, [])

  const now = Date.now() / 1000
  const visible = ids.split(',').filter(Boolean).map(Number)
  const bubbles = visible.flatMap((id) => {
    const line = lines[id] && now - lines[id].ts < HOLD_S ? lines[id] : null
    const name = names.current[id]
    if (!line && !name) return []
    const track = tracksRef.current.find((t) => t.id === id)
    // A known face with nothing new to say keeps a quiet name tag; a fresh line shows over it.
    return [{ trackId: id, key: id, text: line?.text ?? '', live: line?.live, name, color: track?.color ?? '#fff' }]
  })
  const neutral = loose && now - loose.ts < HOLD_S ? loose : null
  return <SpatialCaptions videoRef={videoRef} tracksRef={tracksRef} bubbles={bubbles} neutral={neutral} fit="contain" />
}
