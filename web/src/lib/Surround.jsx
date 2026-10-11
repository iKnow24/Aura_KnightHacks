import { motion } from 'framer-motion'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useFrontObjects } from './surroundings'
import { useWalking } from './walking'

// Three.js is ~150 KB gzipped: load it after the captions are already up.
const WalkScene = lazy(() => import('./WalkScene'))
const REAR_STALE_MS = 2500 // no message from the bag phone for this long = rear camera off
const VIEW_KEY = 'lumen.cornerView' // 'street' or 'room', remembered on this phone
// Room view (Gaussian splat scan) is switched off for the demo. Set true to bring back the tap toggle.
const ROOM_SCAN = false

// Lower-left corner of the captions screen: you, walking or standing, with what the front camera
// (this phone) and the back camera (a phone on your bag, /rear) can see around you.
// `rear` is the latest "scene" message from the brain. `raised` lifts it above the control bar.
export default function Surround({ videoRef, active, rear, raised }) {
  const walk = useWalking(active)
  const front = useFrontObjects(videoRef, active)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  // Tap the corner to switch between the street lines and a scan of the room (Gaussian splat).
  const [room, setRoom] = useState(() => { if (!ROOM_SCAN) return false; try { return localStorage.getItem(VIEW_KEY) === 'room' } catch { return false } })
  const pick = useCallback((on) => { setRoom(on); try { localStorage.setItem(VIEW_KEY, on ? 'room' : 'street') } catch { /* private mode */ } }, [])
  const roomFailed = useCallback((e) => { console.warn('Room view failed, back to street view', e); pick(false) }, [pick])
  const rearLive = !!rear && now - rear.at < REAR_STALE_MS
  const back = useMemo(() => (rearLive ? { objects: rear.objects, fov: rear.fov, live: true } : NO_REAR), [rear, rearLive])

  return (
    <motion.div onClick={(e) => { e.stopPropagation(); if (ROOM_SCAN) pick(!room) }}
      className="absolute left-3 z-10 h-[34%] w-[32%] overflow-hidden rounded-3xl border border-white/10 bg-[#111113] sm:w-[20%]"
      initial={false} animate={{ bottom: raised ? 'calc(max(0.75rem, env(safe-area-inset-bottom)) + 4.75rem)' : 'max(0.75rem, env(safe-area-inset-bottom))' }}
      transition={{ type: 'spring', stiffness: 260, damping: 30 }}>
      <Suspense fallback={null}>
        <WalkScene walk={walk} front={front} rear={back} room={room} onRoomFail={roomFailed} />
      </Suspense>
      {/* Which cameras are on shows as their cones in the scene, so the only words are this. */}
      <div className={`pointer-events-none absolute inset-x-0 bottom-0 pb-2 text-center text-[11px] font-semibold tracking-wide ${walk.walking ? 'text-white' : 'text-zinc-500'}`}>
        {room && 'ROOM · '}{walk.walking ? 'WALKING' : 'STANDING'}
      </div>
    </motion.div>
  )
}

const NO_REAR = { objects: [], fov: 50, live: false }
