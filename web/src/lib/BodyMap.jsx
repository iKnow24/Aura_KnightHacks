import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import { ScanFace } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

// Body map on the dashboard's laptop camera: a glowing skeleton and face outline drawn on each
// person, with live tags (standing, sitting, hand up, facing you, talking), plus a one-line
// "Luma sees" caption from the brain every few seconds.
//
// The skeleton and face points run in this tab (MediaPipe, our own copy of the models), and no
// video leaves the laptop for them. The Luma line is opt-in with the button, because that still
// goes to the brain and then Google (POST /api/describe); the brain answers and drops it.
// No face recognition: the face points are for drawing and "talking / facing you" only.

const KEY = 'lumen_bodymap'
const DESCRIBE_MS = 8000
const COLORS = ['#22d3ee', '#f472b6', '#a3e635']

let models = null
async function loadModels() {
  if (models) return models
  const files = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`)
  const make = async (Kind, path, extra) => {
    const options = (delegate) => ({ baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}mediapipe/${path}`, delegate }, runningMode: 'VIDEO', ...extra })
    try { return await Kind.createFromOptions(files, options('GPU')) } catch { return Kind.createFromOptions(files, options('CPU')) }
  }
  // Own instances, so this overlay doesn't share tracking state with the avatar or the captions.
  models = {
    pose: await make(PoseLandmarker, 'pose_landmarker_lite.task', { numPoses: 3 }),
    face: await make(FaceLandmarker, 'face_landmarker.task', { numFaces: 3, outputFaceBlendshapes: true }),
  }
  return models
}

const remembered = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }

// What the body is doing, from 0-1 image points (y grows downward).
function postureTag(p) {
  const v = (i) => (p[i]?.visibility ?? 1) > 0.5
  const mid = (a, b) => ({ x: (p[a].x + p[b].x) / 2, y: (p[a].y + p[b].y) / 2 })
  const sh = mid(11, 12), hip = mid(23, 24)
  const tags = []
  const torso = Math.hypot(sh.x - hip.x, sh.y - hip.y)
  if (v(11) && v(23) && Math.abs(sh.x - hip.x) > Math.abs(sh.y - hip.y) * 1.2) tags.push('Lying down')
  else if (v(25) && v(26) && v(23) && (p[25].y + p[26].y) / 2 - hip.y < torso * 0.45) tags.push('Sitting')
  else if (v(23)) tags.push('Standing')
  if ((v(15) && p[15].y < p[11].y) || (v(16) && p[16].y < p[12].y)) tags.push('Hand up')
  return tags
}

function faceTags(lm, shapes) {
  const blend = (name) => shapes?.categories.find((c) => c.categoryName === name)?.score ?? 0
  const turn = Math.abs((lm[1].x - lm[234].x) / ((lm[454].x - lm[234].x) || 1e-6) - 0.5)
  const tags = []
  if (turn < 0.15) tags.push('Facing you')
  if (blend('jawOpen') > 0.25) tags.push('Talking')
  return tags
}

