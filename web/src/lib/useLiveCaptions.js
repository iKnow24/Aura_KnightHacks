import { useCallback, useEffect, useRef, useState } from 'react'
import { streamMic } from './mic'

// Two caption engines:
// - 'instant': the browser's own speech recognition. Words show up while they're being said,
//   free, zero setup. Catch: Chrome sends the audio to Google to do it, so it isn't private.
// - 'private': the mic streams to our own brain (Whisper on the AMD GPU). Nothing leaves our
//   server, and the same audio feeds the sound detectors. Catch: a line appears about a second
//   after the speaker pauses, not word by word.
// Android can't give the mic to both at once, so Outside mode (which needs the sound detectors)
// always uses 'private'.
const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null
export const instantSupported = !!SR

// The transcript is saved in this browser so a reload doesn't lose the conversation.
const KEY = 'lumen_transcript'
const loadSaved = () => { try { return JSON.parse(localStorage.getItem(KEY)) || [] } catch { return [] } }

export function useLiveCaptions({ engine, active, onFinal }) {
  const [lines, setLines] = useState(loadSaved)
  const [interim, setInterim] = useState('')
  const [listening, setListening] = useState(false)
  const [error, setError] = useState(null)
  const [level, setLevel] = useState(0)
  const finalRef = useRef(onFinal)
  finalRef.current = onFinal

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(lines.slice(-1000))) } catch { /* full or private */ } }, [lines])

  // onFinal can return true to say "that was a voice command": it then stays out of the transcript.
  const addLine = useCallback((text, extra = {}) => {
    const line = { id: `${Date.now()}-${Math.random()}`, text: text.trim(), ts: Date.now() / 1000, ...extra }
    if (!line.text) return
    if (finalRef.current?.(line)) return
    setLines((l) => [...l.filter((x) => x.id !== extra.replaces), line].slice(-1000))
    if (extra.local) fetch('/api/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: line.text }) }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!active) return
    setError(null)
    if (engine === 'instant') {
      if (!SR) { setError('This browser has no built-in captions. Switch to Private.'); return }
      let wanted = true
      const rec = new SR()
      rec.continuous = true
      rec.interimResults = true
      rec.lang = 'en-US'
      rec.onstart = () => setListening(true)
      rec.onresult = (e) => {
        let live = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          if (r.isFinal) addLine(r[0].transcript, { local: true })
          else live += r[0].transcript
        }
        setInterim(live)
      }
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          wanted = false
          setError('Microphone blocked. Allow it in the browser, or switch to Private.')
        }
      }
      // Chrome stops listening on its own after a pause; quietly start again.
      rec.onend = () => { setListening(false); setInterim(''); if (wanted) setTimeout(() => { try { rec.start() } catch { /* already started */ } }, 200) }
      try { rec.start() } catch { /* already started */ }
      return () => { wanted = false; rec.abort() }
    }
    let stop
    streamMic('wearer', setLevel).then((s) => { stop = s; setListening(true) })
      .catch(() => setError('Microphone blocked. Allow it in the browser settings.'))
    return () => { stop?.(); setListening(false) }
  }, [engine, active, addLine])

  // Captions the brain sends back (Whisper): our own mic in private mode, speaker mics, room nodes.
  // `replaces`: a louder phone heard the same sentence, so it takes over the label.
  const addRemote = useCallback((msg) => {
    if (msg.zone === 'wearer' && engine !== 'private') return
    addLine(msg.text, { id: msg.id ?? `${msg.ts}-${msg.zone}`, zone: msg.zone === 'wearer' ? null : msg.zone, ts: msg.ts, replaces: msg.replaces })
  }, [engine, addLine])

  return { lines, interim, listening, error, level, addRemote, clear: () => setLines([]), addLine }
}
