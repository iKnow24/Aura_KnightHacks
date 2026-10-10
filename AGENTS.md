# AGENTS.md

Instructions for AI coding agents (Codex, Cursor, Claude, Copilot) working in this repo.
Read this whole file before changing anything. `CLAUDE.md` and `.cursor/rules/lumen.mdc` are short versions of it.

## What this is

**Lumen**: live captions and home-safety alerts for deaf and hard-of-hearing people.
Hackathon project for KnightHacks IX. **Devpost is due Sunday Oct 11 2026, 10:00 AM; commits stop at 11:00 AM.**
A working demo matters more than clean architecture.

Phones around the house (nodes) listen and watch. A Python server (the brain) turns sound and body pose into
alerts. Alerts show up on the wearer's phone as captions and glows, on a caregiver dashboard, and as a strobe by
the bed at night. The hero demo is **Night mode**: a kitchen smoke alarm makes the bedroom phone flash.

## How it runs (demo setup)

```
phones --HTTPS--> cloudflared on the Mac --> localhost:5173 on the Mac (scripts/jupyter_bridge.py)
       --Jupyter websocket--> relay in an open notebook kernel on the AMD box --> Lumen brain + web on the box
```

- **AMD box** (AMD Radeon Cloud, PyTorch ROCm image, runs as root): runs the brain (`server/`, :8000), the web app
  (:5173) and every model on the GPU. Its proxy is an allowlist: pip and Hugging Face work; **tunnels (cloudflared,
  ngrok) and databricks.com are blocked**.
- **Mac**: runs `python3 scripts/jupyter_bridge.py JUPYTER_URL TOKEN`, which joins an **already-open** notebook
  kernel (Jupyter refuses to let us start one, so a notebook must be open in JupyterLab) and exposes the box at
  `localhost:5173`. Then `cloudflared tunnel --url http://localhost:5173` gives phones an HTTPS link
  (phones need HTTPS for camera and mic).
- **Backup brain**: the laptop alone, with `./run.sh` (brain + web + cloudflared tunnel in one command).
- `scripts/bench_gpu.py` times the sound model and Whisper on GPU vs CPU (for the AMD pitch).

Devices on stage:

| Device | Page | Job |
| --- | --- | --- |
| Wearer's phone (hand-held or in headset) | `/captions` | captions, alerts, Room view |
| Mac webcam (or a spare phone) | `/node?zone=kitchen` | listen + pose; one still every 5 s |
| Bedroom phone (Android) | `/strobe` | tap to arm, flashes on alerts |
| Laptop | `/dashboard` | caregiver view, mode switch, fake alerts |
| Optional | `/rear`, `/mic` | bag-mounted rear camera (Outside mode), extra mic |
| Projector | `scrcpy` on the Mac | mirrors the Android phone's screen |

## Repo map

```
server/                 FastAPI brain (Python), port 8000
  app/main.py           HTTP + WebSocket routes
  app/hub.py            sends alerts/captions to every screen
  app/modes.py          modes (watch, wearer, lecture, outside, night) are CONFIG here, not separate code
  app/detectors/        alarm_dsp (smoke alarm beeps), ast_sound (sound classifier), fall (pose rules),
                        speech (Whisper), items (OWLv2 item finder)
  app/agent.py, llm.py  "Ask Lumen" memory agent; LLM provider picked by env var
  app/memory.py         what was said / seen, for Ask Lumen
  app/eventlog.py       JSONL event log, one file per hour (feeds databricks/)
  app/history.py        History tab numbers: Databricks Gold, else the real event log, else sample data
  tests/                pytest
web/                    React app (Vite, Tailwind, Framer Motion, three.js), port 5173
  src/main.jsx          routes (see page map)
  src/pages/            Login, Home, Dashboard, Captions, Node, Strobe, Rear, Mic
  src/lib/              useBrain (WebSocket), useLiveCaptions, AlertToast, Logo, WalkScene (3D walker),
                        RoomSplat + HomeScan (Gaussian splat room scan), History, pose, mic
  public/splats/        room scan file + room.json (see README there)
  vite.config.js        proxies /api and /ws to the brain on :8000
databricks/             caregiver history pipeline (Bronze/Silver/Gold SQL, Genie guide, dashboards)
  REAL_DATA.md          real events from a running brain -> Databricks (start here for the live demo)
  sample_data/          generated "maria" household with a planted decline: label it simulated, always
scripts/jupyter_bridge.py   Mac: reaches the brain on the AMD box through Jupyter
scripts/databricks_sync.py  Mac: pulls new event lines from the brain, uploads to a UC Volume
scripts/bench_gpu.py        AMD box: GPU vs CPU model timing
scripts/check.sh, automerge.sh  CI checks and the merge robot
docs/agent-line.md      THE ALERT JSON CONTRACT and every message type. Read before touching alerts.
docs/demo.md            demo run sheet          docs/shipping.md   how PRs get merged
setup.sh / run.sh       one-time box setup / start everything
```

## Page map

- `/` sign-in (the name is used for name calling). `/devices` picks what this phone is.
- `/captions`: **the one wearer page.** Landscape: full camera with captions over it. Portrait: two boxes,
  camera on top, transcript along the bottom (the 3D walking view is not mounted in portrait). Corner Room view
  shows the splat scan behind a tap toggle. `/headset` just redirects here; there is no Headset page any more.
