// Where the brain is.
//
// Normally the page and the brain are the same address: the Vite server (or the tunnel in front of
// it) forwards /api and /ws to the Python brain on :8000, so every screen just talks to its own
// origin and there is nothing to configure.
//
// GitHub Pages can't do that. It only serves files, so the hosted site has a fake brain inside the
// page (demo/backend.js) and nothing syncs between devices, by design. This file is the way out:
// open any page with ?brain=https://something.trycloudflare.com and every /api call and /ws socket
// goes to that address instead, which turns the hosted site into a real screen on your house.
// The address is remembered in this browser, so a reload or a QR scan keeps it. ?brain=off clears it.
//
// The brain allows any origin (CORSMiddleware in server/app/main.py), and WebSockets aren't
// subject to CORS at all, so nothing else has to change.

const KEY = 'lumen_brain'

const clean = (url) => {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null
  } catch {
    return null
  }
}

const read = () => {
  const asked = new URLSearchParams(location.search).get('brain')
    ?? new URLSearchParams(location.hash.split('?')[1] ?? '').get('brain')
  if (asked === 'off' || asked === '') {
    try { localStorage.removeItem(KEY) } catch { /* private window */ }
    return null
  }
  const given = asked && clean(asked.includes('://') ? asked : `https://${asked}`)
  if (given) {
    try { localStorage.setItem(KEY, given) } catch { /* private window */ }
    return given
  }
  try { return clean(localStorage.getItem(KEY)) } catch { return null }
}

const ORIGIN = typeof window === 'undefined' ? null : read()

// null when this page talks to its own origin (the normal case).
export const brainOrigin = () => ORIGIN

// Carry the setting onto another page on this site, so QR codes handed to phones keep working.
export const withBrain = (url) => (ORIGIN ? `${url}${url.includes('?') ? '&' : '?'}brain=${encodeURIComponent(ORIGIN)}` : url)

// Point /api and /ws at the brain. Called once, before any screen connects.
export function connectBrain() {
  if (!ORIGIN) return null
  const socket = ORIGIN.replace(/^http/, 'ws')
  const realFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const raw = typeof input === 'string' ? input : input?.url
    return typeof raw === 'string' && raw.startsWith('/api')
      ? realFetch(ORIGIN + raw, init)
      : realFetch(input, init)
  }
  // Every screen builds its socket URL from location.host; swap that part for the brain's.
  const RealSocket = window.WebSocket
  function Socket(url, protocols) {
    const at = String(url).replace(/^wss?:\/\/[^/]+(?=\/ws\/)/, socket)
    return protocols === undefined ? new RealSocket(at) : new RealSocket(at, protocols)
  }
  Socket.prototype = RealSocket.prototype
  Object.assign(Socket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
  window.WebSocket = Socket
  return ORIGIN
}
