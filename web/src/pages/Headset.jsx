import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { keepAwake, useBrain } from '../lib/useBrain'
import { alertText, SEVERITY_COLOR, ZONES, zoneLabel } from '../lib/zones'

// Fake AR: draw the rear camera twice side by side (one per eye) and put the HUD on top.
// Works on iOS and Android without WebXR.
// Direction uses 8 coarse sectors, not a precise arrow: indoor compass error is 15-30 degrees,
// and "glow on the left" that's right beats an arrow that's visibly wrong.

function useHeading() {
  const [heading, setHeading] = useState(0)
  const [offset, setOffset] = useState(0)
  const start = async () => {
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
      await DeviceOrientationEvent.requestPermission().catch(() => {})
    }
    const handler = (e) => {
      const h = e.webkitCompassHeading ?? (e.absolute ? 360 - e.alpha : null)
      if (h != null) setHeading(h)
    }
    window.addEventListener('deviceorientationabsolute', handler)
    window.addEventListener('deviceorientation', handler)
  }
  // "Recenter": whatever way you face now becomes forward (bearing 0).
  const recenter = () => setOffset(heading)
  return { heading: (heading - offset + 360) % 360, start, recenter }
}

function Eye({ stream, alert, sector }) {
  const ref = useRef()
  useEffect(() => { if (ref.current && stream) ref.current.srcObject = stream }, [stream])
  const angle = sector * 45
  return (
    <div className="relative h-full w-1/2 overflow-hidden">
      <video ref={ref} autoPlay playsInline muted className="h-full w-full object-cover" />
      <AnimatePresence>
        {alert && (
          <>
            <motion.div
              key="glow"
              className="pointer-events-none absolute inset-0"
              style={{ background: `radial-gradient(circle at ${50 + 50 * Math.sin((angle * Math.PI) / 180)}% ${50 - 50 * Math.cos((angle * Math.PI) / 180)}%, ${SEVERITY_COLOR[alert.severity]}cc, transparent 55%)` }}
              initial={{ opacity: 0 }} animate={{ opacity: [0.4, 1, 0.4] }} exit={{ opacity: 0 }}
              transition={{ duration: 1, repeat: Infinity }}
            />
            <motion.div key="label" className="absolute inset-x-0 bottom-[22%] text-center"
              initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }}>
              <span className="rounded-full bg-black/70 px-3 py-1 text-sm font-semibold">
                {alertText(alert.kind).icon} {alertText(alert.kind).text} · {zoneLabel(alert.zone)}
              </span>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function Headset() {
  const [stream, setStream] = useState(null)
  const [alert, setAlert] = useState(null)
  const { heading, start, recenter } = useHeading()
  useBrain('hud', (a) => {
    setAlert(a)
    navigator.vibrate?.([300, 100, 300])
    setTimeout(() => setAlert((cur) => (cur?.id === a.id ? null : cur)), 6000)
  })

  const begin = async () => {
    await start()
    await keepAwake()
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
    setStream(s)
    document.documentElement.requestFullscreen?.().catch(() => {})
  }

  const bearing = alert ? (ZONES[alert.zone]?.bearing ?? 0) : 0
  // "Behind you" comes from the rear camera, which turns with you: always the bottom edge.
  const sector = alert?.zone === 'behind' ? 4 : Math.round(((bearing - heading + 360) % 360) / 45) % 8

  if (!stream) {
    return (
      <button onClick={begin} className="grid h-full w-full place-items-center text-2xl">
        Tap to start headset view
      </button>
    )
  }
  return (
    <div className="flex h-full bg-black" onDoubleClick={recenter}>
      <Eye stream={stream} alert={alert} sector={sector} />
      <Eye stream={stream} alert={alert} sector={sector} />
    </div>
  )
}
