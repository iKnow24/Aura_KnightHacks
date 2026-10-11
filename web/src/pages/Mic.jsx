import { useEffect, useRef, useState } from 'react'
import { keepAwake } from '../lib/useBrain'
import { streamMic } from '../lib/mic'

// One phone per person in the conversation (/mic?name=Dana). Put it in front of them.
// Every phone hears everyone; the brain labels each sentence with the phone that heard it
// loudest, so captions say who's talking without any voice-recognition model.
export default function Mic() {
  const params = new URLSearchParams(location.search)
  const [name, setName] = useState(params.get('name') || '')
  const [on, setOn] = useState(false)
  const [level, setLevel] = useState(0)
  const stop = useRef(null)
  useEffect(() => () => stop.current?.(), [])

  const start = async () => {
    if (!name.trim()) return
    await keepAwake()
    stop.current = await streamMic(name.trim(), setLevel)
    setOn(true)
  }

  if (!on) {
    return (
      <main className="grid h-full place-items-center p-6">
        <div className="w-full max-w-xs text-center">
          <h1 className="text-2xl font-semibold">1 Mic</h1>
          <p className="mt-2 text-sm text-zinc-400">Put this phone in front of one person. Their name labels what they say.</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Their name"
            className="mt-6 w-full rounded-lg bg-zinc-900 px-3 py-3 text-center text-lg outline-none ring-amber-400 focus:ring-2" />
          <button onClick={start} disabled={!name.trim()} className="mt-4 w-full rounded-full bg-amber-400 py-3 font-semibold text-black disabled:opacity-40">
            Start mic
          </button>
        </div>
      </main>
    )
  }
  return (
    <main className="grid h-full place-items-center text-center">
      <div>
        <div className="mx-auto h-40 w-40 rounded-full bg-amber-400/20 transition-transform duration-100"
          style={{ transform: `scale(${1 + Math.min(level * 12, 0.8)})` }} />
        <div className="mt-8 text-3xl font-semibold">{name}</div>
        <div className="mt-1 text-sm text-zinc-500">mic live · keep the screen on</div>
      </div>
    </main>
  )
}
