import { Link } from 'react-router-dom'

const PAGES = [
  ['/dashboard', 'Caregiver dashboard', 'Laptop or tablet. Floor plan, live alerts, mode switch, fake-alert buttons.'],
  ['/headset', 'Headset HUD', 'Phone in the AR headset. Camera passthrough with edge glow toward the alert.'],
  ['/node?zone=kitchen', 'Camera/mic node', 'Any spare phone. Change ?zone= to the room it sits in.'],
  ['/strobe', 'Bedside strobe', 'Android phone by the bed. Flashes and vibrates on critical alerts (Night mode).'],
]

export default function Home() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-3xl font-bold">Sightline</h1>
      <p className="mt-1 text-zinc-400">Sound you can see. Open one page per device.</p>
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
