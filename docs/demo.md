# Demo run sheet

What to test first, what to say on stage, and what judges will ask.

## Saturday morning: test the scary stuff first (in this order)

Every item here is something code can't fix. Find out early.

1. **Network.** Put the laptop and every phone on one hotspot or travel router (not venue Wi-Fi).
   Run `bash run.sh`, open the tunnel link on a phone. Does `/dashboard` say "brain connected"?
2. **Smoke alarm → strobe.** Phone A on `/node?zone=kitchen`, Android phone B on `/strobe` (tap to arm),
   dashboard in Night mode. Press a real smoke detector's test button next to phone A.
   Phone B should flash within ~3 seconds. **This is the hero demo. If it doesn't work by Saturday
   evening, cut everything else until it does.**
3. **Headset.** Phone in the headset on `/headset`. Is the camera view clear and not blocked by the
   headset shell? Can you see both halves comfortably? Click a fake alert: does the glow show?
4. **Fall.** Phone mounted high (about 1.8 m) and angled down on `/node?zone=bedroom`, dashboard in
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

## The 2-minute demo

1. **Problem (15 s).** "Millions of Americans are deaf or hard of hearing. Your phone can hear a smoke alarm next to it. It can't hear the one two rooms away while you're asleep."
2. **Night mode (30 s).** Kitchen phone hears the real smoke alarm; bedroom phone strobes; the dashboard
   ripples on the kitchen. "The kitchen heard it, the bedroom flashed."
3. **Headset (30 s).** Judge wears the headset. A teammate plays a doorbell sound next to the hallway node.
   The glow appears on the hallway's side. (Name calling works in Wearer mode once Whisper runs: the
   name comes from the sign-in screen.)
4. **Fall (30 s).** Teammate falls on the mat, lies still; caregiver dashboard shows "Possible fall · Bedroom".
5. **Ask Lumen (20 s).** "Lumen also remembers." Ask "What was the last thing said?" (a teammate spoke
   in the kitchen earlier) and "Where are my keys?" (answer comes with the photo crop).
6. **Close (15 s).** "No video leaves a phone. The alarm path has no AI guessing in it. And it runs on
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

## Backup plan

- AMD box down: `run.sh` on a laptop. The alarm detector and pose still work; only the AI sound model
  needs the GPU (it runs on CPU too, just slower).
- Tunnel down: phone hotspot plus the laptop's local address won't give phones camera access
  (no https). Fall back to the pre-recorded demo video. **Record it Saturday night.**
