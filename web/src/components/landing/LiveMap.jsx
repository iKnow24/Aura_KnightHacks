import { motion, useReducedMotion } from 'framer-motion'
import { Laptop, Mic, Siren, Smartphone } from 'lucide-react'
import { useSyncExternalStore } from 'react'

// The live path as a map of the actual demo kit: four devices around the AMD brain, with light
// travelling along each wire in the direction the data goes. Only the devices we really run.
const DEVICES = [
  { id: 'mac', icon: Laptop, name: 'Mac', role: 'Camera in, dashboard out', flow: 'both' },
  { id: 'mic', icon: Mic, name: 'Mic phone', role: 'Hears the room', flow: 'in' },
  { id: 'wearer', icon: Smartphone, name: 'Wearer phone', role: 'Captions and alerts', flow: 'out' },
  { id: 'strobe', icon: Siren, name: 'Strobe phone', role: 'Flashes by the bed', flow: 'out' },
]
const MODELS = ['AST · sounds', 'Whisper · words', 'WavLM · voices', 'OWLv2 · objects']

// Coordinates in a 1000-wide box. Laptop: devices in the four corners. Phone: stacked top and bottom.
const LAYOUT = {
  wide: { h: 560, hub: [500, 280], at: { mac: [140, 120], mic: [140, 440], wearer: [860, 120], strobe: [860, 440] } },
  tall: { h: 1180, hub: [500, 590], at: { mac: [250, 150], mic: [750, 150], wearer: [250, 1030], strobe: [750, 1030] } },
}

const subscribe = (cb) => {
  const mq = window.matchMedia('(max-width: 640px)')
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
const useNarrow = () => useSyncExternalStore(subscribe, () => window.matchMedia('(max-width: 640px)').matches)

// A soft S-curve from a device to the hub.
function wire([x1, y1], [x2, y2], tall) {
  if (tall) {
    const my = (y1 + y2) / 2
    return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`
  }
  const mx = (x1 + x2) / 2
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`
}

export default function LiveMap() {
  const still = useReducedMotion()
  const tall = useNarrow()
  const L = tall ? LAYOUT.tall : LAYOUT.wide
  const pct = ([x, y]) => ({ left: `${x / 10}%`, top: `${(y / L.h) * 100}%` })

  return (
    <div className="relative mx-auto w-full max-w-6xl" style={{ aspectRatio: `1000 / ${L.h}` }}>
      <svg viewBox={`0 0 1000 ${L.h}`} className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id="wire" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FF8A3D" /><stop offset=".5" stopColor="#FF4F7B" /><stop offset="1" stopColor="#8B6CFF" />
          </linearGradient>
          <radialGradient id="pulse"><stop offset="0" stopColor="#fff" /><stop offset=".35" stopColor="#FFB38A" /><stop offset="1" stopColor="#FF4F7B" stopOpacity="0" /></radialGradient>
        </defs>
        {DEVICES.map((d, i) => {
          const path = wire(L.at[d.id], L.hub, tall)
          const back = d.flow === 'out'
          return (
            <g key={d.id}>
              <motion.path d={path} fill="none" stroke="url(#wire)" strokeWidth="1.5" strokeOpacity=".55"
                initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }}
                transition={{ delay: 0.2 + i * 0.12, duration: 1.4, ease: [0.2, 0.7, 0.2, 1] }} />
              {!still && [0, 1].map((k) => (
                <circle key={k} r="7" fill="url(#pulse)">
                  <animateMotion dur="2.6s" begin={`${i * 0.45 + k * 1.3}s`} repeatCount="indefinite" path={path}
                    keyPoints={back ? '1;0' : '0;1'} keyTimes="0;1" calcMode="linear" />
                </circle>
              ))}
              {!still && d.flow === 'both' && (
                <circle r="5" fill="url(#pulse)">
                  <animateMotion dur="2.6s" begin={`${0.9 + i * 0.45}s`} repeatCount="indefinite" path={path} keyPoints="1;0" keyTimes="0;1" calcMode="linear" />
                </circle>
              )}
            </g>
          )
        })}
      </svg>

      {/* The brain: a ring of light with the four models around it. */}
      <div className="absolute -translate-x-1/2 -translate-y-1/2" style={pct(L.hub)}>
        <div aria-hidden className="absolute left-1/2 top-1/2 size-[min(40vw,320px)] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40 blur-[60px]"
          style={{ background: 'radial-gradient(circle, #FF4F7B, #8B6CFF 55%, transparent 70%)' }} />
        <motion.div initial={{ scale: 0.7, opacity: 0 }} whileInView={{ scale: 1, opacity: 1 }} viewport={{ once: true }} transition={{ duration: 1.1, ease: [0.2, 0.7, 0.2, 1] }}
          className="relative flex size-[clamp(140px,19vw,220px)] flex-col items-center justify-center rounded-full text-center"
          style={{ background: 'radial-gradient(circle at 50% 35%, rgb(255 255 255 / 0.10), rgb(11 11 12 / 0.92) 70%)', boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.12), 0 0 80px rgb(255 79 123 / 0.25)' }}>
          {!still && <span aria-hidden className="absolute inset-[-10px] animate-[spin_14s_linear_infinite] rounded-full" style={{ background: 'conic-gradient(from 0deg, transparent 0 70%, #FF8A3D, #FF4F7B, #8B6CFF, transparent)', mask: 'radial-gradient(circle, transparent calc(50% - 1.5px), #000 calc(50% - 1px))', WebkitMask: 'radial-gradient(circle, transparent calc(50% - 1.5px), #000 calc(50% - 1px))' }} />}
          <p className="text-[10px] font-medium uppercase tracking-[0.35em] text-zinc-400">The brain</p>
          <p className="mt-2 text-[clamp(1rem,1.7vw,1.35rem)] font-semibold leading-tight tracking-tight">AMD Radeon</p>
          <p className="mt-1 text-[11px] text-zinc-500">one GPU in the cloud</p>
        </motion.div>
        <div className="pointer-events-none absolute left-1/2 top-1/2 size-[clamp(250px,32vw,380px)] -translate-x-1/2 -translate-y-1/2">
          {MODELS.map((m, i) => {
            const a = (-90 + i * 90 + 45) * (Math.PI / 180)
            return (
              <motion.span key={m} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.8 + i * 0.1, duration: 0.8 }}
                className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-white/10 bg-ink/80 px-3 py-1 text-[11px] text-zinc-300 backdrop-blur"
                style={{ left: `${50 + 50 * Math.cos(a)}%`, top: `${50 + 50 * Math.sin(a)}%` }}>
                {m}
              </motion.span>
            )
          })}
        </div>
      </div>

      {DEVICES.map(({ id, icon: Icon, name, role, flow }, i) => (
        <motion.div key={id} className="absolute -translate-x-1/2 -translate-y-1/2" style={pct(L.at[id])}
          initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 + i * 0.1, duration: 0.9 }}>
          <div className="flex w-[clamp(150px,17vw,210px)] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 shadow-[0_20px_60px_-20px_rgb(0_0_0_/_0.8)] backdrop-blur-xl">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06]"><Icon size={18} strokeWidth={1.6} /></span>
            <span className="min-w-0 text-left">
              <span className="block text-sm font-semibold leading-tight">{name}</span>
              <span className="block text-[11px] leading-snug text-zinc-500">{role}</span>
            </span>
          </div>
          <p className="mt-2 text-center text-[10px] uppercase tracking-[0.3em] text-zinc-600">{flow === 'in' ? 'sends' : flow === 'out' ? 'receives' : 'both ways'}</p>
        </motion.div>
      ))}
    </div>
  )
}
