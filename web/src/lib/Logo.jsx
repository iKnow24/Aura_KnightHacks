// Lumen mark: a dot with two rings, sound drawn as light.
export default function Logo({ size = 28, color = '#fbbf24' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="4.5" fill={color} />
      <circle cx="16" cy="16" r="9" stroke={color} strokeWidth="2" opacity="0.6" />
      <circle cx="16" cy="16" r="14" stroke={color} strokeWidth="1.5" opacity="0.3" />
    </svg>
  )
}
