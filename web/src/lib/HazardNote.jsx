import { TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'

// "Watch out" notes along the bottom of the dashboard camera, written by Gemini.
//
// Advice only: it never fires an alert or the strobe (the brain's detectors do that, with no AI in the
// decision). It is opt-in, because the still goes to Google: nothing is sent until someone presses
// the button. The brain answers and drops the photo; only the note text is kept.

const EVERY_MS = 8000
const HOLD_MS = 20000 // a note stays up this long if the next look finds nothing
const KEY = 'lumen_hazard'

const remembered = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }

export default function HazardNote({ videoRef }) {
  const [on, setOn] = useState(remembered)
  const [note, setNote] = useState(null) // {notes, at}
  const [status, setStatus] = useState('') // why there's nothing to show, when there isn't

  const toggle = () => {
    const next = !on
    setOn(next)
    setNote(null)
    setStatus('')
    try { localStorage.setItem(KEY, next ? '1' : '0') } catch { /* private window */ }
  }

  useEffect(() => {
    if (!on) return
    let dead = false
    const look = async () => {
      const v = videoRef.current
      if (dead || document.hidden || !v?.videoWidth) return
      const w = 640
      const c = document.createElement('canvas')
      c.width = w
      c.height = Math.max(1, Math.round((w * v.videoHeight) / v.videoWidth))
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
      try {
        const r = await fetch('/api/hazard', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jpeg: c.toDataURL('image/jpeg', 0.6), zone: 'living' }),
        }).then((x) => x.json())
        if (dead) return
        if (r.enabled === false) setStatus(r.error || 'Needs a Gemini key on the brain')
        else if (r.error) setStatus(r.error)
        else if (!r.wait) {
          setStatus('')
          if (r.notes?.length) setNote({ notes: r.notes, at: Date.now() })
          else setNote((n) => (n && Date.now() - n.at < HOLD_MS ? n : null))
        }
      } catch { if (!dead) setStatus('Brain not reachable') }
    }
    look()
    const t = setInterval(look, EVERY_MS)
    return () => { dead = true; clearInterval(t) }
  }, [on, videoRef])

  return (
    <div className="absolute inset-x-0 bottom-12 z-[3] flex flex-wrap items-center justify-center gap-2 px-3">
      {note && (
        <div className="glass-dark flex max-w-full items-center gap-2 rounded-2xl px-4 py-2 text-sm text-white">
          <TriangleAlert size={16} className="shrink-0 text-amber-300" />
          <span className="min-w-0">
            <b>Watch out:</b> {note.notes.map((n) => [n.label, n.where].filter(Boolean).join(', ')).join(' · ')}
            <span className="ml-2 text-xs text-zinc-400">AI note, not an alert</span>
          </span>
        </div>
      )}
      {on && status && <span className="glass-dark rounded-full px-3 py-1 text-xs text-zinc-300">{status}</span>}
      <button onClick={toggle} title="Sends a still from this camera to Google Gemini every few seconds"
        className="glass-dark pointer-events-auto rounded-full px-3 py-1 text-xs text-zinc-200 hover:text-white">
        AI hazard check: {on ? 'on' : 'off'}
      </button>
    </div>
  )
}
