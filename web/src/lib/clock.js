// The brain and this browser are two different computers, so their clocks don't agree. Captions
// carry the time the words were *said* (start_ts/end_ts, brain clock) and the camera here times
// faces on performance.now(). To put a line over the right head we have to line the two up.
//
// How: every message from the brain gives one sample of (our clock - its clock). That sample is
// the real offset plus however long the message took to arrive, so the smallest sample we've seen
// recently is the closest to the truth. Nothing is measured until a message arrives, so with no
// samples yet we fall back to treating the clocks as equal.

const EPOCH_PERF = Date.now() - performance.now() // epoch ms at performance.now() == 0
const FRESH_MS = 60_000 // drop the best sample after a minute, so slow drift is re-measured

let best = null
let bestAt = 0

// Call with the brain's timestamp on every message, as soon as it arrives.
export function noteServerTime(ts) {
  if (!ts) return
  const delta = Date.now() / 1000 - ts
  if (best === null || delta < best || Date.now() - bestAt > FRESH_MS) {
    best = delta
    bestAt = Date.now()
  }
}

export const clockKnown = () => best !== null

// A brain timestamp (seconds) -> this browser's performance.now() milliseconds.
export function serverToPerf(ts) {
  return (ts + (best ?? 0)) * 1000 - EPOCH_PERF
}
