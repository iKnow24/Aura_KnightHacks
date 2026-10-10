import { motion } from 'framer-motion'
import { ArrowRight, Smartphone } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import AlertIcon from '../lib/AlertIcon'
import Logo from '../lib/Logo'
import { getUser, signIn } from '../lib/user'

// What Lumen does, shown instead of told: a few of the things it would have caught today.
const DRIFT = [
  ['kettle', 'Kettle boiling', 'Kitchen', '#f59e0b', { left: '6%', top: '14%' }],
  ['name_called', 'Maya called your name', 'Living room', '#ff4f7b', { right: '5%', top: '22%' }],
  ['doorbell', 'Doorbell', 'Hallway', '#8b6cff', { left: '9%', bottom: '16%' }],
]

const field = 'mt-1.5 h-12 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-[17px] outline-none transition placeholder:text-zinc-600 focus:border-amber-400/60 focus:bg-white/[0.09]'

export default function Login() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [household, setHousehold] = useState('')
  if (getUser()) return <Navigate to="/dashboard" replace />

  const submit = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    signIn(name, household)
    navigate('/dashboard')
  }

  return (
    <main className="relative flex min-h-full flex-col items-center justify-center overflow-hidden px-4 py-10">
      {/* Floating example alerts, hidden on small phones where they'd crowd the form. */}
      {DRIFT.map(([kind, text, room, color, pos], i) => (
        <motion.div key={kind} className="glass pointer-events-none absolute hidden items-center gap-3 rounded-full py-2 pl-2 pr-5 md:flex"
          style={pos} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: [0, -10, 0] }}
          transition={{ opacity: { delay: 0.6 + i * 0.25 }, y: { duration: 6 + i, repeat: Infinity, ease: 'easeInOut' } }}>
          <span className="grid h-9 w-9 place-items-center rounded-full text-lg" style={{ background: `${color}2e`, color }}><AlertIcon kind={kind} /></span>
          <span className="text-sm"><span className="block font-semibold leading-tight">{text}</span><span className="text-xs text-zinc-400">{room} · just now</span></span>
        </motion.div>
      ))}

      <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
        className="relative mb-6">
        <div className="absolute inset-0 -z-10 scale-150 rounded-full bg-brand opacity-25 blur-3xl" />
        <Logo size={104} live />
      </motion.div>
      <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
        className="text-6xl font-extrabold tracking-[-0.06em]">lumen</motion.h1>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
        className="mt-2 text-center text-lg text-zinc-400">Sound you can see.<br className="sm:hidden" /> <span className="text-gradient font-semibold">A home that remembers.</span></motion.p>

      <motion.form onSubmit={submit} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, type: 'spring', stiffness: 200, damping: 24 }}
        className="glass relative mt-8 w-full max-w-sm rounded-[28px] p-6">
        <label className="block text-sm font-medium text-zinc-300">Your first name</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder="Sharan" />
        <p className="mt-1.5 text-xs text-zinc-500">Lumen lights up when someone calls this name.</p>
        <label className="mt-5 block text-sm font-medium text-zinc-300">Home name <span className="text-zinc-600">(optional)</span></label>
        <input value={household} onChange={(e) => setHousehold(e.target.value)} className={field} placeholder="Home" />
        <motion.button whileTap={{ scale: 0.97 }} disabled={!name.trim()}
          className="group mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 font-bold text-black transition disabled:bg-none disabled:bg-white/[0.07] disabled:text-zinc-500 disabled:shadow-none">
          Enter your home <ArrowRight size={18} className="transition group-hover:translate-x-0.5" />
        </motion.button>
      </motion.form>
      <Link to="/devices" className="mt-5 flex items-center gap-2 text-sm text-zinc-400 transition hover:text-white">
        <Smartphone size={16} /> Setting up a phone? Pick its role
      </Link>
    </main>
  )
}
