import { useEffect } from 'react'
import { api } from './useBrain'

// Presenter-set sound direction. The presenter presses 1-4 on the dashboard (1 top right, 2 top left,
// 3 bottom right, 4 bottom left) and the wearer's screen glows in that corner for a few seconds.
// This is a demo control, not sound localization, so the screen always says "set by presenter".
// Real direction (which phone heard it loudest) is the SoundField panel and never goes through here.

const SPOT = {
  1: 'right-0 top-0 items-start justify-end',
  2: 'left-0 top-0 items-start justify-start',
  3: 'bottom-0 right-0 items-end justify-end',
  4: 'bottom-0 left-0 items-end justify-start',
}
const GLOW = {
  1: 'radial-gradient(circle at 100% 0%, rgba(251,191,36,0.55), transparent 62%)',
  2: 'radial-gradient(circle at 0% 0%, rgba(251,191,36,0.55), transparent 62%)',
  3: 'radial-gradient(circle at 100% 100%, rgba(251,191,36,0.55), transparent 62%)',
  4: 'radial-gradient(circle at 0% 100%, rgba(251,191,36,0.55), transparent 62%)',
}

// Dashboard: keys 1-4 tell the brain, which tells every wearer screen.
export function usePresenterKeys() {
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (/^(input|textarea|select)$/i.test(e.target?.tagName || '') || e.target?.isContentEditable) return
      if (['1', '2', '3', '4'].includes(e.key)) api('/api/presenter_dir', { corner: Number(e.key) }).catch(() => {})
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

// Wearer screen: the glow and its label.
export default function CornerMark({ corner }) {
  if (!corner) return null
  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      <div className="absolute inset-0" style={{ background: GLOW[corner] }} />
      <div className={`absolute flex p-4 ${SPOT[corner]}`}>
        <span className="rounded-full bg-black/70 px-3 py-1 text-xs text-zinc-100">Sound from here · direction set by presenter</span>
      </div>
    </div>
  )
}
