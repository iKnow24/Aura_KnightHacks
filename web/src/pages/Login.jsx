import { motion } from 'framer-motion'
import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { getUser, signIn } from '../lib/user'

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
    <main className="relative flex min-h-full items-center justify-center overflow-hidden p-4">
      {/* Slow pulsing glow: the same "light instead of sound" idea as the headset. */}
      <motion.div
        className="pointer-events-none absolute h-[520px] w-[520px] rounded-full bg-amber-500/20 blur-3xl"
        animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.9, 0.5] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 backdrop-blur"
      >
        <h1 className="text-4xl font-bold tracking-tight">Lumen</h1>
        <p className="mt-1 text-zinc-400">Sound you can see. A home that remembers.</p>
        <label className="mt-6 block text-sm text-zinc-400">Your first name</label>
        <input
          autoFocus value={name} onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-lg bg-zinc-900 px-3 py-2 outline-none ring-amber-400 focus:ring-2"
          placeholder="Sharan"
        />
        <p className="mt-1 text-xs text-zinc-500">Lumen alerts you when someone calls this name.</p>
        <label className="mt-4 block text-sm text-zinc-400">Home name (optional)</label>
        <input
          value={household} onChange={(e) => setHousehold(e.target.value)}
          className="mt-1 w-full rounded-lg bg-zinc-900 px-3 py-2 outline-none ring-amber-400 focus:ring-2"
          placeholder="Home"
        />
        <button disabled={!name.trim()} className="mt-6 w-full rounded-lg bg-amber-400 py-2 font-semibold text-black disabled:opacity-40">
          Sign in
        </button>
        <Link to="/devices" className="mt-4 block text-center text-sm text-zinc-500 hover:text-zinc-300">
          Setting up a phone or the headset? →
        </Link>
      </motion.form>
    </main>
  )
}
