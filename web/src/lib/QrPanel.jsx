import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { ZONES } from './zones'

// Scan-to-join codes. They use whatever address this dashboard was opened from,
// so open the dashboard through the https tunnel link and the codes work on any phone.
const DEVICES = [
  ...Object.entries(ZONES).map(([id, z]) => [`${z.label} node`, `/node?zone=${id}&id=${id}`]),
  ['Headset', '/headset'],
  ['Bedside strobe', '/strobe'],
]

export default function QrPanel() {
  const [codes, setCodes] = useState([])
  useEffect(() => {
    Promise.all(DEVICES.map(([label, path]) =>
      QRCode.toDataURL(location.origin + path, { margin: 1, width: 240 }).then((src) => ({ label, path, src }))
    )).then(setCodes)
  }, [])

  return (
    <div className="mb-4 rounded-2xl border border-zinc-800 p-4">
      {location.protocol !== 'https:' && location.hostname !== 'localhost' && (
        <p className="mb-3 text-sm text-amber-400">Phones need https for camera and mic. Open this dashboard from the tunnel link.</p>
      )}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {codes.map((c) => (
          <a key={c.path} href={c.path} target="_blank" rel="noreferrer" className="text-center text-sm">
            <img src={c.src} alt={`QR code for ${c.label}`} className="mx-auto rounded bg-white" />
            <div className="mt-1">{c.label}</div>
          </a>
        ))}
      </div>
    </div>
  )
}
