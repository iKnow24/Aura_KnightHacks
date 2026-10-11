import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { ArrowDown, ArrowRight, EyeOff, ScanFace, ShieldCheck } from 'lucide-react'
import { Component, lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import LiveMap from '../components/landing/LiveMap'
import MemoryStack from '../components/landing/MemoryStack'
import Timeline, { ECLIPSE } from '../components/ui/Timeline'
import Logo, { Wordmark } from '../lib/Logo'

// The 3D head is its own chunk (three.js), loaded after the page paints. Without WebGL, or if anything
// in it throws, the hero shows the logo instead. It still shows with reduced motion on, because it is the
// first thing judges see and its motion is slow and small.
const HeroHeadset = lazy(() => import('../components/landing/HeroHeadset'))
const hasWebGL = () => {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false }
}
class Fallback extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

// The front door: what Lumen is, how the data moves, then a hand-off into the live demo (/start).
// Every claim here is something the code does; the one number (398 ms) was measured on the AMD box.
const img = (name) => `${import.meta.env.BASE_URL}landing/${name}`
const ease = [0.2, 0.7, 0.2, 1]
const rise = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-12% 0px' },
  transition: { delay, duration: 0.9, ease },
})
const gradientText = { backgroundImage: ECLIPSE, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }

// Live path along the top of the timeline, memory path along the bottom.
const LIVE = [
  { id: 'phones', step: 'Live · 01', title: 'Phones listen', body: 'Mic audio, body pose and one still every 5 s. No live video leaves a phone.', color: '#FF8A3D' },
  { id: 'tunnel', step: 'Live · 02', title: 'One tunnel in', body: 'A Cloudflare tunnel and a Mac bridge carry it all to the AMD box.', color: '#FF7652' },
  { id: 'brain', step: 'Live · 03', title: 'AMD Radeon brain', body: 'AST hears sounds, Whisper writes captions, WavLM knows voices, OWLv2 reads the room in 398 ms.', color: '#FF6168' },
  { id: 'screens', step: 'Live · 04', title: 'Light, not sound', body: 'WebSockets push each alert to the wearer’s captions, the bedside strobe and the caregiver.', color: '#FF4F7B' },
]
const MEMORY = [
  { id: 'log', step: 'Memory · 01', title: 'Event log', body: 'Every alert, tap, caption and sighting becomes one line of JSON on the box.', color: '#D157A3' },
  { id: 'lake', step: 'Memory · 02', title: 'Databricks', body: 'A sync every 30 s feeds Bronze, Silver and Gold tables.', color: '#AD60CB' },
  { id: 'ask', step: 'Memory · 03', title: 'Ask the history', body: 'Genie and the History tab answer: is she noticing alerts slower than usual?', color: '#8B6CFF' },
]

const RULES = [
  { icon: EyeOff, title: 'No live video leaves a phone.', body: 'Phones send audio, pose points and one still every 5 seconds. The brain keeps a small crop of each item it finds, never the frame.' },
  { icon: ScanFace, title: 'No face recognition.', body: 'Names only come from someone saying “my name is…”. Voices are matched, faces never are.' },
  { icon: ShieldCheck, title: 'No AI decides an alarm.', body: 'Classifiers with fixed thresholds and plain rules fire alerts. The assistant only reads what already happened.' },
]

const FACTS = [
  ['398 ms', 'median OWLv2 pass per photo on AMD Radeon'],
  ['4', 'open models: AST, Whisper, WavLM, OWLv2'],
  ['30 s', 'between syncs from the house to Databricks'],
  ['0', 'full camera frames stored'],
]

