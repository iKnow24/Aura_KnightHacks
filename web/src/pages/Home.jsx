import { Link } from 'react-router-dom'

const PAGES = [
  ['/captions', 'Live captions', 'The wearer\'s phone. Words as they\'re spoken, Home / Lecture / Outside modes, alerts that grow until you tap them.'],
  ['/dashboard', 'Caregiver dashboard', 'Laptop or tablet. Floor plan, live alerts, Ask Lumen, mode switch. Needs sign in.'],
  ['/headset', 'Headset HUD', 'Phone in the AR headset. Camera passthrough with edge glow toward the alert.'],
  ['/node?zone=kitchen', 'Camera/mic node', 'Any spare phone. Change ?zone= to the room it sits in. Listens, tracks falls, remembers where things are.'],
  ['/rear', 'Rear guard', 'Outside mode. A phone on the back of your bag that warns you when someone or something comes up behind you.'],
  ['/strobe', 'Bedside strobe', 'Android phone by the bed. Flashes and vibrates on critical alerts (Night mode).'],
]

export default function Home() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-3xl font-bold">Lumen</h1>
      <p className="mt-1 text-zinc-400">Sound you can see. Open one page per device.</p>
      <Link to="/" className="mt-2 inline-block text-sm text-amber-400">← Caregiver sign in</Link>
      <ul className="mt-6 space-y-3">
        {PAGES.map(([to, title, desc]) => (
          <li key={to}>
            <Link to={to} className="block rounded-xl border border-zinc-800 p-4 hover:border-zinc-500">
              <div className="font-semibold">{title}</div>
              <div className="text-sm text-zinc-400">{desc}</div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
