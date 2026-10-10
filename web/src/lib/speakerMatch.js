// Which visible face said this? Audio and video are timed on the same phone clock, so for a
// stretch of speech [start, end] we compare how much each face's mouth moved during exactly that
// stretch. The loudest or closest face is never assumed. If no face clearly moved more than the
// others, the answer is null and the caption goes to a neutral spot instead of the wrong person.
//
// Kept separate so more evidence can be added later without touching the UI: a voice-embedding
// diarizer (same voice as an earlier line), or a direction from a stereo mic / mic array. One
// mono phone mic can't tell direction, so none is used today.

export const MIN_TALK = 0.03 // average mouth movement that counts as talking (jaw spread, 0-1)
export const MARGIN = 1.6 // the winner must move its mouth this many times more than the next face

// Average mouth movement of one track during [start, end], and the share of that time it faced the camera.
export function mouthDuring(track, start, end) {
  const samples = track.activity.filter(([t]) => t >= start && t <= end)
  if (samples.length < 3) return { talk: 0, facing: 0, samples: samples.length }
  const talk = samples.reduce((a, s) => a + s[1], 0) / samples.length
  const facing = samples.reduce((a, s) => a + s[2], 0) / samples.length
  return { talk, facing, samples: samples.length }
}

// -> {id, color, toYou, confidence} or null when nobody is a clear match.
export function pickSpeaker(tracks, start, end, { minTalk = MIN_TALK, margin = MARGIN } = {}) {
  const scored = tracks.map((t) => ({ t, ...mouthDuring(t, start, end) })).sort((a, b) => b.talk - a.talk)
  const [best, next] = scored
  if (!best || best.talk < minTalk) return null
  const ratio = next ? best.talk / Math.max(next.talk, 1e-6) : Infinity
  if (ratio < margin) return null // two mouths moving about the same: could be either, so say neither
  const confidence = Math.min(1, (best.talk / (minTalk * 3)) * Math.min(1, ratio / (margin * 2)))
  return { id: best.t.id, color: best.t.color, toYou: best.facing > 0.5, confidence }
}
