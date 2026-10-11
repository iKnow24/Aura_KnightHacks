import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { toScreen } from './faces'

// Captions in the room instead of in a panel: each line floats just above the head of the person
// who said it and follows them as they (or the camera) move. Lines nobody can be sure about sit
// in a neutral spot at the bottom center, never on a guessed face.
//
// Positions are written straight to the DOM every animation frame (no React re-render per frame),
// eased toward each face so tracking jitter doesn't shake the text.

const GAP = 10 // px between the caption and the top of the head
const EDGE = 12 // px kept clear of the screen edges
const HEAD_ABOVE_FOREHEAD = 0.35 // the forehead point sits below the hair; lift by this much of the face height
const EASE = 14 // higher = follows faster

export const TEXT = {
  fontWeight: 600,
  lineHeight: 1.25,
  textShadow: '0 1px 2px rgb(0 0 0 / 0.5)',
}

function Bubble({ c, setRef }) {
  return (
    <motion.div ref={setRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
      className="pointer-events-none absolute left-0 top-0 z-[15] will-change-transform" style={{ visibility: 'hidden' }}>
      <div className="glass-dark max-w-[min(78vw,24em)] rounded-2xl px-3.5 py-2 text-center"
        style={{ boxShadow: `inset 0 -2px 0 ${c.color}` }}>
        {c.name && <div className={`${c.text ? 'mb-0.5' : ''} text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-300`}>{c.name}{c.toYou ? ' · to you' : ''}</div>}
        {c.text && (
          <p className="text-[clamp(16px,4.4vw,22px)] text-white" style={TEXT}>
            {c.text}{c.live && <span className="ml-0.5 inline-block h-[0.9em] w-[2px] translate-y-[2px] animate-pulse bg-white" />}
          </p>
        )}
      </div>
    </motion.div>
  )
}

// bubbles: [{trackId, key, text, live, name, color, toYou}]. neutral: {key, text, live, name} or null.
// tracksRef.current: the face tracker's visible tracks (updated by the camera loop).
// fit: how the video is shown ('cover' on /captions, 'contain' on the dashboard camera tile).
export default function SpatialCaptions({ videoRef, tracksRef, bubbles, neutral, cue, raised, fit = 'cover' }) {
  const els = useRef(new Map()) // trackId -> element
  const pos = useRef(new Map()) // trackId -> {x, y} on screen, eased
  const list = useRef(bubbles)
  list.current = bubbles

  useEffect(() => {
    let raf, last = performance.now()
    const frame = (now) => {
      raf = requestAnimationFrame(frame)
      const k = 1 - Math.exp(-EASE * Math.min(0.1, (now - last) / 1000))
      last = now
      const v = videoRef.current, root = v?.parentElement
      if (!v || !root) return
      const W = root.clientWidth, H = root.clientHeight
      const boxes = []
      for (const c of list.current) {
        const el = els.current.get(c.trackId)
        const t = tracksRef.current.find((x) => x.id === c.trackId)
        if (!el || !t) continue
        const head = toScreen(v, root, t.x, t.y - t.size * HEAD_ABOVE_FOREHEAD, fit)
        const chin = toScreen(v, root, t.x, t.bottom, fit)
        const w = el.offsetWidth, h = el.offsetHeight
        // Above the head; if that would leave the screen, under the chin instead. Never on the face.
        let y = head.top - GAP - h
        if (y < EDGE) y = chin.top + GAP
        const x = Math.min(W - EDGE - w, Math.max(EDGE, head.left - w / 2))
        boxes.push({ el, id: c.trackId, x, y: Math.min(H - EDGE - h, y), w, h })
      }
      // Two people side by side: push the higher caption up until they don't overlap.
      boxes.sort((a, b) => a.y - b.y)
      for (let i = 0; i < boxes.length; i++) for (let j = 0; j < i; j++) {
        const a = boxes[i], b = boxes[j]
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) b.y = Math.max(EDGE, a.y - b.h - 6)
      }
      for (const b of boxes) {
        const p = pos.current.get(b.id) ?? { x: b.x, y: b.y }
        p.x += (b.x - p.x) * k
        p.y += (b.y - p.y) * k
        pos.current.set(b.id, p)
        b.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`
        b.el.style.visibility = 'visible'
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [videoRef, tracksRef, fit])

  return (
    <>
      <AnimatePresence>
        {bubbles.map((c) => (
          <Bubble key={c.key} c={c} setRef={(el) => {
            if (el) els.current.set(c.trackId, el)
            else if (els.current.get(c.trackId)?.isConnected === false) { els.current.delete(c.trackId); pos.current.delete(c.trackId) }
          }} />
        ))}
      </AnimatePresence>
      {/* Neutral spot: speech nobody could be matched to, sound cues, and everything when the camera is off. */}
      <div className={`pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center gap-2 px-[6%] text-center transition-[bottom] duration-300 ${raised ? 'bottom-[max(9rem,12%)]' : 'bottom-[12%]'}`}>
        <AnimatePresence>
          {cue && (
            <motion.div key={cue.key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="glass-dark rounded-full px-3 py-1 text-sm italic text-zinc-200">[{cue.text}]</motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence mode="wait">
          {neutral && (
            <motion.div key={neutral.key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
              className="glass-dark max-w-[min(88vw,30em)] rounded-2xl px-4 py-2.5">
              {neutral.name && <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-300">{neutral.name}</div>}
              <p className="text-[clamp(18px,5vw,26px)] text-white" style={TEXT}>
                {neutral.text}{neutral.live && <span className="ml-0.5 inline-block h-[0.9em] w-[2px] translate-y-[2px] animate-pulse bg-white" />}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  )
}
