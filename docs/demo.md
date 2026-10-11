# Demo run sheet

What to test first, what to say on stage, and what judges will ask.

## Device setup

| Device | Open | Job |
| --- | --- | --- |
| AMD box | brain + web (`./run.sh` in the open notebook's terminal) | runs every model on the GPU |
| Mac | `python3 scripts/jupyter_bridge.py JUPYTER_URL TOKEN`, then `cloudflared tunnel --url http://localhost:5173` | bridge to the box + HTTPS link for phones |
| Mac webcam + mic | `/node?zone=living` | the one room sensor (hears the alarm) |
| Wearer's phone, hand-held | `/captions` | portrait = two boxes: camera on top, transcript below |
| Android phone by the "bed" | `/strobe` (tap to arm) | flashes on alerts |
| Laptop or Mac tab | `/dashboard` | caregiver view, mode switch, fake alerts, 3D room |
| Projector | `scrcpy` on the Mac | mirrors the Android phone's screen so the audience sees it |

Keep a notebook open in JupyterLab the whole time: the bridge joins its kernel and can't start a new one.
Never paste the Jupyter token or any key into chat, slides or the repo.

## Saturday: test the scary stuff first (in this order)

Every item here is something code can't fix. Find out early.

1. **Network.** Start the brain on the box, the bridge and cloudflared on the Mac (table above), open the
   cloudflared link on a phone. Does `/dashboard` say "brain connected"? Put the phones on one hotspot if
   venue Wi-Fi is flaky; the Mac needs internet for the bridge.
2. **Smoke alarm → strobe.** Mac webcam (or phone A) on `/node?zone=living`, Android phone B on `/strobe` (tap to arm),
   dashboard in Night mode. Press a real smoke detector's test button next to phone A.
   Phone B should flash within ~3 seconds. **This is the hero demo. If it doesn't work by Saturday
   evening, cut everything else until it does.**
3. **Captions phone.** Hand-held phone on `/captions`, portrait. Camera box on top, transcript along the
   bottom? Click a fake alert on the dashboard: does the glow show? Turn it landscape: full camera with
   captions over it. (`/headset` just opens `/captions` now.)
4. **Fall.** Phone mounted high (about 1.8 m) and angled down on `/node?zone=living`, dashboard in
   Watch mode. Check the preview shows "● person tracked". Fall onto a mat 2 to 3 m away and lie still
   8 seconds. Try 10 times. If fewer than 8 work, show a recorded run on stage instead.
5. **Heat.** Leave one node streaming for an hour on a charger. Does it dim or slow down?
6. **AMD box.** `bash setup.sh`, then `python -m app.detectors.ast_sound` from `server/`.
   Every label should print OK. If any print MISSING, fix the names in `server/app/detectors/ast_sound.py`.
7. **Ask Lumen.** On the AMD box, `python -m app.detectors.items photo.jpg` on a few phone photos of your
   real keys on a table. If keys aren't found, use a bigger, brighter keychain or lower the keys threshold
   in `server/app/detectors/items.py`. Then leave keys in view of the living-room node, sign in on the
   dashboard and ask "Where are my keys?". The answer should show a photo crop. If the models won't
   run, press "Seed demo memory" and say so honestly if asked.

8. **Captions over faces.** `/captions` phone held up, two teammates in front of it taking turns talking, one facing the
   wearer and one turned away. Each sentence should land as a bubble over the right person's head, in their
   color, with "TO YOU" only for the one facing the wearer. If bubbles land on the wrong person, raise
   `TALKING` in `web/src/pages/Captions.jsx`; if captions never show, check Whisper first with
   `POST /api/fake-caption`. Glasses, masks and bad light break lip reading: test in the demo room.

## The 2-minute demo

1. **Problem (15 s).** "Millions of Americans are deaf or hard of hearing. Your phone can hear a smoke alarm next to it. It can't hear the one two rooms away while you're asleep."
2. **Night mode (30 s).** The room sensor (Mac on `/node?zone=living`) hears the real smoke alarm; the bedside
   phone strobes; the dashboard ripples on the living room. "The house heard it, the bed flashed."
3. **Captions (30 s).** Hand a judge the `/captions` phone. A teammate talks to them, then plays a doorbell
   sound next to a node. The words show up in the transcript and the alert glows on top of them. (Name calling works in Wearer mode once Whisper runs: the
   name comes from the sign-in screen.)
4. **Fall (30 s).** Teammate falls on the mat, lies still; caregiver dashboard shows "Possible fall · Bedroom".
5. **Ask Lumen (20 s).** "Lumen also remembers." Ask "What was the last thing said?" (a teammate spoke
   in the kitchen earlier) and "Where are my keys?" (answer comes with the photo crop).
6. **Optional, if there's time: Lecture (20 s).** On `/captions`, tap Lecture, let a teammate talk for
   20 seconds (or tap Sample), then End → Recap: memory map with "when it was said", and a quiz.
7. **Close (15 s).** "No video leaves a phone. The alarm path has no AI guessing in it. And it runs on
   phones people already own."

## Questions judges will ask

- **"Why not just use iPhone Sound Recognition or Android Live Transcribe?"** They listen from one
  phone, in one room. We listen from every room, add falls through vision, tell a caregiver, and show
  which direction the sound came from. Lead with multi-room, not with "it detects sounds."
- **"Nobody wears a headset at home."** True. The headset stands in for the glasses Meta and Google are
  shipping. The same alerts work on a plain phone, the dashboard, and the bedside strobe.
- **"What about false alarms?"** The smoke alarm detector looks for the actual 3 kHz beep pattern, and
  the AI model has to agree on confidence. Falls need a fast drop *and* staying still; lying down
  slowly doesn't count. Leaving the camera's view counts as unknown, not fallen.
- **"Privacy?"** Pose runs on the phone; only 33 body points are sent. The dashboard shows rooms
  and alerts, never camera feeds.
- **"Where's the AI?"** Audio Spectrogram Transformer on the AMD GPU for sound classes, MediaPipe pose on
  each phone, deterministic rules on top. We kept AI out of the yes/no decision for smoke alarms on
  purpose: it's the one path that has to be instant and predictable.

- **"Why not use Live Transcribe for captions?"** For plain captions, you should. Ours exist so alerts
  can land on top of the words you're already reading, and so a lecture ends with a recap and quiz.
  Instant mode uses the browser's recognizer (Google's servers); Private mode runs Whisper on our box.
