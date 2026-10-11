import { useEffect, useState } from 'react'
import { recordClip } from '../lib/mic'

// Teach Lumen the team's voices. Type a name, press Record, talk for a few seconds. The brain saves
// the voiceprint on its own disk (never in the repo), so it knows you after restarts. Anyone not saved
// here shows up in captions as Person 4, Person 5, ... and is never saved.
const SECONDS = 6
const LONG_SECONDS = 60
const LINE = 'Read this: "Hi, I\'m on the Lumen team. We help deaf people know who is talking and what is happening around them."'
// About a minute of plain speech with lots of different sounds, for the long recording.
const SCRIPT = `Hi, I'm on the Lumen team. Lumen helps deaf and hard-of-hearing people know what's happening around them.
Phones around the house listen for smoke alarms, doorbells, timers and someone calling your name.
When something happens, the phone you're holding shows it, the caregiver gets a message, and at night a light flashes by the bed.
Captions show who is talking, right above their head, so you can follow a conversation with three or four people.
We built it in one weekend at Knight Hacks, on an AMD graphics card, with open models from Hugging Face.
Nothing leaves the house, and no faces are ever recognized. Thanks for listening, that's about a minute.`

async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.detail || 'The brain is not reachable.')
  return data
}

export default function Voices() {
  const [known, setKnown] = useState(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(null) // 'save' | 'long' | 'test' while recording
  const [left, setLeft] = useState(0)
  const [level, setLevel] = useState(0)
  const [note, setNote] = useState(null)

  const load = () => fetch('/api/voices').then((r) => r.json()).then(setKnown).catch(() => setKnown({ model: 'unreachable', people: [] }))
  useEffect(() => { load() }, [])

  const record = async (kind) => {
    setNote(null)
    setBusy(kind)
    setLeft(kind === 'long' ? LONG_SECONDS : SECONDS)
    const tick = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    try {
      if (kind === 'long') {
        // One minute, sent as 6 s pieces. Each piece makes the saved voice a little more reliable.
        const pieces = await recordClip(LONG_SECONDS, setLevel, SECONDS)
        let used = 0, last = null
        for (const audio of pieces) {
          try { last = await post('/api/voices/enroll', { name, audio }); used++ } catch { /* a silent piece */ }
        }
        if (!used) throw new Error('Couldn\'t hear any talking. Hold the phone closer.')
        setKnown({ ...known, ...last })
        setNote({ ok: true, text: `Saved ${name.trim()} from ${used} pieces of the reading.` })
        return
      }
      const audio = await recordClip(SECONDS, setLevel)
      if (kind === 'save') {
        setKnown({ ...known, ...(await post('/api/voices/enroll', { name, audio })) })
        setNote({ ok: true, text: `Saved ${name.trim()}. Record once more to make it stronger.` })
      } else {
        const r = await post('/api/voices/who', { audio })
        setNote(r.voice ? { ok: true, text: `That's ${r.voice} (match ${Math.round(r.voice_score * 100)}%)` }
          : { ok: false, text: r.closest ? `Not sure. Closest is ${r.closest} at ${Math.round(r.voice_score * 100)}%.` : 'No voices saved yet.' })
      }
    } catch (e) {
      setNote({ ok: false, text: e.message || 'Microphone blocked. Allow it in the browser.' })
    } finally {
      clearInterval(tick)
      setBusy(null)
      setLevel(0)
    }
  }

  const remove = async (who) => setKnown({ ...known, ...(await post('/api/voices/remove', { name: who })) })

  // Backup file: the team's voiceprints as JSON, to put back if the AMD box is ever rebuilt.
  const backup = async () => {
    const data = await (await fetch('/api/voices/backup')).json()
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })), download: 'lumen-voices.json' })
    a.click()
  }
  const restore = async (file) => {
    if (!file) return
    try {
      setKnown({ ...known, ...(await post('/api/voices/restore', JSON.parse(await file.text()))) })
      setNote({ ok: true, text: 'Voices restored from the backup.' })
    } catch (e) { setNote({ ok: false, text: e.message || 'That file isn\'t a Lumen voices backup.' }) }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Voices</h1>
        <p className="mt-1 text-sm text-zinc-400">Teach Lumen who’s on the team. Captions will show your name. Everyone else shows up as Person 4, Person 5, and is never saved.</p>
      </header>

      <section className="rounded-xl bg-zinc-900 p-4">
        <h2 className="text-sm font-medium text-zinc-400">Saved voices</h2>
        {known === null && <p className="mt-2 text-zinc-500">Loading…</p>}
        {known && known.people.length === 0 && <p className="mt-2 text-zinc-500">None yet.</p>}
        <ul className="mt-2 divide-y divide-zinc-800">
          {known?.people.map((p) => (
            <li key={p.name} className="flex items-center justify-between py-2">
              <span className="text-lg">{p.name}</span>
              <span className="flex items-center gap-3 text-sm text-zinc-500">
                {p.lines} {p.lines === 1 ? 'sample' : 'samples'}
                <button onClick={() => remove(p.name)} className="text-zinc-400 underline">remove</button>
              </span>
            </li>
          ))}
        </ul>
        {known && known.model !== 'ready' && (
          <p className="mt-2 text-sm text-amber-400">Voice model: {known.model}. {known.model === 'loading' ? 'Still starting up, try again in a minute.' : ''}</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
          className="w-full rounded-lg bg-zinc-900 px-3 py-3 text-center text-lg outline-none ring-white/40 focus:ring-2" />
        <p className="text-sm text-zinc-400">{LINE} Stand where you’ll be during the demo and talk normally.</p>
        <button onClick={() => record('save')} disabled={!name.trim() || !!busy}
          className="w-full rounded-full bg-white py-3 font-semibold text-black disabled:opacity-40">
          {busy === 'save' ? `Recording… ${left}s` : 'Record and save'}
        </button>
        <details className="rounded-xl bg-zinc-900 p-4">
          <summary className="cursor-pointer text-sm font-medium text-zinc-300">Stronger: read a 1-minute script</summary>
          <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-zinc-300">{SCRIPT}</p>
          <button onClick={() => record('long')} disabled={!name.trim() || !!busy}
            className="mt-4 w-full rounded-full border border-zinc-600 py-3 font-semibold disabled:opacity-40">
            {busy === 'long' ? `Recording… ${left}s` : 'Record 1 minute and save'}
          </button>
        </details>
        <button onClick={() => record('test')} disabled={!!busy || !known?.people.length}
          className="w-full rounded-full border border-zinc-700 py-3 font-semibold disabled:opacity-40">
          {busy === 'test' ? `Listening… ${left}s` : 'Test: who is talking?'}
        </button>
        {busy && <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-white transition-all" style={{ width: `${Math.min(100, level * 800)}%` }} /></div>}
        {note && <p className={note.ok ? 'text-center text-lg' : 'text-center text-lg text-amber-400'}>{note.text}</p>}
      </section>

      <footer className="flex items-center justify-center gap-6 text-sm text-zinc-400">
        <button onClick={backup} disabled={!known?.people.length} className="underline disabled:opacity-40">Download backup</button>
        <label className="cursor-pointer underline">
          Restore backup
          <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => restore(e.target.files[0])} />
        </label>
      </footer>
    </main>
  )
}
