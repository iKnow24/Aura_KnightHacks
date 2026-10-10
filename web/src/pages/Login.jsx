import { motion } from 'framer-motion'
import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import Logo from '../lib/Logo'
import { getUser, signIn } from '../lib/user'

const field = 'mt-2 h-12 w-full rounded-md border border-white/10 bg-white/[0.04] px-4 text-[16px] outline-none transition placeholder:text-zinc-600 focus:border-white/40'
const fade = (delay) => ({ initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { delay, duration: 0.8, ease: [0.2, 0.7, 0.2, 1] } })

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
    <main className="flex min-h-full flex-col items-center justify-center px-6 py-16">
      <motion.div {...fade(0)}><Logo size={56} live /></motion.div>
      <motion.h1 {...fade(0.1)} className="mt-8 text-[13px] font-medium uppercase tracking-[0.5em] text-zinc-300">Lumen</motion.h1>
      <motion.p {...fade(0.2)} className="mt-4 text-center text-3xl font-semibold tracking-tight">Sound you can see.</motion.p>

      <motion.form {...fade(0.35)} onSubmit={submit} className="mt-14 w-full max-w-sm">
        <label className="block text-sm text-zinc-400">First name</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder="Sharan" />
        <p className="mt-2 text-xs text-zinc-500">Lumen alerts you when someone calls this name.</p>
        <label className="mt-6 block text-sm text-zinc-400">Home name <span className="text-zinc-600">(optional)</span></label>
        <input value={household} onChange={(e) => setHousehold(e.target.value)} className={field} placeholder="Home" />
        <button disabled={!name.trim()}
          className="mt-8 h-12 w-full rounded-md bg-amber-400 font-semibold text-black transition hover:bg-white disabled:bg-white/10 disabled:text-zinc-500">
          Continue
        </button>
      </motion.form>
      <motion.div {...fade(0.5)}>
        <Link to="/devices" className="mt-8 block text-sm text-zinc-500 underline-offset-4 transition hover:text-white hover:underline">
          Setting up a phone instead?
        </Link>
      </motion.div>
    </main>
  )
}
