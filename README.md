# Lumen

**Sound you can see.** Home safety alerts for deaf and hard-of-hearing people.

Your phone already knows when a smoke alarm goes off *next to it*. It has no idea the alarm two rooms away is
going off while you're asleep. Lumen turns spare phones into listening and watching nodes around the
house. When the kitchen hears an alarm, the bedroom phone strobes. When someone calls your name, the
headset glows toward where they are. When someone falls, the caregiver knows.

## What's in here

| Path | What it is |
|---|---|
| `server/` | The brain. FastAPI + WebSockets. Receives audio/pose from nodes, runs detectors, routes alerts by mode |
| `server/app/detectors/alarm_dsp.py` | Smoke alarm detector with no AI: 3 kHz beep pattern. The one we trust on stage |
| `server/app/modes.py` | Watch, Wearer and Night modes, as config |
| `web/` | One React app (Vite, Tailwind, Framer Motion) with a page per device |
| `web/src/pages/Dashboard.jsx` | Caregiver floor plan, timeline, mode switch, fake-alert buttons |
| `web/src/pages/Headset.jsx` | Phone-in-headset passthrough view with directional glow |
| `web/src/pages/Node.jsx` | Spare phone in a room, streams mic audio |
| `web/src/pages/Strobe.jsx` | Bedside phone: red flash, vibration, flashlight strobe |
| `docs/agent-line.md` | How the team splits work and uses AI agents cheaply |
| `setup.sh`, `run.sh` | Set up and start on the AMD cloud box or a laptop |

## Run it on your laptop

You need Python 3.10+ and Node 18+.

```bash
cd server && pip install -r requirements.txt && cd ..
cd web && npm install && cd ..
bash run.sh
```

Open http://localhost:5173, then the dashboard, and click a fake alert. Open `/strobe` in a second tab and
arm it to see Night mode fire.

Phones need HTTPS for the camera and mic. `run.sh` starts a Cloudflare tunnel if `cloudflared` is installed
and prints an `https://….trycloudflare.com` link: open that on every phone.

## Run it on the AMD Radeon Cloud box

Create the machine with the **PyTorch ROCm 10** image. You're root; never use sudo.

```bash
git clone https://github.com/iKnow24/Aura_KnightHacks && cd Aura_KnightHacks
bash setup.sh
bash run.sh
```

Each credit is one hour. **Delete the machine whenever nobody is using it**; setup takes minutes to redo.

## Tests

```bash
cd server && python -m pytest -q    # alarm detector + alert routing
cd web && npm run build
```

## How it works

```
phones (mic, pose) ──► brain: detectors ──► fusion by zone ──► mode policy ──► headset glow
                                                                              ├► caregiver dashboard
                                                                              └► bedside strobe
```

Full technical reasoning is in the team's analysis doc. The short version: modes are one config switch on
one pipeline; the smoke alarm path is deterministic (no LLM in the loop); no video leaves a phone.

## Team

Built at KnightHacks IX (UCF, October 2026). MIT licensed.
