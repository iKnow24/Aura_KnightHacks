# Instructions for AI agents working in this repo

Hackathon project (KnightHacks IX, due Sunday Oct 11 2026, 10:00 AM). Home safety alerts for deaf and
hard-of-hearing people: phones around the house listen and watch, and alerts show up on the wearer's
`/captions` page, on a caregiver dashboard, and as a strobe by the bed at night.

**Read AGENTS.md first**: architecture (AMD box + Mac Jupyter bridge + cloudflared), page map, Databricks
paths, current state. This file is the short version; keep the two in sync.

- The alert JSON in docs/agent-line.md is a contract. Don't change it without being told to.
- Modes are config in server/app/modes.py, not separate code paths.
- No LLM decides whether a safety alert fires. Detectors are deterministic or classifier + threshold.
- Sound direction is `server/app/direction.py`: headset at the center, back cam behind, phone on the chest. SAID and PSELDNets are the reference models. Do not feed the three phone streams into their checkpoints; those weights expect four mics on one puck. Retrain with `python -m app.direction_train`. Direction never fires an alert.
- No live video leaves a phone. Nodes send audio, pose keypoints, and one still photo every 5 s for item
  memory; the brain keeps only a small crop of each item it finds and never stores full frames.
- No face recognition. Names only come from someone saying "my name is ...".
- The Ask Lumen agent (server/app/agent.py) only reads the memory log and the alert timeline. It never fires alerts.
- Hazard notes (server/app/hazard.py) are Gemini advice shown on the dashboard camera, opt-in by a button because the still goes to Google. They never fire an alert and the photo is dropped.
- Never commit tokens or keys (Jupyter, Databricks, API keys).
- The AMD box is the PyTorch ROCm image as root: never use sudo, never reinstall torch.
- Never push to main. Draft PR while working, mark Ready when done; the auto-merge robot merges when CI is green.
  From Sun Oct 11 8:00 AM ET only PRs labeled `hotfix` merge.
- Before saying you're done: `cd server && python -m pytest -q` and `cd web && npm run build` must pass.
- Keep changes small and explain them in plain words; the team is learning as they go.
