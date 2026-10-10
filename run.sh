#!/usr/bin/env bash
# Starts the brain (port 8000), the web app (port 5173), and a public HTTPS tunnel to the web app.
# Works the same on the AMD box and on a laptop (the laptop is the backup brain).
set -euo pipefail
trap 'kill 0' EXIT
(cd server && python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000) &
(cd web && npx vite --host --port 5173) &
sleep 3
if command -v cloudflared >/dev/null; then
  cloudflared tunnel --url http://localhost:5173
else
  echo "No cloudflared: open http://localhost:5173 on this machine only."
  wait
fi
