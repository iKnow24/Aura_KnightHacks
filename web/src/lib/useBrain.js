import { useEffect, useRef, useState } from 'react'

const wsUrl = (path) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`

// Connects a screen to the brain and keeps reconnecting if Wi-Fi blips.
// role: 'dashboard' | 'hud' | 'strobe'
// onMessage gets everything else (captions, acks) if a screen wants it.
export function useBrain(role, onAlert, onMessage) {
  const [state, setState] = useState({ mode: '?', modes: {}, nodes: {}, events: [] })
  const [connected, setConnected] = useState(false)
  const alertRef = useRef(onAlert)
  alertRef.current = onAlert
  const msgRef = useRef(onMessage)
  msgRef.current = onMessage

  useEffect(() => {
    let ws, retry, ping, closed = false
    const open = (delay = 500) => {
      ws = new WebSocket(wsUrl(`/ws/${role}`))
      ws.onopen = () => {
        setConnected(true)
        ping = setInterval(() => ws.readyState === 1 && ws.send('ping'), 10000)
      }
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.type === 'state') setState(msg)
        if (msg.type === 'alert') {
          setState((s) => ({ ...s, events: [...s.events, msg].slice(-50) }))
          alertRef.current?.(msg)
        } else if (msg.type === 'ack') {
          setState((s) => ({ ...s, events: s.events.map((e) => (e.id === msg.id ? { ...e, acked: { ts: msg.ts, by: msg.by } } : e)) }))
        }
        if (msg.type !== 'alert' && msg.type !== 'state') msgRef.current?.(msg)
      }
      ws.onclose = () => {
        setConnected(false)
        clearInterval(ping)
        if (!closed) retry = setTimeout(() => open(Math.min(delay * 2, 5000)), delay)
      }
    }
    open()
    return () => { closed = true; clearTimeout(retry); clearInterval(ping); ws?.close() }
  }, [role])

  return { state, connected }
}

export const api = (path, body) =>
  fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())

// Keep the phone screen on (iOS 16.4+, Android Chrome). Ignored where unsupported.
export async function keepAwake() {
  try { await navigator.wakeLock?.request('screen') } catch { /* user can tap again */ }
}
