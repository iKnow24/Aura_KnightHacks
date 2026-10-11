// Cameras for the dashboard's camera wall: room phones (their opt-in demo previews) and cameras
// plugged into this laptop (built-in webcam, USB webcams). Laptop cameras play right here in the
// browser; their video never goes to the brain.

export const SLOTS = ['center', 'left', 'right']

// Source ids: 'zone:kitchen' = the phone in that room (phone page ids change on every reload, rooms
// don't), 'cam:<deviceId>' = a camera on this laptop.
export const phoneSource = (zone) => `zone:${zone}`
export const localSource = (deviceId) => `cam:${deviceId}`

// Keeps the person's choices, drops sources that went away, and fills empty slots with unused
// sources (center first, phones before laptop cameras, in the order given).
export function fillSlots(slots, sourceIds) {
  const out = {}
  const used = new Set()
  for (const slot of SLOTS) {
    const id = slots?.[slot]
    if (id && sourceIds.includes(id) && !used.has(id)) { out[slot] = id; used.add(id) }
  }
  for (const slot of SLOTS) {
    if (out[slot]) continue
    const next = sourceIds.find((id) => !used.has(id))
    out[slot] = next ?? null
    if (next) used.add(next)
  }
  return out
}

// Show `id` in `slot`. If it was already on the wall, the two slots trade places.
export function assign(slots, slot, id) {
  const from = SLOTS.find((s) => slots[s] === id)
  const next = { ...slots, [slot]: id }
  if (from && from !== slot) next[from] = slots[slot]
  return next
}

const streams = new Map()

// One stream per laptop camera, shared by every tile and the avatar that show it.
export function openCamera(deviceId) {
  if (!streams.has(deviceId)) {
    const video = { width: { ideal: 1280 }, height: { ideal: 720 }, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) }
    streams.set(deviceId, navigator.mediaDevices.getUserMedia({ video, audio: false }).catch((e) => {
      streams.delete(deviceId)
      throw e
    }))
  }
  return streams.get(deviceId)
}

export function closeCameras() {
  for (const p of streams.values()) p.then((s) => s.getTracks().forEach((t) => t.stop()), () => {})
  streams.clear()
}

// Laptop cameras. Browsers hide camera names until the page has camera permission once, so
// `ask` opens and closes a camera first to unlock the names.
export async function listCameras(ask = false) {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  if (ask) (await navigator.mediaDevices.getUserMedia({ video: true })).getTracks().forEach((t) => t.stop())
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === 'videoinput' && d.deviceId)
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }))
}