export default function Landing() {
  const navigate = useNavigate()
  const still = useReducedMotion()
  const [leaving, setLeaving] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const shot = useRef(null)
  const [show3d] = useState(() => hasWebGL())
  const heroLogo = (
    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.2, ease }}
      className={show3d ? 'grid h-full place-items-center' : ''}>
      <Logo size={88} live />
    </motion.div>
  )
  const { scrollYProgress } = useScroll({ target: shot, offset: ['start end', 'center center'] })
  const shotScale = useTransform(scrollYProgress, [0, 1], still ? [1, 1] : [0.86, 1])
  const shotTilt = useTransform(scrollYProgress, [0, 1], still ? [0, 0] : [14, 0])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Fade the page to black around the logo, then open the demo, which fades itself in.
  const enter = (e) => {
    e?.preventDefault()
    if (leaving) return
    setLeaving(true)
    setTimeout(() => { window.scrollTo(0, 0); navigate('/start') }, still ? 0 : 650)
  }

  return (
    <main className="overflow-x-clip bg-ink text-white selection:bg-white/20">
      <nav className={`fixed inset-x-0 top-0 z-40 flex items-center justify-between px-5 py-4 transition-[background-color,border-color] duration-500 sm:px-10 ${scrolled ? 'border-b border-white/5 bg-ink/70 backdrop-blur-xl' : 'border-b border-transparent'}`}>
        <Wordmark size={13} />
        <a href="#start" onClick={enter} className="rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-black hover:bg-zinc-200">
          Enter the demo
        </a>
      </nav>

      {/* Hero */}
      <section className="relative flex min-h-[100svh] flex-col items-center justify-center px-6 text-center">
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-[42%] h-[60vmin] w-[60vmin] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.12] blur-[90px]" style={{ background: ECLIPSE }} />
        {show3d ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.4, ease }}
            className="relative mt-10 h-[clamp(280px,46svh,540px)] w-screen max-w-[1500px]">
            <Fallback fallback={heroLogo}>
              <Suspense fallback={heroLogo}><HeroHeadset /></Suspense>
            </Fallback>
          </motion.div>
        ) : heroLogo}
        <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 1, ease }}
          className={`${show3d ? 'mt-5 sm:-mt-4' : 'mt-10'} max-w-[14ch] text-[clamp(2.75rem,8vw,6.5rem)] font-semibold leading-[0.95] tracking-[-0.04em]`}>
          Sound you can <span style={gradientText}>see.</span>
        </motion.h1>
        <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45, duration: 1, ease }}
          className="mt-7 max-w-xl text-[clamp(1.05rem,1.6vw,1.3rem)] leading-relaxed text-zinc-400">
          Lumen turns the phones already in a home into ears for someone who is deaf or hard of hearing.
          The smoke alarm, the doorbell, their own name: it all arrives as light.
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6, duration: 1, ease }}
          className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <a href="#start" onClick={enter} className="flex h-12 items-center gap-2 rounded-full bg-white px-7 font-semibold text-black hover:bg-zinc-200">
            Enter the live demo <ArrowRight size={17} />
          </a>
          <a href="#how" className="flex h-12 items-center rounded-full border border-white/15 px-7 font-medium text-zinc-200 hover:border-white/40">
            How it works
          </a>
        </motion.div>
        {!show3d && <motion.a href="#how" aria-label="Scroll down" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4, duration: 1 }}
          className="absolute bottom-8 text-zinc-600 hover:text-zinc-300">
          <ArrowDown size={18} className={still ? '' : 'animate-bounce'} />
        </motion.a>}
      </section>

      {/* Live path: the real demo kit, wired to the brain */}
      <section id="how" className="scroll-mt-16 px-5 pb-[10vh] pt-[12vh] sm:px-10">
        <motion.p {...rise()} className="mx-auto max-w-6xl text-xs font-medium uppercase tracking-[0.4em] text-zinc-500">Path one · Live</motion.p>
        <motion.h3 {...rise(0.05)} className="mx-auto mt-4 max-w-6xl text-[clamp(1.75rem,3.5vw,2.75rem)] font-semibold tracking-[-0.03em]">Four devices. One brain.</motion.h3>
        <div className="mt-10 sm:mt-4"><LiveMap /></div>
      </section>
      <section className="mx-auto max-w-6xl px-6 pt-[8vh] sm:px-10">
        <motion.p {...rise()} className="text-xs font-medium uppercase tracking-[0.4em] text-zinc-500">Both paths, step by step</motion.p>
      </section>
      <Timeline
        title="Live path"
        periodLabel="Memory path"
        top={LIVE}
        bottom={MEMORY}
        media={<img src={img('conversation.jpg')} alt="Live captions on the dashboard, each tagged with who said it" draggable={false} className="h-full w-full object-cover object-top" />}
      />


      {/* Memory path: where the data is kept */}
      <section className="mx-auto max-w-6xl px-6 pt-[14vh] sm:px-10">
        <motion.p {...rise()} className="text-xs font-medium uppercase tracking-[0.4em] text-zinc-500">Path two · Memory</motion.p>
        <motion.h3 {...rise(0.05)} className="mt-4 max-w-[22ch] text-[clamp(1.75rem,3.5vw,2.75rem)] font-semibold tracking-[-0.03em]">Where it's saved, and what it becomes.</motion.h3>
        <div className="mt-14"><MemoryStack /></div>
      </section>
      <section className="px-4 pb-[6vh] pt-[14vh] sm:px-10" style={{ perspective: 1400 }}>
        <motion.div ref={shot} style={{ scale: shotScale, rotateX: shotTilt }} className="relative mx-auto max-w-6xl origin-bottom">
          <div aria-hidden className="absolute -inset-x-10 -bottom-10 top-1/3 rounded-[48px] opacity-[0.14] blur-[80px]" style={{ background: ECLIPSE }} />
          <img src={img('history.jpg')} alt="The History tab: time to notice alerts and missed alerts per day"
            width={1920} height={1333} className="relative h-auto w-full rounded-2xl border border-white/10 shadow-2xl" loading="lazy" />
        </motion.div>
        <motion.p {...rise()} className="mx-auto mt-10 max-w-xl text-center text-zinc-400">
          The History tab, shown on a sample household with a planted decline: a caregiver sees she is noticing alerts slower, before anything goes wrong.
        </motion.p>
      </section>

      {/* Guardrails */}
      <section className="mx-auto max-w-6xl px-6 py-[16vh] sm:px-10">
        <motion.h2 {...rise()} className="max-w-[20ch] text-[clamp(2rem,4.5vw,3.75rem)] font-semibold leading-[1.02] tracking-[-0.035em]">
          A home that listens has to earn it.
        </motion.h2>
        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 md:grid-cols-3">
          {RULES.map(({ icon: Icon, title, body }, i) => (
            <motion.div key={title} {...rise(i * 0.08)} className="bg-ink p-8">
              <Icon size={22} className="text-zinc-300" strokeWidth={1.6} />
              <p className="mt-6 text-xl font-semibold tracking-tight">{title}</p>
              <p className="mt-3 leading-relaxed text-zinc-400">{body}</p>
            </motion.div>
          ))}
        </div>

        <div className="mt-20 grid grid-cols-2 gap-x-6 gap-y-12 md:grid-cols-4">
          {FACTS.map(([n, label], i) => (
            <motion.div key={label} {...rise(i * 0.06)}>
              <p className="tabular text-[clamp(2.5rem,5vw,4rem)] font-semibold leading-none tracking-[-0.04em]">{n}</p>
              <p className="mt-3 max-w-[22ch] text-sm leading-snug text-zinc-500">{label}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Hand-off */}
      <section id="start" className="relative flex min-h-[90svh] flex-col items-center justify-center overflow-hidden px-6 text-center">
        <div aria-hidden className="pointer-events-none absolute bottom-[-30vmin] left-1/2 h-[70vmin] w-[90vmin] -translate-x-1/2 rounded-full opacity-[0.12] blur-[100px]" style={{ background: ECLIPSE }} />
        <motion.div {...rise()}><Logo size={56} /></motion.div>
        <motion.h2 {...rise(0.05)} className="mt-8 text-[clamp(2.5rem,7vw,5.5rem)] font-semibold leading-[0.95] tracking-[-0.04em]">See it live.</motion.h2>
        <motion.p {...rise(0.1)} className="mt-5 max-w-md text-lg text-zinc-400">The phones in this room are listening right now.</motion.p>
        <motion.div {...rise(0.15)} className="mt-10 flex flex-col items-center gap-5">
          <a href="#start" onClick={enter} className="flex h-14 items-center gap-2 rounded-full bg-white px-9 text-lg font-semibold text-black hover:bg-zinc-200">
            Enter the demo <ArrowRight size={19} />
          </a>
          <Link to="/devices" className="text-sm text-zinc-500 underline-offset-4 hover:text-white hover:underline">Setting up a phone instead?</Link>
        </motion.div>
        <p className="absolute bottom-6 text-xs text-zinc-600">
          Built in a weekend at KnightHacks IX ·{' '}
          <a href="https://github.com/iKnow24/Aura_KnightHacks" target="_blank" rel="noreferrer" className="hover:text-zinc-300">Source on GitHub</a>
        </p>
      </section>

      {/* Leaving for the demo: the page dims around the mark. */}
      <AnimatePresence>
        {leaving && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-ink"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.45, ease }}>
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.6, ease }}>
              <Logo size={72} live />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  )
}
