// Spill watch for a phone that is sitting still (propped on a counter, looking down).
// EfficientDet knows people and cars. It does not know "a puddle". So: learn what the
// counter looks like, ignore anyone the person detector sees, and call it a spill when a
// new blob sits still for about a second. A dark drink (coffee, soda) shows up. Clear
// water on a white counter often does not.

const W = 80
const H = 60
const DIFF = 28

function covered(nx, ny, boxes, vw, vh) {
  for (const b of boxes) {
    const x0 = b.originX / vw - 0.05
    const y0 = b.originY / vh - 0.05
    const x1 = (b.originX + b.width) / vw + 0.05
    const y1 = (b.originY + b.height) / vh + 0.1
    if (nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1) return true
  }
  return false
}

export function createSpillWatch() {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  let bg = null
  let readyAt = 0
  let still = 0
  let anchor = null

  return function check(video, boxes, now) {
    if (!video?.videoWidth) return { status: 'waiting for camera' }
    ctx.drawImage(video, 0, 0, W, H)
    const px = ctx.getImageData(0, 0, W, H).data
    const gray = new Float32Array(W * H)
    for (let i = 0; i < gray.length; i++) {
      gray[i] = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11
    }
    if (!bg) {
      bg = gray
      readyAt = now + 1500
      return { status: 'learning the counter…' }
    }
    if (now < readyAt) {
      for (let i = 0; i < gray.length; i++) bg[i] = bg[i] * 0.8 + gray[i] * 0.2
      return { status: 'learning the counter…' }
    }

    let count = 0
    let minX = W, minY = H, maxX = 0, maxY = 0
    const vw = video.videoWidth
    const vh = video.videoHeight
    for (let y = Math.floor(H * 0.12); y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        if (Math.abs(gray[i] - bg[i]) < DIFF) continue
        if (covered(x / W, y / H, boxes, vw, vh)) continue
        count++
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
    const area = count / (W * H)
    if (area < 0.02 || area > 0.4) {
      still = 0
      anchor = null
      if (area < 0.02) {
        for (let i = 0; i < gray.length; i++) bg[i] = bg[i] * 0.98 + gray[i] * 0.02
      }
      return { status: 'watching for a spill — use coffee or soda', area }
    }
    const bw = (maxX - minX) / W
    const bh = (maxY - minY) / H
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    if (anchor && Math.hypot(cx - anchor.cx, cy - anchor.cy) < 5) still += 1
    else still = 1
    anchor = { cx, cy }
    // A puddle sits wider than it is tall. A person the detector missed is tall and gets skipped.
    if (still >= 5 && bw >= bh * 0.75) {
      still = 0
      anchor = null
      bg = gray.slice()
      return { status: 'spill seen', hit: true, area, score: Math.min(0.95, 0.55 + area) }
    }
    return { status: 'something changed — holding still…', area }
  }
}
