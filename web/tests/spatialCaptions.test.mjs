import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FaceTracker } from '../src/lib/faceTracker.js'
import { pickSpeaker } from '../src/lib/speakerMatch.js'
import { lastTwoLines } from '../src/lib/captionText.js'

// A face at (x, y) with a mouth that is opening and closing (talking) or still.
const face = (x, y, talking = false, frame = 0) => ({ x, y, bottom: y + 0.2, size: 0.2, facing: true, jaw: talking ? (frame % 2 ? 0.6 : 0.1) : 0.05 })

// Feeds frames 66 ms apart; scene(frame) returns that frame's faces.
function run(tracker, frames, scene, t0 = 0) {
  let visible = []
  for (let i = 0; i < frames; i++) visible = tracker.update(scene(i), t0 + i * 66)
  return { visible, end: t0 + (frames - 1) * 66 }
}

test('a new face gets a caption spot only after a few frames, so a one-frame glitch never does', () => {
  const tr = new FaceTracker()
  assert.equal(tr.update([face(0.5, 0.3)], 0).length, 0)
  assert.equal(tr.update([], 66).length, 0)
  assert.equal(tr.tracks.length, 0, 'the glitch is forgotten at once')
  const { visible } = run(tr, 4, () => [face(0.5, 0.3)], 200)
  assert.equal(visible.length, 1)
})

test('two people keep their ids while one walks across the frame', () => {
  const tr = new FaceTracker()
  const { visible } = run(tr, 3, () => [face(0.2, 0.3), face(0.8, 0.3)])
  const [a, b] = visible.map((t) => t.id)
  // Person at 0.2 walks right to 0.6 while the other stays at 0.8.
  const after = run(tr, 20, (i) => [face(0.2 + i * 0.02, 0.3), face(0.8, 0.3)], 300).visible
  const walker = after.find((t) => Math.abs(t.x - 0.58) < 0.03)
  const stander = after.find((t) => Math.abs(t.x - 0.8) < 0.01)
  assert.equal(walker.id, a)
  assert.equal(stander.id, b)
})

test('someone who looks away for a moment keeps their id; someone who leaves is dropped', () => {
  const tr = new FaceTracker()
  const id = run(tr, 4, () => [face(0.5, 0.3)]).visible[0].id
  run(tr, 10, () => [], 300) // 0.6 s out of view
  assert.equal(run(tr, 2, () => [face(0.52, 0.3)], 1000).visible[0].id, id)
  run(tr, 30, () => [], 1200) // 2 s gone
  assert.equal(tr.tracks.length, 0)
})

test('speech goes to the face whose mouth moved while it was said', () => {
  const tr = new FaceTracker()
  // Left talks first, then right talks.
  run(tr, 30, (i) => [face(0.2, 0.3, true, i), face(0.8, 0.3, false)])
  const { end } = run(tr, 30, (i) => [face(0.2, 0.3, false), face(0.8, 0.3, true, i)], 2000)
  const [left, right] = tr.tracks
  assert.equal(pickSpeaker(tr.tracks, 0, 1914)?.id, left.id)
  assert.equal(pickSpeaker(tr.tracks, 2000, end)?.id, right.id)
})

test('no confident match: both mouths moving, or nobody visibly talking, gives no speaker', () => {
  const tr = new FaceTracker()
  const { end } = run(tr, 30, (i) => [face(0.2, 0.3, true, i), face(0.8, 0.3, true, i)])
  assert.equal(pickSpeaker(tr.tracks, 0, end), null, 'overlapping speech')
  const quiet = new FaceTracker()
  const q = run(quiet, 30, () => [face(0.5, 0.3, false)])
  assert.equal(pickSpeaker(quiet.tracks, 0, q.end), null, 'voice from someone off camera')
  assert.equal(pickSpeaker([], 0, 1000), null, 'nobody in view')
})

test('captions keep the newest words, about two lines', () => {
  assert.equal(lastTwoLines('short line', 30), 'short line')
  const long = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen'
  const out = lastTwoLines(long, 20)
  assert.ok(out.length <= 41 && out.endsWith('fourteen') && out.startsWith('…'))
})
