# Spatial captions (`/captions`)

Each line floats just above the head of the person who said it and follows them. When Lumen can't tell who
said a line, it goes to a **neutral spot** at the bottom center instead of onto a guessed face. The old
transcript side panel is gone; the full transcript is still saved (download button on `/captions`, the
Conversation panel on `/dashboard`). The Movie look (clapperboard button, or say "movie mode") still shows
classic subtitles; "spatial mode" switches back.

Everything here runs on the wearer's phone. No video or face data leaves it, and tracking ids only mean
"the same face as a moment ago": no face recognition, no identity.

## How it works

```
camera ─► MediaPipe Face Landmarker (≤4 faces, ~15 fps)  ─► faceTracker.js: stable ids + mouth movement over time
                                                                         │
mic ────► speech detected (interim words or mic level) ─► start time ────┤  same phone clock
          finished line (browser captions or Whisper)  ─► end time ──────┤
                                                                         ▼
                                speakerMatch.js: whose mouth moved most during [start, end]?
                                clear winner ─► caption over that head (SpatialCaptions.jsx)
                                no clear winner ─► neutral spot
```

| File | Job |
| --- | --- |
| `web/src/lib/faces.js` | MediaPipe face detection: head position, chin, jaw-open, facing the camera |
| `web/src/lib/faceTracker.js` | Stable ids: closest-pairs matching in face-heights with motion prediction; a new face shows after 3 frames; a face stays 1.5 s after it's lost; timed mouth-movement history |
| `web/src/lib/speakerMatch.js` | Matches a stretch of speech to a face. Needs mouth movement above `MIN_TALK` and `MARGIN` (1.6×) more than the next face, otherwise returns nobody |
| `web/src/lib/SpatialCaptions.jsx` | Draws captions above heads (under the chin if the head is at the top edge, never on the face), eased every animation frame without React re-renders; pushes overlapping captions apart; neutral spot and [SOUND CUES] |
| `web/src/pages/Captions.jsx` | Wires camera, captions engines and the above together |

Speech-to-text is unchanged: **Instant** (the browser's own recognizer, words while they're said) or
**Private** (Whisper on the brain or Groq large-v3, partial words about once a second). faster-whisper was
considered: its engine (CTranslate2) has no AMD ROCm support, so on the AMD box it would run on the CPU and be
slower than the current GPU Whisper. Groq large-v3 is already the fast, accurate option when a key is set.

## What works, and what's still experimental

Tested by unit tests (`web/tests/spatialCaptions.test.mjs`, synthetic faces): a one-frame false face never gets a
caption; ids stay put while one person walks past another; a face that looks away briefly keeps its id; speech
goes to the face whose mouth moved during it; overlapping speech, a voice from off camera, or no faces all give
"nobody" (neutral spot). Checked in a browser: captions in the neutral spot, above the control bar.

**Not yet tested on real phones with real people.** Expect to tune `MIN_TALK`, `MARGIN` and the caption gap after
trying it. In particular:

- Caption placement over real heads, at different screen sizes and orientations.
- Speaker matching with real mouths: chewing, smiling and nodding also move the jaw.
- The Private engine: the finished line arrives about a second after speech ends, so its timing window is wider.
- Low light: MediaPipe loses faces sooner, so more lines fall back to the neutral spot (by design, not a bug).

## Test checklist (do on real hardware, note the result)

| Scenario | Expected |
| --- | --- |
| One person speaking, facing the camera | Caption above their head within ~1 s of them finishing |
| Two people taking turns | Each line over the right person |
| Several people, one speaking | Only the speaker gets a caption |
| Person walks across the frame | Caption follows smoothly, same color/name |
| Camera pans | Captions stay on heads |
| Person leaves the frame | Their caption fades; next line goes to the neutral spot |
| Background talk / TV | Neutral spot (no mouth moving in view) |
| Overlapping speech | Neutral spot |
| Nobody visible | Neutral spot |
| Low light | Faces may drop out → neutral spot |

To measure: note the time between the speaker finishing and the caption appearing (Instant vs Private), count
id changes on a person walking across (should be 0), and count wrong-person captions out of 20 turns.

## Next steps for better speaker matching

- **Diarization (whose voice):** not real time on our hardware yet. The plan is a small voice-embedding model on
  the brain (e.g. pyannote or SpeechBrain ECAPA) that tags each Whisper line "voice A/B"; `speakerMatch.js` then
  links a voice to a face once and keeps the link when the mouth is hidden. This would be an added input to
  `pickSpeaker`, not a new code path.
- **Direction of arrival:** one mono phone mic cannot tell where a voice comes from, so nothing claims to.
  A stereo mic, a mic array (e.g. ReSpeaker 4-mic, GCC-PHAT time differences), a second synced phone, or an AR
  headset's mic array could give a bearing per line; matching it to each face's position on screen is a second
  added input to `pickSpeaker`.
- **Better mouth signal:** use lip landmarks over time (mouth-open rate at speech syllable rhythm, ~4-6 Hz)
  instead of the jaw spread alone.
