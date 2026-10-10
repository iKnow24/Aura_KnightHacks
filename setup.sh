#!/usr/bin/env bash
# One-shot setup for the AMD Radeon Cloud box (PyTorch ROCm 10 image, logged in as root).
# Rules from AMD: use the PyTorch ROCm image, never use sudo. You're already root.
# Credits are 1 hour each: DELETE the machine when you stop working, then rerun this script
# on a fresh one. It should take a few minutes.
#
#   git clone https://github.com/iKnow24/Aura_KnightHacks && cd Aura_KnightHacks && bash setup.sh
set -euo pipefail

echo "== Checking the GPU =="
python3 -c "import torch; print('torch', torch.__version__, '| GPU visible:', torch.cuda.is_available(), '|', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'none')"

echo "== Python packages (keeps the image's ROCm PyTorch, does not reinstall torch) =="
pip install -q -r server/requirements.txt -r server/requirements-ml.txt

echo "== Node for the web app =="
if ! command -v node >/dev/null; then
  curl -fsSL https://nodejs.org/dist/v22.11.0/node-v22.11.0-linux-x64.tar.xz | tar -xJ -C /opt
  export PATH=/opt/node-v22.11.0-linux-x64/bin:$PATH
  echo 'export PATH=/opt/node-v22.11.0-linux-x64/bin:$PATH' >> ~/.bashrc
fi
(cd web && npm install --silent)

echo "== Cloudflare tunnel (gives phones the HTTPS link they need for camera + mic) =="
if ! command -v cloudflared >/dev/null; then
  curl -fsSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x /usr/local/bin/cloudflared
fi

cat <<'MSG'

Done. Start everything with:  bash run.sh
Then open the https://....trycloudflare.com link it prints on every phone.
MSG
