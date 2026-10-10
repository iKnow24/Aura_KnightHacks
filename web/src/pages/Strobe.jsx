import { useRef, useState } from 'react'
import { api, keepAwake, useBrain } from '../lib/useBrain'
import { ALERT_TEXT, ZONES } from '../lib/zones'

// Bedside phone for Night mode. Screen flashes red, phone vibrates, and the flashlight
// strobes (Android Chrome only: iPhone can't control the torch or vibrate from the web).

export default function Strobe() {
  const [armed, setArmed] = useState(false)
  const [alert, setAlert] = useState(null)
  const torch = useRef(null)

  useBrain('strobe', (a) => {
    if (a.severity !== 'critical') return
    setAlert(a)
    navigator.vibrate?.(Array(20).fill(400))
    let on = false
    const id = setInterval(() => {
      on = !on
      torch.current?.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {})
    }, 250)
    setTimeout(() => clearInterval(id), 15000)
  })

  const arm = async () => {
    await keepAwake()
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      torch.current = s.getVideoTracks()[0]
    } catch { /* no torch on this device: screen flash still works */ }
    setArmed(true)
  }

  if (!armed) return <button onClick={arm} className="h-full w-full text-2xl">Tap to arm bedside alerts</button>
  if (!alert) return <div className="grid h-full place-items-center text-zinc-700">armed · sleeping</div>
  return (
    <button onClick={() => { api('/api/ack', { id: alert.id, by: 'bedside' }).catch(() => {}); setAlert(null); navigator.vibrate?.(0); torch.current?.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {}) }}
      className="grid h-full w-full animate-pulse place-items-center bg-red-600 text-center">
      <div>
        <div className="text-7xl">{ALERT_TEXT[alert.kind]?.icon}</div>
        <div className="mt-4 text-4xl font-black">{ALERT_TEXT[alert.kind]?.text}</div>
        <div className="mt-2 text-2xl">{ZONES[alert.zone]?.label}</div>
        <div className="mt-8 text-sm opacity-80">tap to dismiss</div>
      </div>
    </button>
  )
}
