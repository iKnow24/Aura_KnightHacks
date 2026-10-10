import { motion } from 'framer-motion'
import { ArrowLeft, AudioLines, BedDouble, Glasses, LayoutDashboard, Mic, Radar, ScanLine } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Wordmark } from '../lib/Logo'

const PAGES = [
  ['/captions', 'Live captions', 'The wearer\'s phone. Words as they\'re spoken, Home / Lecture / Outside modes, alerts that grow until you tap them.', AudioLines, '#ff4f7b'],
  ['/dashboard', 'Caregiver dashboard', 'Laptop or tablet. Floor plan, live alerts, Ask Lumen, mode switch. Needs sign in.', LayoutDashboard, '#8b6cff'],
  ['/headset', 'Headset HUD', 'Phone in the AR headset. Camera passthrough with edge glow toward the alert.', Glasses, '#38bdf8'],
  ['/node?zone=kitchen', 'Camera/mic node', 'Any spare phone. Change ?zone= to the room it sits in. Listens, tracks falls, remembers where things are.', ScanLine, '#34d399'],
  ['/mic', 'Speaker mic', 'One phone in front of each person you talk to. Captions get labeled with their name.', Mic, '#ff8a3d'],
  ['/rear', 'Rear guard', 'Outside mode. A phone on the back of your bag that warns you when someone or something comes up behind you.', Radar, '#facc15'],
  ['/strobe', 'Bedside strobe', 'Android phone by the bed. Flashes and vibrates on critical alerts (Night mode).', BedDouble, '#f87171'],
]

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-4 pb-12 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="flex items-center justify-between">
        <Wordmark size={26} />
        <Link to="/" className="flex items-center gap-1.5 text-sm text-zinc-400 transition hover:text-white"><ArrowLeft size={15} /> Caregiver sign in</Link>
      </div>
      <h1 className="mt-10 text-4xl font-extrabold tracking-[-0.04em]">What is this phone for?</h1>
      <p className="mt-2 text-zinc-400">Every device is just a web page. Open one per phone and it becomes part of the house.</p>
      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {PAGES.map(([to, title, desc, Icon, color], i) => (
          <motion.li key={to} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Link to={to} className="glass group flex h-full gap-4 rounded-3xl p-4 transition hover:-translate-y-0.5 hover:border-white/20">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl" style={{ background: `linear-gradient(140deg, ${color}40, ${color}10)`, color, boxShadow: `inset 0 1px 0 ${color}50` }}>
                <Icon size={22} strokeWidth={2} />
              </span>
              <span>
                <span className="block font-bold">{title}</span>
                <span className="mt-0.5 block text-sm leading-snug text-zinc-400">{desc}</span>
              </span>
            </Link>
          </motion.li>
        ))}
      </ul>
    </main>
  )
}
