#!/usr/bin/env bash
# The checks every change must pass before it lands on main.
# Same commands as CLAUDE.md / AGENTS.md: server tests and the web build.
# Run it locally the same way: bash scripts/check.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -d server ]; then
  echo "== server: pytest"
  python -m pip install -q -r server/requirements.txt pytest httpx
  (cd server && python -m pytest -q)
else
  echo "== no server/ folder yet, skipping tests"
fi

if [ -f web/package.json ]; then
  echo "== web: npm run build"
  (cd web && npm ci --no-audit --no-fund && npm run build)
else
  echo "== no web/ folder yet, skipping build"
fi

echo "== all checks passed"
