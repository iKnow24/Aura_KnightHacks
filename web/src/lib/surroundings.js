import { FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision'
import { useEffect, useState } from 'react'

// What's around the wearer, from one phone camera at a time. The detector gives boxes; a box's
// left-right position gives the direction, and its height against the thing's real height gives a
// rough distance (a person ~1.7 m tall who fills 10% of the frame is far away). Expect ±30%:
// good enough for "car close behind on your left", not for measuring.
export const KINDS = {
  person: { kind: 'person', height: 1.7 },
  bicycle: { kind: 'bike', height: 1.1 },
  motorcycle: { kind: 'bike', height: 1.2 },
  car: { kind: 'car', height: 1.5 },
  truck: { kind: 'truck', height: 2.8 },
  bus: { kind: 'truck', height: 3.2 },
}
// A phone main camera sees about 75° corner to corner, whichever way it's held.
const DIAGONAL_FOV = 75

let detectorPromise
export function loadDetector() {
  detectorPromise ??= (async () => {
    const files = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: '/mediapipe/efficientdet_lite0.tflite', delegate },
      runningMode: 'VIDEO', scoreThreshold: 0.45, maxResults: 8,
    })
    try { return await ObjectDetector.createFromOptions(files, options('GPU')) } catch { return ObjectDetector.createFromOptions(files, options('CPU')) }
  })()
  return detectorPromise
}

const focal = (w, h) => Math.hypot(w, h) / 2 / Math.tan((DIAGONAL_FOV / 2) * Math.PI / 180)

// Horizontal field of view in degrees, for drawing the camera's cone.
export const cameraFov = (w, h) => 2 * Math.atan(w / 2 / focal(w, h)) * 180 / Math.PI

// Detections -> [{ kind, bearing (deg, + is right of the camera), dist (m) }]
export function toObjects(detections, w, h) {
  const f = focal(w, h)
  const out = []
  for (const d of detections) {
    const k = KINDS[d.categories[0]?.categoryName]
    if (!k) continue
    const b = d.boundingBox
    // A box cut off by the frame edge looks shorter than the thing is, so it reads too far.
    // Clamp to "close" instead; anything touching the bottom edge is near you anyway.
    const cut = b.originY + b.height > h * 0.97
    const dist = cut ? Math.min(2.5, (f * k.height) / b.height) : (f * k.height) / b.height
    const bearing = Math.atan((b.originX + b.width / 2 - w / 2) / f) * 180 / Math.PI
    out.push({ kind: k.kind, bearing: Math.round(bearing), dist: Math.round(Math.min(30, Math.max(1, dist)) * 10) / 10 })
  }
  return out
}

// Runs the detector on a <video> a few times a second and returns what's in front of the wearer.
export function useFrontObjects(videoRef, active, fps = 4) {
  const [front, setFront] = useState({ objects: [], fov: 50, live: false })
  useEffect(() => {
    if (!active) { setFront({ objects: [], fov: 50, live: false }); return }
    let dead = false, timer
    loadDetector().then((detector) => {
      if (dead) return
      timer = setInterval(() => {
        const v = videoRef.current
        if (!v || v.readyState < 2 || !v.videoWidth) return
        try {
          const { detections } = detector.detectForVideo(v, performance.now())
          setFront({ objects: toObjects(detections, v.videoWidth, v.videoHeight), fov: cameraFov(v.videoWidth, v.videoHeight), live: true })
        } catch { /* a dropped frame */ }
      }, 1000 / fps)
    }).catch(() => {})
    return () => { dead = true; clearInterval(timer) }
  }, [active, videoRef, fps])
  return front
}
