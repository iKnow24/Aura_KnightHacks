import { motion, useReducedMotion } from 'framer-motion'
import Logo from './Logo'

// HUD pieces, Iron Man style: thin warm lines and telemetry around the content, never on top of
// the words. Captions and alerts stay plain and high-contrast; this is only frames and motion.

const ring = (r, n, long = 5) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2
  const len = i % long === 0 ? 5 : 2.2
  const c = Math.cos(a), s = Math.sin(a)
  return <line key={i} x1={50 + r * c} y1={50 + r * s} x2={50 + (r - len) * c} y2={50 + (r - len) * s} />
})

const arc = (r, from, to) => {
  const p = (deg) => [50 + r * Math.cos((deg * Math.PI) / 180), 50 + r * Math.sin((deg * Math.PI) / 180)]
  const [x1, y1] = p(from), [x2, y2] = p(to)
  return `M${x1} ${y1} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`
}

const Spin = ({ children, dur, dir = 1, still }) => (
  <motion.g style={{ transformOrigin: '50px 50px' }} animate={still ? undefined : { rotate: 360 * dir }}
    transition={{ duration: dur, ease: 'linear', repeat: Infinity }}>{children}</motion.g>
)

// The Eclipse mark inside an arc-reactor housing: a tick ring and broken arcs turning against each other.
export function Reactor({ size = 200, color = '#ffd2b0' }) {
  const still = useReducedMotion()
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <div className="absolute inset-[18%] rounded-full bg-brand opacity-30 blur-2xl" />
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" fill="none" stroke={color} strokeLinecap="round" aria-hidden="true">
        <Spin dur={60} still={still}><g strokeWidth=".5" opacity=".55">{ring(49, 72, 6)}</g></Spin>
        <Spin dur={24} dir={-1} still={still}>
          <g strokeWidth="1.1" opacity=".8">
            <path d={arc(42, -80, 10)} /><path d={arc(42, 40, 120)} /><path d={arc(42, 150, 250)} />
          </g>
        </Spin>
        <Spin dur={14} still={still}>
          <g strokeWidth=".6" opacity=".45" strokeDasharray="1 2.4"><circle cx="50" cy="50" r="37" /></g>
        </Spin>
      </svg>
      <Logo size={size * 0.52} live className="-translate-x-[3%] translate-y-[5%]" />
    </div>
  )
}

// Four corner brackets around whatever box this sits in.
export function Brackets({ color = 'rgb(255 210 176 / 0.55)', len = 14, inset = 0 }) {
  const s = { position: 'absolute', width: len, height: len, borderColor: color }
  const w = 1.5
  return (
    <div className="pointer-events-none absolute" style={{ inset }} aria-hidden="true">
      <span style={{ ...s, left: 0, top: 0, borderLeftWidth: w, borderTopWidth: w }} />
      <span style={{ ...s, right: 0, top: 0, borderRightWidth: w, borderTopWidth: w }} />
      <span style={{ ...s, left: 0, bottom: 0, borderLeftWidth: w, borderBottomWidth: w }} />
      <span style={{ ...s, right: 0, bottom: 0, borderRightWidth: w, borderBottomWidth: w }} />
    </div>
  )
}

// Target lock around a tracked face: brackets plus a turning arc, brighter while they talk.
export function FaceLock({ left, top, size, color, talking }) {
  const box = Math.max(56, size * 1.35)
  return (
    <motion.div className="pointer-events-none absolute z-[14]" initial={{ opacity: 0, scale: 1.4 }}
      animate={{ opacity: talking ? 1 : 0.6, scale: 1, left: left - box / 2, top: top - box / 2, width: box, height: box }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
      <Brackets color={color} len={Math.max(10, box * 0.18)} />
      <svg viewBox="0 0 100 100" className="absolute inset-[-8%] h-[116%] w-[116%]" fill="none" stroke={color} strokeWidth="1" aria-hidden="true">
        <Spin dur={talking ? 3 : 9}><path d={arc(48, -30, 30)} /><path d={arc(48, 150, 210)} /></Spin>
      </svg>
    </motion.div>
  )
}

// Small uppercase monospace readout, the "telemetry" voice of the HUD.
export function Telemetry({ children, className = '' }) {
  return <div className={`font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300/70 ${className}`}>{children}</div>
}

// A slow radar sweep for the floor plan.
export function Sweep() {
  const still = useReducedMotion()
  if (still) return null
  return (
    <motion.div className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[160%] -translate-x-1/2 -translate-y-1/2 rounded-full"
      style={{ background: 'conic-gradient(from 0deg, transparent 84%, rgb(255 138 92 / 0.22) 100%)' }}
      animate={{ rotate: 360 }} transition={{ duration: 7, ease: 'linear', repeat: Infinity }} />
  )
}
