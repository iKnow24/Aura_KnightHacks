import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import { useEffect, useRef, useState } from 'react'
import { toScreen } from './faces'
import { BONES } from './pose'

// "Body map" on the dashboard's laptop camera: a live skeleton, face points and a posture tag drawn
// over every person in view. MediaPipe pose runs in this browser tab (about 15 times a second);
// nothing is sent anywhere and nobody is identified. It never fires an alert.
//
// Its own pose model instance: the avatar panel uses the shared one in pose.js, and one MediaPipe
// instance can't be fed two videos.

const EVERY_MS = 66
const KEY = 'lumen_bodymap'
const FACE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] // nose, eyes, ears, mouth in the pose model
const HANDS = [15, 16, 17, 18, 19, 20, 21, 22]

let model = null
async function loadModel() {
  if (model) return model
  const files = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`)
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}mediapipe/pose_landmarker_lite.task`, delegate },
    runningMode: 'VIDEO',
    numPoses: 3,
  })
  try { model = await PoseLandmarker.createFromOptions(files, options('GPU')) } catch { model = await PoseLandmarker.createFromOptions(files, options('CPU')) }
  return model
}

// Standing / sitting / lying from where shoulders, hips and knees sit in the picture.
function posture(p) {
  const seen = (i) => (p[i]?.visibility ?? 0) > 0.5
  if (![11, 12, 23, 24].every(seen)) return null
  const mid = (a, b) => ({ x: (p[a].x + p[b].x) / 2, y: (p[a].y + p[b].y) / 2 })
  const sh = mid(11, 12), hip = mid(23, 24)
  const torsoTilt = Math.abs(sh.x - hip.x) / (Math.abs(sh.y - hip.y) + 1e-6)
  if (torsoTilt > 1.2) return 'lying down'
  if ([25, 26].every(seen)) {
    // Sitting = both knees about level with the hips (a lunge keeps one knee well below them).
    const knee = Math.max(p[25].y, p[26].y)
    const thigh = Math.abs(knee - hip.y) / (Math.abs(sh.y - hip.y) + 1e-6)
    return thigh < 0.35 ? 'sitting' : 'standing'
  }
  return 'upright'
}

export default function BodyOverlay({ videoRef }) {
  const canvas = useRef()
  const [on, setOn] = useState(() => { try { return localStorage.getItem(KEY) !== '0' } catch { return true } })

  useEffect(() => {
    try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* private window */ }
    const c = canvas.current
    if (!on) { c?.getContext('2d').clearRect(0, 0, c.width, c.height); return }
    let timer, dead = false, last = 0
    loadModel().then((m) => {
      if (dead) return
      timer = setInterval(() => {
        const v = videoRef.current
        if (!v || !c || v.readyState < 2 || document.hidden) return
        const now = Math.max(performance.now(), last + 1)
        last = now
        const people = m.detectForVideo(v, now).landmarks ?? []
        draw(c, v, people)
      }, EVERY_MS)
    }).catch(() => {})
    return () => { dead = true; clearInterval(timer) }
  }, [on, videoRef])

  return (
    <>
      <canvas ref={canvas} className="pointer-events-none absolute inset-0 z-[2] h-full w-full" />
      <button onClick={() => setOn(!on)} title="Skeleton and posture drawn in this browser; nothing is sent"
        className="glass-dark absolute right-2 top-12 z-[3] rounded-full px-3 py-1 text-xs text-zinc-200 hover:text-white">
        Body map: {on ? 'on' : 'off'}
      </button>
    </>
  )
}

function draw(c, video, people) {
  const el = c.parentElement
  const dpr = window.devicePixelRatio || 1
  const w = el.clientWidth, h = el.clientHeight
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr) }
  const g = c.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)
  const at = (pt) => toScreen(video, el, pt.x, pt.y, 'contain')
  const grad = g.createLinearGradient(0, 0, w, h)
  grad.addColorStop(0, '#FF8A3D'); grad.addColorStop(0.5, '#FF4F7B'); grad.addColorStop(1, '#8B6CFF')

  for (const p of people) {
    const seen = (i) => (p[i]?.visibility ?? 0) > 0.5
    // Bones: a soft glow under a crisp line.
    g.lineCap = 'round'
    for (const [a, b] of BONES) {
      if (!seen(a) || !seen(b)) continue
      const A = at(p[a]), B = at(p[b])
      g.strokeStyle = 'rgba(255,79,123,0.25)'; g.lineWidth = 9
      g.beginPath(); g.moveTo(A.left, A.top); g.lineTo(B.left, B.top); g.stroke()
      g.strokeStyle = grad; g.lineWidth = 2.5
      g.beginPath(); g.moveTo(A.left, A.top); g.lineTo(B.left, B.top); g.stroke()
    }
    // Joints, face points, hands.
    for (let i = 11; i <= 28; i++) {
      if (!seen(i) || HANDS.includes(i)) continue
      const P = at(p[i])
      g.fillStyle = '#fff'; g.beginPath(); g.arc(P.left, P.top, 3.5, 0, Math.PI * 2); g.fill()
    }
    for (const i of [...FACE, ...HANDS]) {
      if (!seen(i)) continue
      const P = at(p[i])
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.arc(P.left, P.top, 2, 0, Math.PI * 2); g.fill()
    }
    // Corner brackets around the person and a posture tag above the head.
    const pts = p.filter((q) => (q.visibility ?? 0) > 0.5).map(at)
    if (pts.length < 6) continue
    const x0 = Math.min(...pts.map((q) => q.left)) - 14, x1 = Math.max(...pts.map((q) => q.left)) + 14
    const y0 = Math.min(...pts.map((q) => q.top)) - 18, y1 = Math.max(...pts.map((q) => q.top)) + 10
    const k = Math.min(22, (x1 - x0) / 4)
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2
    for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      g.beginPath(); g.moveTo(x + dx * k, y); g.lineTo(x, y); g.lineTo(x, y + dy * k); g.stroke()
    }
    const tag = posture(p)
    if (tag) {
      const text = `Person · ${tag}`
      g.font = '600 12px Manrope Variable, system-ui, sans-serif'
      const tw = g.measureText(text).width + 16
      const ty = Math.max(4, y0 - 26)
      g.fillStyle = 'rgba(10,10,12,0.8)'; g.beginPath(); g.roundRect(x0, ty, tw, 20, 10); g.fill()
      g.fillStyle = '#fff'; g.fillText(text, x0 + 8, ty + 14)
    }
  }
}
