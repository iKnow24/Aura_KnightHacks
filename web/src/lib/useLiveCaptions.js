import { useCallback, useEffect, useRef, useState } from 'react'
import { voiceForLine } from './captionText'
import { streamMic } from './mic'

// Two caption engines:
// - 'instant': the browser's own speech recognition. Words show up while they're being said,
//   free, zero setup. Catch: Chrome sends the audio to Google to do it, so it isn't private.
// - 'private': the mic streams to our own brain (Whisper on the AMD GPU). Nothing leaves our
//   server, and the same audio feeds the sound detectors. Catch: words arrive in rough chunks about
//   once a second, and the clean line a moment after the speaker pauses.
// Android can't give the mic to both at once, so Outside mode (which needs the sound detectors)
// always uses 'private'.
const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null
export const instantSupported = !!SR

// The transcript is saved in this browser so a reload doesn't lose the conversation.
const KEY = 'lumen_transcript'
const loadSaved = () => { try { return JSON.parse(localStorage.getItem(KEY)) || [] } catch { return [] } }

export function useLiveCaptions({ engine, active, onFinal, externalMic = false }) {
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
    if (finalRef.current?.(line)) return // onFinal may also attach line.speaker (from the camera)
    setLines((l) => [...l.filter((x) => x.id !== extra.replaces), line].slice(-1000))
    const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {})
    const who = { speaker: line.speaker?.id ?? null, to_you: !!line.speaker?.toYou }
    if (extra.local) {
      const voice = voiceForLine(line.text)
      if (voice) { line.voice = voice; line.voiceKnown = true }
      post('/api/speech', { text: line.text, ...who })
    }
    else if (line.speaker && !line.zone) post('/api/speech/tag', { ts: line.ts, ...who })
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
      let partialAt = 0
      rec.onresult = (e) => {
        let live = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          if (r.isFinal) addLine(r[0].transcript, { local: true })
          else live += r[0].transcript
        }
        setInterim(live)
        const now = Date.now()
        if (live.trim() && now - partialAt > 350) {
          partialAt = now
          fetch('/api/speech/partial', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: live }) }).catch(() => {})
        }
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
    // The headset page already streams this mic (picture and sound together). A second
    // open would steal the microphone on some phones.
    if (externalMic) { setListening(true); return () => setListening(false) }
    let stop
    streamMic('wearer', setLevel).then((s) => { stop = s; setListening(true) })
      .catch(() => setError('Microphone blocked. Allow it in the browser settings.'))
    return () => { stop?.(); setListening(false) }
  }, [engine, active, addLine, externalMic])

  // Captions the brain sends back (Whisper): our own mic in private mode, speaker mics, room nodes.
  // `replaces`: a louder phone heard the same sentence, so it takes over the label.
  const addRemote = useCallback((msg) => {
    if (msg.zone === 'wearer' && engine !== 'private') return
    setInterim('')
    // voice: who said it by voiceprint ("Sharan", or "Person 4" when we don't know their name).
    addLine(msg.text, { id: msg.id ?? `${msg.ts}-${msg.zone}`, zone: msg.zone === 'wearer' ? null : msg.zone, ts: msg.ts, replaces: msg.replaces,
      ...(msg.voice && { voice: msg.voice, voiceKnown: !!msg.voice_known }) })
  }, [engine, addLine])

  // While someone is still talking the brain sends the words so far about once a second
  // (caption_partial). They show greyed out until the finished line arrives.
  const addPartial = useCallback((msg) => {
    if (msg.zone === 'wearer' && engine !== 'private') return
    setInterim(msg.text)
  }, [engine])

  return { lines, interim, listening, error, level, setLevel, addRemote, addPartial, clear: () => setLines([]), addLine }
}
