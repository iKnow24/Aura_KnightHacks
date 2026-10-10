import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

// Pose tracking on the phone itself. Only the 33 body points leave the phone, never video.
// The model and the MediaPipe runtime are served from our own app (web/public/mediapipe),
// so this works even when venue Wi-Fi can't reach Google's CDN.

let landmarker = null

export async function loadPose() {
  if (landmarker) return landmarker
  const files = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`)
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}mediapipe/pose_landmarker_lite.task`, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
  })
  try {
    landmarker = await PoseLandmarker.createFromOptions(files, options('GPU'))
  } catch {
    landmarker = await PoseLandmarker.createFromOptions(files, options('CPU'))
  }
  return landmarker
}

// Returns [[x, y, visibility] x 33] for the first person in frame, or null if nobody is visible.
export function detectPose(video, timestampMs) {
  if (!landmarker || video.readyState < 2) return null
  const result = landmarker.detectForVideo(video, timestampMs)
  const person = result.landmarks?.[0]
  if (!person) return null
  return person.map((p) => [round(p.x), round(p.y), round(p.visibility ?? 1)])
}

// Same, in meters around the hips ([[x, y, z, visibility] x 33]), for posing a 3D figure.
// Used on the laptop only (dashboard avatar); nothing is sent anywhere.
export function detectPoseWorld(video, timestampMs) {
  if (!landmarker || video.readyState < 2) return null
  const person = landmarker.detectForVideo(video, timestampMs).worldLandmarks?.[0]
  return person ? person.map((p) => [p.x, p.y, p.z, p.visibility ?? 1]) : null
}

const round = (n) =>Math.round(n * 1000) / 1000

// Skeleton lines for the on-screen preview (MediaPipe landmark indexes).
export const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24],
  [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
]
