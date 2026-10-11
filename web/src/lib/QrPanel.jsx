import QRCode from 'qrcode'
import { useEffect, useState } from 'react'

// Phones for the pitch. The address is whatever this dashboard was opened from,
// so open it through the https tunnel link and the codes work on any phone.
const DEVICES = [
  ['Headset', '/captions'],
  ['Room phone', '/node?zone=kitchen'],
  ['Back cam', '/rear'],
  ['Bedside strobe', '/strobe'],
  ['Extra mic', '/mic?name=Mic'],
  ['Security camera', '/node?zone=drone&id=drone&preview=1'],
]

export default function QrPanel() {
  const [codes, setCodes] = useState([])
  useEffect(() => {
    // BASE_URL keeps the sub-folder when hosted on GitHub Pages (/Aura_KnightHacks/).
    const base = location.origin + import.meta.env.BASE_URL.replace(/\/$/, '')
    Promise.all(DEVICES.map(([label, path, note]) =>
      QRCode.toDataURL(base + path, { margin: 1, width: 240 }).then((src) => ({ label, note, url: base + path, src }))
    )).then(setCodes)
  }, [])

  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  return (
    <div className="glass mb-4 rounded-xl p-4">
      <h2 className="font-semibold">Add a phone</h2>
      <p className="mb-3 text-sm text-zinc-400">Scan a code, or open the same link on the other phone. Each phone is one page.</p>
      {local && (
        <p className="mb-3 text-sm text-amber-400">These codes point at this computer only. Open the dashboard from the Cloudflare link, then scan.</p>
      )}
      {location.protocol !== 'https:' && !local && (
        <p className="mb-3 text-sm text-amber-400">Phones need https for camera and mic. Open this dashboard from the tunnel link.</p>
      )}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {codes.map((c) => (
          <a key={c.url} href={c.url} target="_blank" rel="noreferrer" className="text-center text-sm">
            <img src={c.src} alt={`QR code for ${c.label}`} className="mx-auto rounded-xl bg-white p-1" />
            <div className="mt-1">{c.label}</div>
            {c.note && <div className="text-zinc-400">{c.note}</div>}
          </a>
        ))}
      </div>
    </div>
  )
}
