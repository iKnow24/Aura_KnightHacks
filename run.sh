#!/usr/bin/env bash
# Starts the brain (port 8000), the web app (port 5173), and a public HTTPS tunnel to the web app.
# Works the same on the AMD box and on a laptop (the laptop is the backup brain).
set -uo pipefail
trap 'kill 0' EXIT
(cd server && python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000) &
(cd web && npx vite --host --port 5173) &
sleep 3
# http2 (TCP 443-style) instead of the default QUIC/UDP, which many cloud and campus networks block.
# If the tunnel can't start, keep the brain and web app running instead of shutting everything down.
if command -v cloudflared >/dev/null && cloudflared --version >/dev/null 2>&1; then
  cloudflared tunnel --protocol http2 --url http://localhost:5173 || echo "Tunnel stopped. The brain and web app are still running."
else
  echo "No working cloudflared: open http://localhost:5173 on this machine only."
fi
wait