- **"Can it tell me who I'm talking to?"** Only names people say out loud. We chose not to recognize
  strangers' faces: it's illegal to do without consent in several states, and it's the first thing
  that makes people afraid of the person wearing the device.

## Backup plan

- AMD box or bridge down: `./run.sh` on a laptop (brain + web + its own cloudflared link). The alarm detector and pose still work; only the AI sound model
  needs the GPU (it runs on CPU too, just slower).
- Tunnel down: phone hotspot plus the laptop's local address won't give phones camera access
  (no https). Fall back to the pre-recorded demo video. **Record it Saturday night.**

## Run the site from GitHub, with your real brain

The GitHub Pages site (https://iknow24.github.io/Aura_KnightHacks/) is files only, so by default it runs a
fake brain inside the page and nothing syncs between devices. To make it a real screen on your house, give
it the address of the brain, once, on any page:

    https://iknow24.github.io/Aura_KnightHacks/dashboard?brain=https://YOUR-TUNNEL.trycloudflare.com

The page remembers it in that browser (`?brain=off` forgets it), and the "Add a phone" QR codes carry it
along, so every phone you scan ends up on the same brain. The address has to be **https** (Pages is https,
and browsers block a plain http brain from an https page): use the cloudflared tunnel that points at the
brain on port 8000, not `http://localhost:8000` (that works only when the page itself is on localhost).
Code is `web/src/lib/brain.js`. A free cloudflared tunnel gets a new address every time it restarts.
