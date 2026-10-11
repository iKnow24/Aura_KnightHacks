import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { useRef } from 'react'

// The memory path as three glass layers that pull apart as you scroll: raw events at the bottom,
// clean tables in the middle, caregiver answers on top. Table names are the real ones in
// databricks/pipeline/lumen_pipeline.sql.
const LAYERS = [
  { name: 'Gold', what: 'Answers', tables: ['gold_change_from_normal', 'gold_alert_response', 'gold_who_talks'], tint: '#8B6CFF' },
  { name: 'Silver', what: 'Clean tables', tables: ['silver_alerts', 'silver_acks', 'silver_speech', 'silver_vision'], tint: '#FF4F7B' },
  { name: 'Bronze', what: 'Raw events, exactly as sent', tables: ['bronze_events'], tint: '#FF8A3D' },
]

const WHERE = [
  ['On the AMD box', 'Each event is one line of JSON in an hourly file under ~/lumen_events. No recordings and no video are saved.'],
  ['Every 30 seconds', 'A small script on the Mac copies the new lines into a Databricks volume, /Volumes/lumen/home/raw_events.'],
  ['In Databricks', 'Auto Loader streams them into Bronze, cleans them into Silver, and rolls them up into Gold.'],
  ['For the caregiver', 'Genie answers plain questions from Gold, and the History tab charts it.'],
]

export default function MemoryStack() {
  const ref = useRef(null)
  const still = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'center center'] })
  const spread = useTransform(scrollYProgress, [0, 1], still ? [1, 1] : [0.15, 1])

  return (
    <div ref={ref} className="grid items-center gap-16 lg:grid-cols-[1.1fr_1fr]">
      <div className="relative mx-auto h-[min(105vw,500px)] w-full max-w-[540px]">
        {/* Bronze is drawn first so Gold sits on top of the stack. */}
        {[...LAYERS].reverse().map((l) => (
          <Layer key={l.name} layer={l} index={LAYERS.indexOf(l)} spread={spread} />
        ))}
      </div>

      <ol className="space-y-8">
        {WHERE.map(([title, body], i) => (
          <motion.li key={title} className="flex gap-5"
            initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-10% 0px' }}
            transition={{ delay: i * 0.08, duration: 0.8, ease: [0.2, 0.7, 0.2, 1] }}>
            <span className="tabular mt-0.5 text-sm text-zinc-600">0{i + 1}</span>
            <span>
              <span className="block text-lg font-semibold tracking-tight">{title}</span>
              <span className="mt-1 block leading-relaxed text-zinc-400">{body}</span>
            </span>
          </motion.li>
        ))}
      </ol>
    </div>
  )
}

function Layer({ layer, index, spread }) {
  // Gold floats highest. The layers start almost stacked and lift apart as the section scrolls in.
  const gap = window.innerWidth < 640 ? 64 : 120 // keep the stack inside its box on a phone
  const y = useTransform(spread, (s) => (index - 1) * gap * s)
  return (
    <motion.div className="absolute inset-0 flex items-center justify-center" style={{ y, perspective: 1400 }}>
      <div className="aspect-square w-[62%] rounded-[28px] border p-6"
        style={{
          transform: 'rotateX(58deg) rotateZ(-38deg)',
          borderColor: `${layer.tint}66`,
          background: `linear-gradient(135deg, ${layer.tint}30, rgb(15 15 17 / 0.92) 55%)`,
          boxShadow: `0 0 70px -12px ${layer.tint}88, inset 0 0 0 1px rgb(255 255 255 / 0.05)`,
        }}>
        <p className="text-[clamp(1.4rem,3vw,2.2rem)] font-semibold tracking-tight">{layer.name}</p>
        <p className="text-sm text-zinc-400">{layer.what}</p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {layer.tables.map((t) => (
            <span key={t} className="rounded-md bg-black/50 px-2 py-1 font-mono text-[10px] text-zinc-300">{t}</span>
          ))}
        </div>
      </div>
    </motion.div>
  )
}