export default function BodyMap({ videoRef }) {
  const [on, setOn] = useState(remembered)
  const [luma, setLuma] = useState('')
  const canvas = useRef()

  const toggle = () => {
    const next = !on
    setOn(next)
    setLuma('')
    try { localStorage.setItem(KEY, next ? '1' : '0') } catch { /* private window */ }
  }

  // Skeleton, face outline and tags, drawn every frame.
  useEffect(() => {
    if (!on) return
    let dead = false, raf = 0, last = 0
    loadModels().then(({ pose, face }) => {
      const draw = () => {
        if (dead) return
        raf = requestAnimationFrame(draw)
        const v = videoRef.current, c = canvas.current
        const now = performance.now()
        if (!v || !c || v.readyState < 2 || !v.videoWidth || now - last < 66) return // ~15 fps
        last = now
        const w = c.clientWidth, h = c.clientHeight
        if (c.width !== w * devicePixelRatio) { c.width = w * devicePixelRatio; c.height = h * devicePixelRatio }
        const ctx = c.getContext('2d')
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
        ctx.clearRect(0, 0, w, h)
        // The video is object-contain: map 0-1 points into the letterboxed picture.
        const scale = Math.min(w / v.videoWidth, h / v.videoHeight)
        const ox = (w - v.videoWidth * scale) / 2, oy = (h - v.videoHeight * scale) / 2
        const X = (x) => ox + x * v.videoWidth * scale, Y = (y) => oy + y * v.videoHeight * scale

        const bodies = pose.detectForVideo(v, now).landmarks ?? []
        const faces = face.detectForVideo(v, now)
        ctx.lineCap = 'round'
        bodies.forEach((p, i) => {
          const color = COLORS[i % COLORS.length]
          ctx.strokeStyle = color
          ctx.shadowColor = color
          ctx.shadowBlur = 12
          ctx.lineWidth = 4
          for (const { start, end } of PoseLandmarker.POSE_CONNECTIONS) {
            if (start < 11 || (p[start].visibility ?? 1) < 0.5 || (p[end].visibility ?? 1) < 0.5) continue // face points come from the face mesh
            ctx.beginPath(); ctx.moveTo(X(p[start].x), Y(p[start].y)); ctx.lineTo(X(p[end].x), Y(p[end].y)); ctx.stroke()
          }
          ctx.fillStyle = '#fff'
          for (const j of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
            if ((p[j].visibility ?? 1) < 0.5) continue
            ctx.beginPath(); ctx.arc(X(p[j].x), Y(p[j].y), 4, 0, Math.PI * 2); ctx.fill()
          }
          ctx.shadowBlur = 0
          chips(ctx, postureTag(p), X(p[0].x), Y(Math.min(p[11].y, p[12].y)) + 18, color)
        })
        ;(faces.faceLandmarks ?? []).forEach((lm, i) => {
          const color = COLORS[i % COLORS.length]
          ctx.strokeStyle = color
          ctx.lineWidth = 1.5
          ctx.globalAlpha = 0.9
          for (const set of [FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
            FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, FaceLandmarker.FACE_LANDMARKS_LIPS,
            FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS]) {
            ctx.beginPath()
            for (const { start, end } of set) { ctx.moveTo(X(lm[start].x), Y(lm[start].y)); ctx.lineTo(X(lm[end].x), Y(lm[end].y)) }
            ctx.stroke()
          }
          ctx.globalAlpha = 1
          chips(ctx, faceTags(lm, faces.faceBlendshapes?.[i]), X(lm[10].x), Y(lm[10].y) - 14, color)
        })
      }
      draw()
    }).catch(() => {})
    return () => { dead = true; cancelAnimationFrame(raf); canvas.current?.getContext('2d').clearRect(0, 0, canvas.current.width, canvas.current.height) }
  }, [on, videoRef])

  // "Luma sees ...": one still every few seconds to the brain, which asks Gemini and drops the photo.
  useEffect(() => {
    if (!on) return
    let dead = false
    const look = async () => {
      const v = videoRef.current
      if (dead || document.hidden || !v?.videoWidth) return
      const c = document.createElement('canvas')
      c.width = 512
      c.height = Math.max(1, Math.round((512 * v.videoHeight) / v.videoWidth))
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
      try {
        const r = await fetch('/api/describe', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jpeg: c.toDataURL('image/jpeg', 0.6), zone: 'living' }),
        }).then((x) => x.json())
        if (!dead && r.text) setLuma(r.text)
      } catch { /* brain busy or offline: keep the last line */ }
    }
    look()
    const t = setInterval(look, DESCRIBE_MS)
    return () => { dead = true; clearInterval(t) }
  }, [on, videoRef])

  return (
    <>
      <canvas ref={canvas} className="pointer-events-none absolute inset-0 z-[2] h-full w-full" aria-hidden="true" />
      <div className="absolute inset-x-0 top-3 z-[3] flex flex-col items-center gap-2 px-3">
        <button onClick={toggle} title="Draws a skeleton and face outline in this browser. The Luma line sends a still to the brain every few seconds."
          className={`glass-dark pointer-events-auto flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${on ? 'text-cyan-300' : 'text-zinc-300'} hover:text-white`}>
          <ScanFace size={14} /> Body map: {on ? 'on' : 'off'}
        </button>
        {on && luma && (
          <div className="glass-dark max-w-full rounded-2xl px-4 py-1.5 text-sm text-white">
            <b className="text-cyan-300">Luma sees:</b> {luma}
          </div>
        )}
      </div>
    </>
  )
}

function chips(ctx, tags, x, y, color) {
  if (!tags.length) return
  ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif'
  const text = tags.join(' · ')
  const w = ctx.measureText(text).width + 16
  ctx.fillStyle = 'rgba(0,0,0,0.65)'
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - 11, w, 22, 11); ctx.fill()
  ctx.fillStyle = color
  ctx.fillText(text, x - w / 2 + 8, y + 4)
}
