// Scroll-pinned horizontal timeline. Ported to JSX from Hyperiux Vault (https://vault.hyperiux.com)
// and re-skinned for Lumen: two rows instead of dates (top row = live path, bottom row = memory path),
// the Eclipse gradient instead of orange, and the main line draws with a clip so the gradient
// is revealed rather than squashed. The geometry is tuned for exactly 4 top items and 3 bottom ones.
import { motion } from 'framer-motion'
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'

gsap.registerPlugin(ScrollTrigger, SplitText)

export const ECLIPSE = 'linear-gradient(90deg, #FF8A3D, #FF4F7B 50%, #8B6CFF)'

/* Stand-in for @gsap/react's useGSAP: one gsap.context for the component's life, the callback
   re-added when dependencies change, everything reverted on unmount. */
function useGSAP(callback, { dependencies = [], scope } = {}) {
  const ctxRef = useRef(null)
  const cleanupRef = useRef()

  useLayoutEffect(() => {
    ctxRef.current = gsap.context(() => {}, scope?.current ?? undefined)
    return () => {
      cleanupRef.current?.()
      cleanupRef.current = undefined
      ctxRef.current?.revert()
      ctxRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLayoutEffect(() => {
    if (!ctxRef.current) return
    cleanupRef.current?.()
    const ret = ctxRef.current.add(callback)
    cleanupRef.current = typeof ret === 'function' ? ret : undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)
}

function useMedia(query) {
  const subscribe = (cb) => {
    const mq = window.matchMedia(query)
    mq.addEventListener('change', cb)
    return () => mq.removeEventListener('change', cb)
  }
  return useSyncExternalStore(subscribe, () => window.matchMedia?.(query)?.matches ?? false)
}
const usePrefersReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)')

// Items reveal in the order they sit left to right: top 1, bottom 1, top 2, bottom 2, ...
const interleave = (top, bottom) => top.flatMap((t, i) => (bottom[i] ? [t, bottom[i]] : [t]))

// Small step label, then the title and body that lift in line by line.
function Copy({ item, className = '' }) {
  return (
    <div className={className}>
      <p className="mb-[0.6vw] text-[0.85vw] font-medium uppercase tracking-[0.3em] text-zinc-500 max-[600px]:mb-[2vw] max-[600px]:text-[2.8vw]">{item.step}</p>
      <h4 className={`title-${item.id} text-[2.3vw] font-semibold leading-[1.15] tracking-tight max-[600px]:text-[6.4vw]`}>{item.title}</h4>
      <p className={`description-${item.id} mt-[1vw] w-[92%] text-[1.25vw] leading-[1.3] text-zinc-400 max-[600px]:mt-[3vw] max-[600px]:text-[4.2vw]`}>{item.body}</p>
    </div>
  )
}

/**
 * top / bottom: [{ id, step, title, body, color }]. `step` is the small label above the title.
 * media: what fills the panel at the start of the track (a screenshot, usually).
 */
export default function Timeline(props) {
  // On a phone a sideways pinned track is a lot of thumb-scrolling for little text, so phones get a plain vertical list.
  return useMedia('(max-width: 600px)') ? <PhonePipeline {...props} /> : <PinnedTimeline {...props} />
}

function PhonePipeline({ title, periodLabel, top, bottom, media }) {
  const Row = ({ label, items }) => (
    <div className="mt-14">
      <p className="text-xs font-medium uppercase tracking-[0.4em] text-zinc-500">{label}</p>
      <ol className="relative mt-6 space-y-9 border-l border-white/10 pl-7">
        {items.map((item) => (
          <motion.li key={item.id} className="relative"
            initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-15% 0px' }}
            transition={{ duration: 0.7, ease: [0.2, 0.7, 0.2, 1] }}>
            <span className="absolute -left-[33px] top-1.5 size-2.5 rounded-full" style={{ background: item.color, boxShadow: `0 0 12px ${item.color}` }} />
            <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-zinc-500">{item.step}</p>
            <h4 className="mt-1.5 text-2xl font-semibold tracking-tight">{item.title}</h4>
            <p className="mt-2 leading-relaxed text-zinc-400">{item.body}</p>
          </motion.li>
        ))}
      </ol>
    </div>
  )
  return (
    <section id="pipeline" className="px-6 pb-10">
      <div className="overflow-hidden rounded-2xl border border-white/10">{media}</div>
      <Row label={title} items={top} />
      <Row label={periodLabel} items={bottom} />
    </section>
  )
}

function PinnedTimeline({ title, periodLabel, top, bottom, media, duration = 1.4 }) {
  const sectionRef = useRef(null)
  const sliderRef = useRef(null)
  const reduced = usePrefersReducedMotion()
  const d = Math.max(0.2, duration)
  const items = interleave(top, bottom)

  // The track slides sideways as you scroll; the main line draws across it.
  useGSAP(() => {
    const section = sectionRef.current
    if (!section) return
    const isMobile = window.innerWidth < 600

    gsap.timeline({
      scrollTrigger: { trigger: section, start: 'top top', end: isMobile ? '82% 50%' : '92% bottom', scrub: true },
      defaults: { ease: 'none' },
    }).fromTo(sliderRef.current, { xPercent: 0 }, { xPercent: isMobile ? -57 : -65 })

    // Fonts and late images change the page height; re-measure once they settle.
    document.fonts?.ready.then(() => ScrollTrigger.refresh())

    if (reduced) {
      gsap.set('.journey-line', { clipPath: 'inset(0 0% 0 0)' })
      return
    }
    gsap.fromTo('.journey-line', { clipPath: 'inset(0 100% 0 0)' }, {
      clipPath: 'inset(0 0% 0 0)',
      ease: 'none',
      scrollTrigger: { trigger: section, start: isMobile ? 'top 30%' : 'top 25%', end: isMobile ? '80% 50%' : '92% bottom', scrub: true },
    })
  }, { dependencies: [reduced], scope: sectionRef })

  // Each stop grows its stem, pops its dot, then lifts its words up out of a mask.
  useGSAP(() => {
    const section = sectionRef.current
    if (!section) return

    if (reduced) {
      items.forEach(({ id }) => {
        gsap.set(`.jl-${id}`, { scaleY: 1 })
        gsap.set(`.jd-${id}`, { scale: 1 })
      })
      return
    }

    const splits = []
    items.forEach(({ id }) => {
      gsap.set(`.jl-${id}`, { scaleY: 0 })
      gsap.set(`.jd-${id}`, { scale: 0 })
      splits.push(
        [id, new SplitText(`.title-${id}`, { type: 'lines', mask: 'lines' }), new SplitText(`.description-${id}`, { type: 'lines', mask: 'lines' })],
      )
    })

    const positions = window.innerWidth < 600
      ? [[22, 32], [28, 38], [36, 46], [45, 55], [52, 62], [60, 70], [69, 79]]
      : [[6, 26], [16, 36], [26, 46], [35, 55], [45, 65], [55, 75], [65, 85]]

    splits.forEach(([id, titleSplit, bodySplit], i) => {
      const [start, end] = positions[i]
      gsap.timeline({ scrollTrigger: { trigger: section, start: `${start}% 30%`, end: `${end}% 50%`, scrub: true } })
        .to(`.jl-${id}`, { scaleY: 1, duration: d * 0.4 })
        .to(`.jd-${id}`, { scale: 1, duration: d * 0.4 }, '<')
        .fromTo(titleSplit.lines, { yPercent: 110 }, { yPercent: 0, delay: -0.8 * d, duration: d, stagger: 0.02, ease: 'power2.out' })
        .fromTo(bodySplit.lines, { yPercent: 110 }, { yPercent: 0, duration: d, stagger: 0.02, ease: 'power2.out' }, '<')
    })

    const onResize = () => ScrollTrigger.refresh()
    window.addEventListener('resize', onResize)
    return () => {
      splits.forEach(([, a, b]) => { a.revert(); b.revert() })
      window.removeEventListener('resize', onResize)
    }
  }, { dependencies: [d, reduced], scope: sectionRef })


  return (
    <section ref={sectionRef} id="pipeline" className="relative h-[200vw] w-full max-[600px]:h-[400vh]">
      <div className="sticky top-0 flex h-screen w-full items-center overflow-hidden">
        <div ref={sliderRef}
          className="mr-[2vw] flex h-[30vw] w-[240vw] items-center gap-[5vw] px-[5vw] max-[600px]:h-[80vh] max-[600px]:w-[800vw] max-[600px]:px-[7vw]">
          <div className="h-full w-[30vw] shrink-0 overflow-hidden rounded-[1vw] border border-white/10 max-[600px]:h-[65vw] max-[600px]:w-[85vw] max-[600px]:rounded-[5vw]">
            {media}
          </div>

          <div className="relative h-full w-full">
            {/* The spine both rows hang off. */}
            <div className="absolute left-0 top-[49%] flex h-fit w-full items-center">
              <div className="h-[.8vw] w-[.8vw] shrink-0 rounded-full bg-[#FF8A3D] max-[600px]:h-[2vw] max-[600px]:w-[2vw]" />
              <div className="journey-line relative h-[1.5px] w-[98%]" style={{ backgroundImage: ECLIPSE, clipPath: 'inset(0 100% 0 0)' }}>
                {/* Light running along the drawn part of the line: data on the move. */}
                {!reduced && [0, 1, 2].map((k) => (
                  <span key={k} aria-hidden className="absolute top-1/2 h-[6px] w-[7vw] -translate-y-1/2 rounded-full"
                    style={{ background: 'linear-gradient(90deg, transparent, #fff 70%, transparent)', filter: 'blur(1.5px)', animation: `journey-run 5s linear ${k * 1.66}s infinite` }} />
                ))}
              </div>
              <div className="h-[.8vw] w-[.8vw] shrink-0 rounded-full bg-[#8B6CFF] max-[600px]:h-[2vw] max-[600px]:w-[2vw]" />
            </div>

            <div className="flex h-1/2 w-full items-center justify-start gap-[.5vw]">
              <div className="h-full w-[20%] shrink-0 pt-[2vw] max-[600px]:h-fit max-[600px]:pt-[5vw]">
                <h2 className="text-[3vw] font-semibold leading-[0.95] tracking-tight max-[600px]:text-[8.5vw]">{title}</h2>
              </div>
              <div className="flex h-full w-full gap-x-[15vw] max-[600px]:gap-x-[40vw]">
                {top.map((item) => (
                  <div key={item.id} className="relative h-full w-[30vw] shrink-0 px-[3vw] max-[600px]:flex max-[600px]:w-[70vw] max-[600px]:flex-col max-[600px]:px-[7vw]">
                    <div className="absolute bottom-0 left-0 top-0 h-full w-full">
                      <div className={`jd-${item.id} relative aspect-square size-[1vw] -translate-x-1/2 rounded-full max-[600px]:size-[2.5vw]`}
                        style={{ background: item.color, boxShadow: `0 0 1.6vw ${item.color}` }} />
                      <div className={`jl-${item.id} h-[94%] w-px origin-bottom`} style={{ background: `linear-gradient(${item.color}, transparent)` }} />
                    </div>
                    <Copy item={item} className="mt-[-1vw] max-[600px]:mt-[-2vw]" />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex h-1/2 w-full items-center justify-start">
              <div className="h-full w-[34%] shrink-0 pt-[2vw] max-[600px]:w-[30%] max-[600px]:pt-[5vw]">
                <p className="text-[1.65vw] leading-none text-zinc-400 max-[600px]:text-[4.2vw]">{periodLabel}</p>
              </div>
              <div className="ml-[7vw] flex h-full w-full gap-x-[20vw] max-[600px]:ml-[7vw] max-[600px]:gap-x-[40vw]">
                {bottom.map((item) => (
                  <div key={item.id} className="relative h-full w-[25vw] shrink-0 px-[3vw] max-[600px]:w-[70vw] max-[600px]:px-[7vw]">
                    <div className="absolute bottom-[-1%] left-0 h-full w-full">
                      <div className={`jl-${item.id} h-[94%] w-px origin-top max-[600px]:h-full`} style={{ background: `linear-gradient(transparent, ${item.color})` }} />
                      <div className={`jd-${item.id} relative aspect-square size-[1vw] -translate-x-1/2 rounded-full max-[600px]:size-[2.5vw]`}
                        style={{ background: item.color, boxShadow: `0 0 1.6vw ${item.color}` }} />
                    </div>
                    <Copy item={item} className="flex h-full w-full flex-col justify-end pb-[1vw]" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