- `/strobe`: bedside flash. `/node?zone=...`: room sensor. `/rear`: Outside-mode rear camera. `/mic`: extra mic.
- `/dashboard` (needs sign-in): the control center. Camera wall (main view in the middle, one camera each side;
  click a side camera or press 1 / 2 to swap it in; sources are room phones' opt-in previews and this laptop's
  webcams), the headset wearer as a 3D figure bottom left (laptop webcam + MediaPipe, `lib/Avatar3D.jsx`,
  `lib/avatarRig.js`; drop a Blender/Mixamo `.glb` at `web/public/models/avatar.glb` to change the figure), floor
  plan / 3D home scan bottom right, Messages (Ask Lumen chat), timeline, History tab, fake-alert buttons
  (`POST /api/fake-alert`).

## Run and test

```bash
cd server && pip install -r requirements.txt     # requirements-ml.txt adds the torch models (AMD box only)
cd web && npm install
./run.sh                                          # brain :8000, web :5173, tunnel if cloudflared exists

# BOTH must pass before you say you're done (or run: bash scripts/check.sh)
cd server && python -m pytest -q
cd web && npm run build
```

Env vars: `MODE`, `LUMEN_NAME`, `LUMEN_LLM` = `groq` (free default, keep it) | `claude` | `xai` | `hf` | `off` with
`GROQ_API_KEY` / `ANTHROPIC_API_KEY` / `XAI_API_KEY` / `HF_TOKEN` (Hugging Face Inference Providers;
`LUMEN_LLM_MODEL` picks any HF chat model id); `WHISPER_PROVIDER=groq`; `EVENT_LOG_DIR`, `LUMEN_HOUSEHOLD`,
`LUMEN_SYNC_KEY`; `DATABRICKS_HOST`, `DATABRICKS_TOKEN`, `DATABRICKS_WAREHOUSE_ID` for the History tab.

## Databricks (real data path)

The AMD box's proxy blocks databricks.com, so the box never talks to Databricks. Instead:
brain writes `EVENT_LOG_DIR/<YYYY-MM-DD>_<HH>.jsonl` -> `GET /api/eventlog` (only with header
`X-Lumen-Sync-Key` matching `LUMEN_SYNC_KEY`, because the log holds speech and the tunnel is public) ->
`scripts/databricks_sync.py` on the Mac uploads only new lines as new files to `/Volumes/lumen/home/raw_events/`
-> starts the pipeline job (`DATABRICKS_JOB_ID`) -> `databricks/pipeline/lumen_pipeline.sql`.
Setup steps: `databricks/REAL_DATA.md`.

- Auto Loader reads each file name once. Never re-upload or append to an uploaded file; upload new pieces.
- Test-button alerts (`source: "fake"`) are dropped in Silver and left out of the History tab.
- Real data covers hours, not weeks. Don't claim week-over-week trends from it; the week-over-week check
  (`gold_change_from_normal`) needs 20+ alerts in the week before. Live numbers: `databricks/live_datasets.sql`.
- Real household id is `home` (`LUMEN_HOUSEHOLD`); the generated one is `maria`. Never mix them in one chart.
- The generated "maria" numbers ("50% slower to notice alerts") are simulated: always label them so.
- Never put Databricks tokens in code, docs or chat. They live in the Mac's shell env only.

## Hard rules

1. **Never push to `main`.** Branch, open a **Draft** PR, mark it **Ready** when done. The auto-merge robot merges
   Ready PRs once CI (pytest + web build) is green; Drafts never merge. Use merge, not squash/rebase.
   See `docs/shipping.md`.
2. **Freeze: from Sun Oct 11, 8:00 AM ET only PRs labeled `hotfix` merge.** Pause everything with repo variable
   `AUTOMERGE_PAUSED=true`.
3. **Keep tests and build green.** If you can't run them, say so; don't claim they pass.
4. **The alert JSON in `docs/agent-line.md` is a contract.** Don't add, rename or remove fields unless a human
   asks. New alert kinds go in that doc and in `server/app/modes.py`.
5. **No LLM decides whether a safety alert fires.** Detectors are deterministic rules or classifier + threshold.
   Ask Lumen only reads memory and the alert timeline; it never fires alerts.
6. **No live video leaves a phone.** Nodes send audio, pose keypoints and one still every 5 s. The brain keeps
   only small item crops, never full frames.
7. **No face recognition.** No identifying people from faces, no looking people up. Names only come from someone
   saying "my name is ...".
8. **Never commit tokens or keys** (Jupyter token, Databricks token, API keys). Env vars only.
9. **AMD box:** never `sudo`, never reinstall `torch`.
10. **Modes are config** in `server/app/modes.py`. Don't fork code paths per mode.
11. **Accessibility + design:** captions and alerts large, plain, high contrast. Clean Tesla-like look, black/gray/
    white, the Eclipse logo is the only color, calm animations, no fast flashing outside the strobe.

## How to work with this team

- The humans are learning as they go. Explain changes in plain words.
- Small, focused changes; one feature per PR. Don't refactor files you weren't asked to touch.
- Don't edit `README.md` unless asked.
- If something is untested on real hardware, say so plainly.
- Prefer a fallback that always works on stage (fake alerts, "Seed demo memory") over a fragile real path.

## Current state and known gaps (Oct 10 evening)

- Working: brain + models on the AMD GPU through the Jupyter bridge; phones reach it via Mac cloudflared.
- Merged tonight: bridge joins a running kernel (#17), faster private captions without repeat loops (#19).
  Real Databricks data (#22) is merged.
- Room scan uses `sample-room.splat`; a real Scaniverse scan of the demo room still needs to be dropped into
  `web/public/splats/`.
- Untested: fall detection on a real person, the 3D walking view on real phones, the Databricks pipeline and
  `databricks_sync.py` on a real workspace (unit tests use a fake Databricks). GPU vs CPU number not recorded yet.
- GitHub Pages demo site needs Settings > Pages > Source: GitHub Actions. README still needs teammate names.
