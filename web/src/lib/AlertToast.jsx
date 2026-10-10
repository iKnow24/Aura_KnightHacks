import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useState } from 'react'
import AlertIcon from './AlertIcon'
import Logo from './Logo'
import { api } from './useBrain'
import { alertText, SEVERITY_COLOR, zoneLabel } from './zones'

// Xbox-style alerts. A small Lumen badge pops in, unfurls into a pill that says what and where,
// and if nobody taps it, it keeps growing: a big card, then the whole screen flashing.
// One tap acknowledges it on every screen (the caregiver dashboard shows "seen at 2:14").
// Escalation times are shorter for critical alerts.
const ESCALATE = { critical: [3000, 8000], warning: [8000, 20000], info: [15000, null] }
const VIBRATE = [[200], [300, 100, 300], [600, 200, 600, 200, 600]]

export function useAlerts(by = 'wearer') {
  const [alerts, setAlerts] = useState([])
  const push = useCallback((a) => setAlerts((l) => (l.some((x) => x.id === a.id) ? l : [...l, a].slice(-3))), [])
  const drop = useCallback((id) => setAlerts((l) => l.filter((x) => x.id !== id)), [])
  const ack = useCallback((id) => {
    drop(id)
    navigator.vibrate?.(0)
    if (!String(id).startsWith('local-')) api('/api/ack', { id, by }).catch(() => {})
  }, [by, drop])
  return { alerts, push, drop, ack }
}

function ago(ts) {
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts))
  return s < 10 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`
}

function Toast({ alert, onAck }) {
  const [stage, setStage] = useState(0) // 0 badge, 1 pill, 2 big card, 3 full screen
  const [, tick] = useState(0)
  const [gone, setGone] = useState(false) // hide at once; the full-screen exit animation can hang
  const color = SEVERITY_COLOR[alert.severity] ?? SEVERITY_COLOR.info
  const { text } = alertText(alert.kind)

  useEffect(() => {
    const [big, full] = ESCALATE[alert.severity] ?? ESCALATE.info
    const timers = [setTimeout(() => setStage(1), 450)]
    if (big) timers.push(setTimeout(() => setStage(2), big))
    if (full) timers.push(setTimeout(() => setStage(3), full))
    const clock = setInterval(() => tick((n) => n + 1), 5000)
    return () => { timers.forEach(clearTimeout); clearInterval(clock) }
  }, [alert.id, alert.severity])

  useEffect(() => { if (stage > 0) navigator.vibrate?.(VIBRATE[stage - 1]) }, [stage])

  if (gone) return null
  if (stage === 3) {
    return (
      <motion.button
        onClick={() => { setGone(true); onAck(alert.id) }}
        className="pointer-events-auto fixed inset-0 z-50 grid place-items-center text-center"
        initial={{ opacity: 0 }} animate={{ opacity: 1, backgroundColor: [color, '#000000', color] }}
        exit={{ opacity: 0, transition: { duration: 0.15 } }}
        transition={{ backgroundColor: { duration: 0.8, repeat: Infinity } }}
      >
        <div>
          <motion.div className="mx-auto w-fit text-8xl" animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 0.8, repeat: Infinity }}><AlertIcon kind={alert.kind} strokeWidth={2.4} /></motion.div>
          <div className="mt-6 px-6 text-5xl font-black tracking-tight">{text}</div>
          <div className="mt-3 text-2xl opacity-90">{zoneLabel(alert.zone)}</div>
          <div className="mt-10 rounded-full bg-black/40 px-5 py-2 text-base">Tap anywhere: I've got it</div>
        </div>
      </motion.button>
    )
  }

  const big = stage === 2
  return (
    <motion.button
      layout
      onClick={() => onAck(alert.id)}
      initial={{ scale: 0, opacity: 0, y: -20 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ scale: 0.6, opacity: 0, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      className={`pointer-events-auto relative flex items-center overflow-hidden border text-left shadow-2xl backdrop-blur-xl
        ${stage === 0 ? 'h-14 w-14 justify-center rounded-full' : big ? 'w-[min(92vw,560px)] gap-5 rounded-3xl p-5' : 'gap-3 rounded-full py-2 pl-2 pr-6'}`}
      style={{ borderColor: `${color}aa`, background: `linear-gradient(135deg, ${color}26, rgba(10,9,16,.9) 45%), rgba(10,9,16,.88)`,
        boxShadow: `0 0 ${big ? 60 : 30}px ${color}55` }}
    >
      {big && (
        <motion.span className="pointer-events-none absolute inset-0 rounded-3xl border-2" style={{ borderColor: color }}
          animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1.1, repeat: Infinity }} />
      )}
      <motion.span layout className={`relative grid shrink-0 place-items-center rounded-full ${big ? 'h-20 w-20 text-5xl' : 'h-10 w-10 text-2xl'}`}
        style={{ background: `radial-gradient(circle, ${color}55, ${color}11)`, color }}>
        {stage === 0 ? <Logo size={26} color={color} /> : <AlertIcon kind={alert.kind} className="text-[0.8em]" />}
        <motion.span className="absolute inset-0 rounded-full border-2" style={{ borderColor: color }}
          animate={{ scale: [1, 1.6], opacity: [0.8, 0] }} transition={{ duration: 1.4, repeat: Infinity }} />
      </motion.span>
      {stage > 0 && (
        <motion.span layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="min-w-0">
          <span className={`block font-semibold leading-tight ${big ? 'text-3xl' : 'text-base'}`}>{text}</span>
          <span className={`block text-zinc-400 ${big ? 'mt-1 text-lg' : 'text-xs'}`}>
            {zoneLabel(alert.zone)} · {ago(alert.ts)}{big ? ' · tap when you’ve seen it' : ''}
          </span>
        </motion.span>
      )}
    </motion.button>
  )
}

export default function AlertStack({ alerts, onAck }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex flex-col items-center gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <AnimatePresence>
        {[...alerts].reverse().map((a) => <Toast key={a.id} alert={a} onAck={onAck} />)}
      </AnimatePresence>
    </div>
  )
}
