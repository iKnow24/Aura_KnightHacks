import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

// Faces in the wearer's camera: where each head is, how much its mouth moves, and whether it faces
// the wearer. Runs on the phone; no video or face data leaves it. The model is vendored like the
// pose one. Tracking ids: faceTracker.js. Matching speech to a face: speakerMatch.js.

let landmarker = null

export async function loadFaces() {
  if (landmarker) return landmarker
  const files = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`)
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}mediapipe/face_landmarker.task`, delegate },
    runningMode: 'VIDEO',
    numFaces: 4,
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

// One frame -> [{x, y, bottom, size, jaw, facing}] in 0-1 video coordinates. y = forehead, bottom = chin.
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
      bottom: lm[CHIN].y,
      size: Math.abs(lm[CHIN].y - lm[FOREHEAD].y),
      jaw: blend(shapes, 'jawOpen'),
      facing: turn < 0.15 && sideways < 0.9,
    }
  })
}

// Where a 0-1 video point lands inside an element showing the video with object-fit: cover (or contain).
export function toScreen(video, el, x, y, fit = 'cover') {
  const w = el.clientWidth, h = el.clientHeight
  const vw = video.videoWidth || w, vh = video.videoHeight || h
  const scale = (fit === 'contain' ? Math.min : Math.max)(w / vw, h / vh)
  return { left: (w - vw * scale) / 2 + x * vw * scale, top: (h - vh * scale) / 2 + y * vh * scale }
}
