<p align="center">
  <img src="docs/images/cover.png" alt="Lumen: Sound you can see." width="100%">
</p>

<p align="center">
  <b>Home safety and live captions for deaf and hard-of-hearing people, built from the phones you already own.</b><br>
  KnightHacks IX · UCF · October 2026
</p>

---

## The problem

Your phone can hear a smoke alarm going off next to it. It has no idea about the one two rooms away while
you're asleep, the doorbell, the kettle, or someone calling your name from the kitchen. Dedicated alert
systems for deaf people cost hundreds of dollars and only cover a few sounds.

## What Lumen does

Lumen turns spare phones into listening nodes around the house, and puts everything they hear on the phone in
your hand.

- **Night mode.** The kitchen phone hears the smoke alarm. The phone on your nightstand strobes red, vibrates
  and flashes its flashlight. No LLM in that path: the alarm detector is plain signal processing, so it can't
  hallucinate.
- **Live captions.** Hold your phone up like a window. Words appear as they're spoken, labeled with whose lips
  were moving, and tagged **TO YOU** when someone is talking to you.
- **Your name.** Lumen alerts you when someone in another room calls your name.
- **Alerts that won't be missed.** Doorbell, timer, glass breaking, a possible fall. Alerts grow on screen
  until you tap them.
- **Ask Lumen.** A memory of what the house heard: "Where are my keys?", "What happened while I was asleep?"
- **Outside mode.** A second phone in your back pocket or bag watches behind you, and a 3D walking view shows
  cars and people coming up on either side.
- **Caregiver dashboard.** A floor plan that lights up the room an alert came from, with a timeline.

<p align="center">
  <img src="docs/images/dashboard-alert.png" alt="Caregiver dashboard with a smoke alarm lighting up the kitchen" width="100%">
</p>

<p align="center">
  <img src="docs/images/signin.png" alt="Sign in" width="32%">
  &nbsp;
  <img src="docs/images/captions.png" alt="Live captions" width="32%">
</p>

## How it works

Every device is just a web page. Open `/node` on a spare phone, `/captions` on yours, `/strobe` on the one by
your bed, and `/dashboard` on a laptop. They all talk to one server (the "brain") over WebSockets.

```mermaid
flowchart LR
  subgraph Phones["Phones (browser only)"]
    N["Room nodes<br/>mic + body pose"]
    C["Your phone<br/>captions + face/lip tracking"]
    R["Back phone<br/>what's behind you"]
  end
  subgraph Brain["Brain · FastAPI on AMD GPU"]
    D1["Smoke alarm<br/>3 kHz beep pattern"]
    D2["Sound AI<br/>AST"]
    D3["Speech<br/>Whisper"]
    D4["Fall<br/>pose rules"]
    F["Fusion by room<br/>+ mode policy"]
    M["Memory<br/>Ask Lumen"]
  end
  N --> D1 & D2 & D3 & D4
  C --> D3
  D1 & D2 & D3 & D4 --> F
  D3 --> M
  R --> F
  F --> S["Bedside strobe"]
  F --> C
  F --> DB["Caregiver dashboard"]
```

**No video stream.** Face, pose and object detection run on the phone with MediaPipe. Room phones send audio,
33 body keypoints, and one small still every few seconds so Ask Lumen can remember where your keys are
(turn that off with `?items=0`).

**Modes are config, not code.** Home, Night, Lecture, Outside and Watch are entries in
[`server/app/modes.py`](server/app/modes.py) that decide which detectors run and where each alert goes. You
can also make a new mode by voice.

## Built with

| Layer | What |
|---|---|
| Compute | **AMD Radeon Cloud** GPU (PyTorch on ROCm) runs the brain and the models |
| Models | **Hugging Face** `MIT/ast-finetuned-audioset` (sounds), `openai/whisper` (speech), `google/owlv2` (where things are) |
| On the phone | MediaPipe Tasks: face landmarks (lip movement), pose, EfficientDet object detection |
| Server | Python, FastAPI, WebSockets |
| Web | React, Vite, Tailwind, Framer Motion, three.js (react-three-fiber) |
| Ask Lumen | Groq by default, swappable to Claude or xAI with one env var |
| Phones over HTTPS | Cloudflare Tunnel |

## Honest status

What works today and what we haven't proven yet. We'd rather you hear it from us.

| Piece | Status |
|---|---|
| Smoke alarm detector, fall rules, mode routing, memory | 44 automated tests passing |
| Dashboard, captions, strobe, alerts, Ask Lumen | Working in the browser; demo alert buttons for judging |
| AST sound AI, Whisper, OWLv2 on the AMD GPU | Written against the real models, not yet run end to end on the AMD box |
| 3D walking view, back-phone detection | Built, not yet tested on a real phone |
| Distance to cars and people | A rough estimate from box size, about ±30% |

## Run it

You need Python 3.10+ and Node 18+.

```bash
cd server && pip install -r requirements.txt && cd ..
cd web && npm install && cd ..
bash run.sh
```

Open http://localhost:5173, sign in with your first name, and press a demo alert on the dashboard. Open
`/strobe` in a second tab and tap to arm it to see Night mode fire.

Phones need HTTPS for the camera and mic. `run.sh` starts a Cloudflare tunnel if `cloudflared` is installed
and prints an `https://….trycloudflare.com` link to open on every phone.

### On the AMD Radeon Cloud box

Create the machine with the **PyTorch ROCm** image (you're root, no sudo):

```bash
git clone https://github.com/iKnow24/Aura_KnightHacks && cd Aura_KnightHacks
bash setup.sh
bash run.sh
```

Ask Lumen and the lecture recap pick their AI with `LUMEN_LLM=groq|claude|xai|off` and the matching key
(`GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`). With no key they fall back to plain rules.

### Tests

```bash
cd server && python -m pytest -q
cd web && npm run build
```

## Repo map

| Path | What it is |
|---|---|
| `server/app/detectors/` | Smoke alarm (DSP), fall, AST sounds, Whisper speech, OWLv2 item sightings |
| `server/app/modes.py` | The modes, as config |
| `server/app/agent.py`, `memory.py` | Ask Lumen |
| `web/src/pages/` | One page per device: Dashboard, Captions, Node, Strobe, Rear, Mic, Headset |
| `docs/demo.md` | The demo script and answers to judge questions |

## Team

Built in one weekend at KnightHacks IX by Sharan ([@iKnow24](https://github.com/iKnow24)) and team.
MIT licensed.
