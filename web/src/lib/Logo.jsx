import { motion, useReducedMotion } from 'framer-motion'
import { useId } from 'react'

// The Lumen mark, "Eclipse": a ring of light around a dark disk, with a bright bead where the light
// breaks through. The room goes quiet; Lumen is the light at the edge of it.
// It's the only color in the interface, the way a car badge is. `color` paints it one solid color
// (alerts tint it by severity). `live` slowly orbits the bead, for "listening" states.
const STOPS = [['0', '#FF8A3D'], ['.5', '#FF4F7B'], ['1', '#8B6CFF']]

export default function Logo({ size = 28, color, live = false, className = '' }) {
  const id = useId().replace(/:/g, '')
  const still = useReducedMotion()
  const paint = color ?? `url(#g${id})`
  const spin = live && !still
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={`g${id}`} x1="8" y1="56" x2="56" y2="8" gradientUnits="userSpaceOnUse">
          {STOPS.map(([o, c]) => <stop key={o} offset={o} stopColor={c} />)}
        </linearGradient>
        <mask id={`m${id}`}>
          <rect width="64" height="64" fill="#fff" />
          <circle cx="36" cy="28.5" r="18" fill="#000" />
        </mask>
      </defs>
      <motion.g style={{ transformOrigin: '32px 32px' }}
        animate={spin ? { rotate: 360 } : undefined}
        transition={spin ? { delay: 1.8, duration: 24, ease: 'linear', repeat: Infinity } : undefined}>
        {/* Live: the thin ring draws itself, the crescent fades in behind it, then the bead lights up. */}
        <motion.circle cx="32" cy="32" r="21" fill={paint} mask={`url(#m${id})`}
          initial={spin ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 1.2 }} />
        <motion.circle cx="32" cy="32" r="20.2" stroke={paint} strokeWidth="1.6" opacity=".9" style={{ rotate: -60, transformOrigin: '32px 32px' }}
          initial={spin ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={{ duration: 1.4, ease: [0.2, 0.7, 0.2, 1] }} />
        <motion.circle cx="50.2" cy="21.3" r="3" fill={color ? '#fff' : '#FFE3B8'} style={{ transformOrigin: '50.2px 21.3px' }}
          initial={spin ? { scale: 0 } : false} animate={spin ? { scale: [0, 1.6, 1] } : { scale: 1 }} transition={{ delay: 1.2, duration: 0.7 }} />
      </motion.g>
    </svg>
  )
}

// Mark plus the spaced-out uppercase wordmark, for headers and the sign-in screen.
export function Wordmark({ size = 16, live = false, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-[0.7em] font-medium uppercase tracking-[0.42em] ${className}`} style={{ fontSize: size }}>
      <Logo size={size * 1.6} live={live} />
      <span className="leading-none">Lumen</span>
    </span>
  )
}
