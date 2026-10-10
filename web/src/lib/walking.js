import { useEffect, useRef, useState } from 'react'

// Is the wearer walking? Counts steps from the phone's accelerometer: each footfall is a bump in
// acceleration, and walking is several bumps in a steady rhythm (about 1.3 to 3 a second). Phone
// shake or a single bump doesn't count. No library; iPhone needs the motion permission, which the
// captions Start button already asks for. On a laptop (no motion sensor) press W to toggle.
const STEP_MIN_GAP = 0.28 // s between steps (fast walk / jog)
const STEP_MAX_GAP = 1.0 // s; slower than this isn't walking
const PEAK = 0.9 // m/s² above the running mean to count as a footfall
const STOP_AFTER = 1.3 // s with no step before the figure stands still

export async function askMotion() {
  if (typeof DeviceMotionEvent?.requestPermission === 'function') await DeviceMotionEvent.requestPermission().catch(() => {})
}

export function useWalking(active) {
  const [walk, setWalk] = useState({ walking: false, cadence: 0, sensor: false, forced: null })
  const forced = useRef(null)

  useEffect(() => {
    if (!active) return
    let mean = 9.81, smooth = 0, prev = 0, rising = false, lastPeak = 0
    let steps = [] // timestamps (s) of recent steps
    let sensor = false

    const onMotion = (e) => {
      const a = e.acceleration?.x != null ? e.acceleration : e.accelerationIncludingGravity
      if (a?.x == null) return
      sensor = true
      const t = performance.now() / 1000
      const mag = Math.hypot(a.x, a.y, a.z)
      mean += (mag - mean) * 0.02 // slow average = gravity (or ~0 for linear acceleration)
      smooth += (mag - mean - smooth) * 0.3 // light low-pass to drop hand jitter
      // A peak: was rising, now falling, high enough, and not too soon after the last one.
      if (smooth < prev && rising && prev > PEAK && t - lastPeak > STEP_MIN_GAP) {
        lastPeak = t
        steps = [...steps.filter((s) => t - s < 3), t]
      }
      rising = smooth > prev
      prev = smooth
    }

    const judge = () => {
      const t = performance.now() / 1000
      steps = steps.filter((s) => t - s < 3)
      const gaps = steps.slice(1).map((s, i) => s - steps[i])
      const avg = gaps.reduce((a, b) => a + b, 0) / (gaps.length || 1)
      const spread = Math.sqrt(gaps.reduce((a, g) => a + (g - avg) ** 2, 0) / (gaps.length || 1))
      const rhythmic = gaps.length >= 2 && avg < STEP_MAX_GAP && spread < avg * 0.35
      const walking = rhythmic && t - steps[steps.length - 1] < STOP_AFTER
      const cadence = walking ? 1 / avg : 0
      const f = forced.current
      setWalk((w) => {
        const next = { walking: f ?? walking, cadence: f ? 1.8 : cadence, sensor, forced: f }
        return w.walking === next.walking && Math.abs(w.cadence - next.cadence) < 0.15 && w.sensor === sensor && w.forced === f ? w : next
      })
    }

    const onKey = (e) => {
      if (e.key !== 'w' && e.key !== 'W') return
      if (e.target?.closest?.('input, textarea')) return
      forced.current = forced.current ? null : true
      judge()
    }

    window.addEventListener('devicemotion', onMotion)
    window.addEventListener('keydown', onKey)
    const timer = setInterval(judge, 250)
    return () => { window.removeEventListener('devicemotion', onMotion); window.removeEventListener('keydown', onKey); clearInterval(timer) }
  }, [active])

  return walk
}
