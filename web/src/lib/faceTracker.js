// Keeps one stable id per face across camera frames, and a short timed history of how much each
// face's mouth was moving. Ids are only "the same face as a moment ago": no face recognition,
// nothing about who anyone is, and nothing leaves the phone.
//
// Faces come in as {x, y, bottom, size, jaw, facing} in 0-1 video coordinates (see faces.js).

const COLORS = ['#fbbf24', '#38bdf8', '#f472b6', '#34d399', '#a78bfa', '#fb923c']
const MATCH = 1.5 // a face can move this many face-heights between frames and stay the same track
const LOST_MS = 1500 // a track survives this long without being seen (someone looks away, a hand passes)
const CONFIRM = 3 // frames before a new track is shown, so a one-frame false detection never gets a caption
const MOUTH_FRAMES = 8 // jaw samples used for "is this mouth moving"
const HISTORY_MS = 15000 // mouth-movement history kept for matching speech to a face

export class FaceTracker {
  constructor() {
    this.tracks = []
    this.nextId = 1
  }

  // One camera frame. Returns the confirmed tracks seen recently, oldest first.
  update(faces, now) {
    // Where each track should be now, if it kept moving the way it was.
    for (const t of this.tracks) {
      const dt = Math.min(now - t.seen, 300)
      t.px = t.x + t.vx * dt
      t.py = t.y + t.vy * dt
    }
    // Closest pairs first (distance in face-heights), so two people passing don't swap ids.
    const pairs = []
    faces.forEach((f, fi) => this.tracks.forEach((t) => {
      const d = Math.hypot(t.px - f.x, t.py - f.y) / Math.max(0.04, (t.size + f.size) / 2)
      if (d < MATCH) pairs.push([d, fi, t])
    }))
    pairs.sort((a, b) => a[0] - b[0])
    const usedFace = new Set(), usedTrack = new Set()
    for (const [, fi, t] of pairs) {
      if (usedFace.has(fi) || usedTrack.has(t)) continue
      usedFace.add(fi); usedTrack.add(t)
      this.#apply(t, faces[fi], now)
    }
    faces.forEach((f, fi) => {
      if (usedFace.has(fi)) return
      const t = { id: this.nextId, color: COLORS[(this.nextId - 1) % COLORS.length], hits: 0, vx: 0, vy: 0, jaws: [], activity: [] }
      this.nextId++
      this.tracks.push(t)
      this.#apply(t, f, now)
    })
    // Tentative tracks that vanish are dropped at once; confirmed ones get LOST_MS of grace.
    this.tracks = this.tracks.filter((t) => now - t.seen < (t.hits >= CONFIRM ? LOST_MS : 1))
    return this.visible(now)
  }

  #apply(t, f, now) {
    if (t.seen != null) {
      const dt = Math.max(1, now - t.seen)
      t.vx = 0.6 * t.vx + 0.4 * ((f.x - t.x) / dt)
      t.vy = 0.6 * t.vy + 0.4 * ((f.y - t.y) / dt)
    }
    Object.assign(t, { x: f.x, y: f.y, bottom: f.bottom ?? f.y + f.size, size: f.size, facing: f.facing, seen: now })
    t.hits++
    t.jaws.push(f.jaw)
    if (t.jaws.length > MOUTH_FRAMES) t.jaws.shift()
    // Talking = the jaw keeps opening and closing, not just hanging open: spread of recent jaw values.
    const mean = t.jaws.reduce((a, b) => a + b, 0) / t.jaws.length
    t.talk = Math.sqrt(t.jaws.reduce((a, b) => a + (b - mean) ** 2, 0) / t.jaws.length)
    t.activity.push([now, t.talk, f.facing ? 1 : 0])
    while (t.activity.length && now - t.activity[0][0] > HISTORY_MS) t.activity.shift()
  }

  visible(now) {
    return this.tracks.filter((t) => t.hits >= CONFIRM && now - t.seen < LOST_MS)
  }
}
