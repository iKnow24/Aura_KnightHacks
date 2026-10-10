import { motion } from 'framer-motion'
import { ArrowLeft, AudioLines, ChevronRight, BedDouble, LayoutDashboard, Mic, Radar, ScanLine } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Wordmark } from '../lib/Logo'

const PAGES = [
  ['/captions', 'Live captions', 'The wearer\'s phone. Words as they\'re spoken, Home / Lecture / Outside modes, alerts that grow until you tap them.', AudioLines],
  ['/dashboard', 'Caregiver dashboard', 'Laptop or tablet. Floor plan, live alerts, Ask Lumen, mode switch. Needs sign in.', LayoutDashboard],
  ['/node?zone=kitchen', 'Camera/mic node', 'Any spare phone. Change ?zone= to the room it sits in. Listens, tracks falls, remembers where things are.', ScanLine],
  ['/mic', 'Speaker mic', 'One phone in front of each person you talk to. Captions get labeled with their name.', Mic],
  ['/rear', 'Rear guard', 'Outside mode. A phone on the back of your bag that warns you when someone or something comes up behind you.', Radar],
  ['/strobe', 'Bedside strobe', 'Android phone by the bed. Flashes and vibrates on critical alerts (Night mode).', BedDouble],
]

export default function Home() {
  return (
    <main className="mx-auto max-w-xl px-6 pb-16 pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="flex items-center justify-between">
        <Wordmark size={13} />
        <Link to="/" className="flex items-center gap-1.5 text-sm text-zinc-500 transition hover:text-white"><ArrowLeft size={15} /> Sign in</Link>
      </div>
      <h1 className="mt-16 text-3xl font-semibold tracking-tight">What is this phone for?</h1>
      <p className="mt-2 text-zinc-500">Every device is a web page. Open one per phone.</p>
      <ul className="mt-10 divide-y divide-white/[0.07] border-y border-white/[0.07]">
        {PAGES.map(([to, title, desc, Icon], i) => (
          <motion.li key={to} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04, duration: 0.6 }}>
            <Link to={to} className="group flex items-center gap-5 py-5">
              <Icon size={22} strokeWidth={1.6} className="shrink-0 text-zinc-400 transition group-hover:text-white" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{title}</span>
                <span className="mt-0.5 block text-sm leading-snug text-zinc-500">{desc}</span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-white" />
            </Link>
          </motion.li>
        ))}
      </ul>
    </main>
  )
}
