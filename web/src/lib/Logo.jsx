import { motion, useReducedMotion } from 'framer-motion'
import { useId } from 'react'

// The Lumen mark, "Eclipse": a ring of light around a dark disk, with a bright bead where the light
// breaks through. The room goes quiet; Lumen is the light at the edge of it.
// `color` paints it one solid color (alerts tint it by severity); otherwise it uses the brand gradient.
// `live` slowly orbits the bead and breathes the glow, for hero spots and "listening" states.
// Two alternates from the logo exploration are kept behind `variant` so swapping is one prop.
const STOPS = [['0', '#FF8A3D'], ['.5', '#FF4F7B'], ['1', '#8B6CFF']]

export default function Logo({ size = 28, color, live = false, variant = 'eclipse', className = '' }) {
  const id = useId().replace(/:/g, '')
  const still = useReducedMotion()
  const paint = color ?? `url(#g${id})`
  const grad = (
    <linearGradient id={`g${id}`} x1="8" y1="56" x2="56" y2="8" gradientUnits="userSpaceOnUse">
      {STOPS.map(([o, c]) => <stop key={o} offset={o} stopColor={c} />)}
    </linearGradient>
  )

  if (variant === 'settle') {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
        <defs>{grad}</defs>
        <path d={SETTLE} stroke={paint} strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  const spin = live && !still
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className} style={{ overflow: 'visible' }}>
      <defs>
        {grad}
        <mask id={`m${id}`}>
          <rect x="-8" y="-8" width="80" height="80" fill="#fff" />
          <circle cx="36" cy="28.5" r="18" fill="#000" />
        </mask>
        <filter id={`b${id}`} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3" /></filter>
      </defs>
      <motion.g
        style={{ transformOrigin: '32px 32px' }}
        animate={spin ? { rotate: 360 } : undefined}
        transition={spin ? { duration: 18, ease: 'linear', repeat: Infinity } : undefined}
      >
        <motion.circle cx="32" cy="32" r="21" fill={paint} mask={`url(#m${id})`} filter={`url(#b${id})`}
          initial={{ opacity: 0.6 }} animate={spin ? { opacity: [0.45, 0.9, 0.45] } : undefined}
          transition={spin ? { duration: 3.2, repeat: Infinity, ease: 'easeInOut' } : undefined} />
        <circle cx="32" cy="32" r="21" fill={paint} mask={`url(#m${id})`} />
        <circle cx="32" cy="32" r="20.2" stroke={paint} strokeWidth="1.6" opacity=".9" />
        <circle cx="50.2" cy="21.3" r="6" fill={color ?? '#FFB27A'} opacity=".4" filter={`url(#b${id})`} />
        <circle cx="50.2" cy="21.3" r="3" fill={color ? '#fff' : '#FFE3B8'} />
      </motion.g>
    </svg>
  )
}

// Logo plus the lowercase wordmark, for headers and the sign-in screen.
export function Wordmark({ size = 28, live = false, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-[0.32em] font-extrabold tracking-[-0.05em] ${className}`} style={{ fontSize: size }}>
      <Logo size={size * 1.05} live={live} />
      <span className="leading-none">lumen</span>
    </span>
  )
}

// "Settle" alternate: the L's foot is a sound wave calming into a flat line of text.
const SETTLE = (() => {
  const pts = []
  for (let k = 0; k <= 120; k++) {
    const t = k / 120
    const amp = 11 * Math.max(0, 1 - t / 0.78) ** 1.4
    pts.push(`${(24 + 28 * t).toFixed(2)},${(46 - amp * Math.sin(t * Math.PI * 3.2)).toFixed(2)}`)
  }
  return `M16 12 V40 Q16 46 22 46 H24 L${pts.join(' L')}`
})()
