import { Copy, Share2 } from 'lucide-react'
import QRCode from 'qrcode'
import { brainOrigin, withBrain } from './brain'
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

// One link for people who just want to watch (judges, family): the dashboard on this same brain.
function ShareLink() {
  const [done, setDone] = useState('')
  const url = withBrain(location.origin + import.meta.env.BASE_URL.replace(/\/$/, '') + '/dashboard')
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setDone('Link copied') } catch { setDone('Copy failed: select the link') }
    setTimeout(() => setDone(''), 2500)
  }
  const share = () => navigator.share({ title: 'Lumen live dashboard', url }).catch(() => {})
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-zinc-900 p-3">
      <span className="font-semibold">Share the live dashboard</span>
      <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Dashboard link"
        className="min-w-0 flex-1 rounded-lg bg-black/40 px-3 py-1.5 text-sm text-zinc-300" />
      {navigator.share && (
        <button onClick={share} className="flex items-center gap-1 rounded-lg bg-amber-400 px-3 py-1.5 text-sm font-semibold text-black"><Share2 size={16} /> Share</button>
      )}
      <button onClick={copy} className="flex items-center gap-1 rounded-lg bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700"><Copy size={16} /> {done || 'Copy link'}</button>
    </div>
  )
}

export default function QrPanel() {
  const [codes, setCodes] = useState([])
  useEffect(() => {
    // BASE_URL keeps the sub-folder when hosted on GitHub Pages (/Aura_KnightHacks/).
    const base = location.origin + import.meta.env.BASE_URL.replace(/\/$/, '')
    // withBrain keeps a ?brain= address on the link, so a phone scanning this points at the same brain.
    Promise.all(DEVICES.map(([label, path, note]) => {
      const url = withBrain(base + path)
      return QRCode.toDataURL(url, { margin: 1, width: 240 }).then((src) => ({ label, note, url, src }))
    })).then(setCodes)
  }, [])

  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  return (
    <div className="glass mb-4 rounded-xl p-4">
      <ShareLink />
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
