# Instructions for AI agents working in this repo

Hackathon project (KnightHacks IX, due Sunday Oct 11 2026, 10:00 AM). Home safety alerts for deaf and
hard-of-hearing people: phones around the house listen and watch, and alerts show up as a glow in a
phone-in-headset HUD, on a caregiver dashboard, and as a strobe by the bed at night.

- Read docs/agent-line.md first. Stay inside the folder your human owns.
- The alert JSON in docs/agent-line.md is a contract. Don't change it without being told to.
- Modes are config in server/app/modes.py, not separate code paths.
- No LLM decides whether a safety alert fires. Detectors are deterministic or classifier + threshold.
- No live video leaves a phone. Send pose keypoints or audio, not video.
- The AMD box is the PyTorch ROCm image as root: never use sudo, never reinstall torch.
- Before saying you're done: `cd server && python -m pytest -q` and `cd web && npm run build` must pass.
- Keep changes small and explain them in plain words; the team is learning as they go.
