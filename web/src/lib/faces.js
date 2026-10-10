import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { SPEAKER_COLORS as COLORS } from './zones'

// Faces in the headset camera: who is moving their lips, and who is facing the wearer.
// Runs on the phone; no video or face data leaves it. The model is vendored like the pose one.
//
// Lips + audio = speaker: while the mic hears speech, every face scores points for how much
// its mouth moves. When the transcript comes back, it goes to the face with the most points.
// No clock sync with the server needed.

let landmarker = null

export async function loadFaces() {
  if (landmarker) return landmarker
  const files = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task', delegate },
    runningMode: 'VIDEO',
    numFaces: 3,
    outputFaceBlendshapes: true,
  })
  try {
    landmarker = await FaceLandmarker.createFromOptions(files, options('GPU'))
  } catch {
    landmarker = await FaceLandmarker.createFromOptions(files, options('CPU'))
  }
  return landmarker
}

// Landmark indexes in MediaPipe's 478-point face mesh.
const NOSE = 1, LEFT_CHEEK = 234, RIGHT_CHEEK = 454, FOREHEAD = 10, CHIN = 152

const blend = (shapes, name) => shapes?.categories.find((c) => c.categoryName === name)?.score ?? 0

// One frame -> [{x, y, size, jaw, facing}] in 0-1 video coordinates. (x, y) = top of the head.
export function detectFaces(video, timestampMs) {
  if (!landmarker || video.readyState < 2) return []
  const result = landmarker.detectForVideo(video, timestampMs)
  return (result.faceLandmarks ?? []).map((lm, i) => {
    const shapes = result.faceBlendshapes?.[i]
    const left = lm[LEFT_CHEEK], right = lm[RIGHT_CHEEK]
    // Nose halfway between the cheeks = head turned toward the camera (the wearer).
    const turn = Math.abs((lm[NOSE].x - left.x) / (right.x - left.x || 1e-6) - 0.5)
    // Eyes looking sideways even with the head straight = not looking at you.
    const sideways = Math.max(
      blend(shapes, 'eyeLookOutLeft') + blend(shapes, 'eyeLookInRight'),
      blend(shapes, 'eyeLookInLeft') + blend(shapes, 'eyeLookOutRight'),
    )
    return {
      x: (left.x + right.x) / 2,
      y: lm[FOREHEAD].y,
      size: Math.abs(lm[CHIN].y - lm[FOREHEAD].y),
      jaw: blend(shapes, 'jawOpen'),
      facing: turn < 0.15 && sideways < 0.9,
    }
  })
}

// Keeps a stable id per person across frames (nearest face last frame) and their lip score.
export class FaceTracker {
  constructor() {
    this.people = [] // {id, color, x, y, size, facing, jawHistory: [], talk, score, seen}
    this.nextId = 1
  }

  update(faces, now, speechActive) {
    const unused = new Set(this.people)
    for (const f of faces) {
      let best = null, bestDist = 0.25
      for (const p of unused) {
        const d = Math.hypot(p.x - f.x, p.y - f.y)
        if (d < bestDist) { best = p; bestDist = d }
      }
      if (!best) {
        best = { id: this.nextId, color: COLORS[(this.nextId - 1) % COLORS.length], jawHistory: [], score: 0, facingScore: 0 }
        this.nextId++
        this.people.push(best)
      }
      unused.delete(best)
      Object.assign(best, { x: f.x, y: f.y, size: f.size, facing: f.facing, seen: now })
      best.jawHistory.push(f.jaw)
      if (best.jawHistory.length > 8) best.jawHistory.shift()
      // Talking = the jaw keeps opening and closing, not just hanging open.
      const h = best.jawHistory
      const mean = h.reduce((a, b) => a + b, 0) / h.length
      best.talk = Math.sqrt(h.reduce((a, b) => a + (b - mean) ** 2, 0) / h.length)
      if (speechActive) {
        best.score += best.talk
        best.facingScore += best.talk * (f.facing ? 1 : 0)
      }
    }
    // Forget people who left the frame a few seconds ago.
    this.people = this.people.filter((p) => now - p.seen < 3000)
    return this.people
  }

  // Called when a transcript arrives: who said it, and were they facing the wearer?
  claim() {
    const speaker = this.people.reduce((a, p) => (p.score > (a?.score ?? 0.05) ? p : a), null)
    const result = speaker && { id: speaker.id, color: speaker.color, toYou: speaker.facingScore > speaker.score / 2 }
    for (const p of this.people) { p.score = 0; p.facingScore = 0 }
    return result
  }
}

// Where a 0-1 video point lands inside an element showing the video with object-fit: cover.
export function toScreen(video, el, x, y) {
  const w = el.clientWidth, h = el.clientHeight
  const vw = video.videoWidth || w, vh = video.videoHeight || h
  const scale = Math.max(w / vw, h / vh)
  return { left: (w - vw * scale) / 2 + x * vw * scale, top: (h - vh * scale) / 2 + y * vh * scale }
}
