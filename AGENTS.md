# AGENTS.md

Instructions for AI coding agents (Codex, Cursor, Claude, Copilot) working in this repo.
Read this whole file before changing anything. `CLAUDE.md` says the same things in short form.

## What this is

**Lumen**: live captions and home-safety alerts for deaf, hard-of-hearing and older people.
Hackathon project for KnightHacks IX. **Devpost is due Sunday Oct 11 2026, 10:00 AM; commits stop at 11:00 AM.**
That deadline beats everything: a working demo matters more than clean architecture.

How it works: phones around the house (nodes) listen and watch. A Python server (the brain) turns sound
and body pose into alerts. Alerts show up on the user's phone as captions and glowing alerts, on a
caregiver dashboard, and as a strobe flash by the bed at night. The hero demo is **Night mode**: a kitchen
smoke alarm makes the bedroom phone flash.

## Repo map

```
server/                 FastAPI brain (Python), port 8000
  app/main.py           HTTP + WebSocket routes
  app/hub.py            sends alerts/captions to every screen
  app/modes.py          modes (Home, Night, Outside, Lecture...) are CONFIG here, not separate code
  app/detectors/        alarm_dsp (smoke alarm beeps), ast_sound (AI sound classifier), fall (pose rules),
                        speech (Whisper), items (OWLv2 item finder)
  app/agent.py, llm.py  "Ask Lumen" memory agent; LLM provider picked by env var
  app/memory.py         what was said / seen, for Ask Lumen
  app/eventlog.py       optional JSONL event export, one file per hour (feeds databricks/)
  app/history.py        History tab numbers: Databricks Gold, else the real event log, else sample data
  tests/                pytest
web/                    React app (Vite, Tailwind, Framer Motion, three.js), port 5173
  src/pages/            Login, Home (/devices), Dashboard, Captions, Node, Strobe, Rear, Mic
  src/lib/              shared pieces: useBrain (WebSocket), AlertToast, Logo, WalkScene (3D walker), pose, mic
  vite.config.js        proxies /api and /ws to the brain on :8000
databricks/             caregiver history pipeline (Bronze/Silver/Gold SQL, Genie guide, dashboards)
  REAL_DATA.md          real events from a running brain -> Databricks (start here for the live demo)
  sample_data/          generated "maria" household with a planted decline: label it simulated, always
scripts/databricks_sync.py  runs on the Mac: pulls new event lines from the brain, uploads to a UC Volume
scripts/jupyter_bridge.py   runs on the Mac: reaches the brain on the AMD box through Jupyter
docs/agent-line.md      THE ALERT JSON CONTRACT and every message type. Read before touching alerts.
docs/demo.md            demo run sheet
setup.sh                one-time setup on the AMD GPU box
run.sh                  starts brain + web + Cloudflare HTTPS tunnel
```

## Run and test

```bash
# setup (laptop)
cd server && pip install -r requirements.txt     # requirements-ml.txt adds torch models, AMD box only
cd web && npm install

# run everything (brain :8000, web :5173, public HTTPS link if cloudflared is installed)
./run.sh

# checks: BOTH must pass before you say you're done
cd server && python -m pytest -q
cd web && npm run build
```

Phones need HTTPS for the camera and mic, which is why `run.sh` opens a Cloudflare tunnel.
Use the dashboard's fake-alert buttons (`POST /api/fake-alert`) to test screens without real sounds.

Useful env vars: `MODE` (start mode), `LUMEN_NAME` (name to listen for), `LUMEN_LLM` = `groq` | `claude` | `xai` | `off`
with `GROQ_API_KEY` / `ANTHROPIC_API_KEY` / `XAI_API_KEY`, `WHISPER_PROVIDER=groq`, `EVENT_LOG_DIR`,
`LUMEN_HOUSEHOLD`, `LUMEN_SYNC_KEY` (see Databricks below).
Never commit keys. Groq is the free default; keep it that way.

## Databricks (real data path)

The AMD box's proxy blocks databricks.com, so the box never talks to Databricks. Instead:
brain writes `EVENT_LOG_DIR/<YYYY-MM-DD>_<HH>.jsonl` -> `GET /api/eventlog` (only with header
`X-Lumen-Sync-Key` matching `LUMEN_SYNC_KEY`, because the log holds speech and the tunnel is public) ->
`scripts/databricks_sync.py` on the Mac uploads only new lines as new files to `/Volumes/lumen/home/raw_events/`
-> starts the pipeline job (`DATABRICKS_JOB_ID`) -> `databricks/pipeline/lumen_pipeline.sql`.

- Auto Loader reads each file name once. Never re-upload or append to an uploaded file; upload new pieces.
- Test-button alerts (`source: "fake"`) are dropped in Silver and left out of the History tab.
- Real data covers hours, not weeks. Don't claim week-over-week trends from it; the week-over-week check
  (`gold_change_from_normal`) needs 20+ alerts in the week before. Live numbers: `databricks/live_datasets.sql`.
- Real household id is `home` (`LUMEN_HOUSEHOLD`); the generated one is `maria`. Never mix them in one chart.
- Never put Databricks tokens in code, docs or chat. They live in the Mac's shell env only.

## Hard rules

1. **Never push to `main`.** Work on a branch and open a pull request. Draft PRs are stacked; check which
   branch is newest before you start.
2. **Keep tests and build green.** Run both checks above. If you can't run them, say so; don't claim they pass.
3. **The alert JSON in `docs/agent-line.md` is a contract.** Don't add, rename or remove fields unless the human
   explicitly asks. New alert kinds go in that doc and in `server/app/modes.py`.
4. **No LLM decides whether a safety alert fires.** Detectors are deterministic rules or classifier + threshold.
   The Ask Lumen agent only reads memory and the alert timeline; it never fires alerts.
5. **No live video leaves a phone.** Nodes send audio, pose keypoints and one still every 5 s. The brain keeps
   only small item crops, never full frames.
6. **No face recognition of strangers.** No identifying people from their face, no looking people up online.
   Names come only from someone saying "my name is ...".
7. **Accessibility first.** Captions and alerts stay plain, large and high contrast (white on black or black on white).
   No thin fonts, no low-contrast gray text on captions, no fast flashing outside the deliberate strobe.
8. **Design:** clean Tesla-like look. Black, gray and white; the Eclipse logo (ring + orbiting bead) is the only color.
   Calm animations. No Iron Man / HUD styling.
9. **AMD GPU box:** it's a PyTorch ROCm image running as root. Never use `sudo`, never reinstall `torch`.
10. **Modes are config** in `server/app/modes.py`. Don't fork code paths per mode.

## How to work with this team

- The humans are learning as they go. Explain changes in plain words, with no jargon walls.
- Keep changes small and focused. One feature per PR. Don't refactor files you weren't asked to touch.
- Don't edit `README.md` unless asked; it's being polished separately.
- If a model or feature is untested on real hardware, say so plainly instead of implying it works.
- Prefer a fallback that always works on stage (fake alerts, seeded demo memory) over a fragile "real" path.

## Known untested

- AI models (AST sounds, Whisper, OWLv2, CLAP) have not been fully verified on the AMD box.
- The 3D walking view (`WalkScene.jsx`) hasn't been tried on real phones.
- The Databricks pipeline and `scripts/databricks_sync.py` haven't been run on a real Databricks workspace yet
  (unit tests cover the sync logic with a fake Databricks).
- Fall detection on a real person / crash mat is untested.
