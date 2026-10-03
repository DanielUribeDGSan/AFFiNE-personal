#!/usr/bin/env bash
# Build the custom web frontend (AppFlowy-style Shift sections) and deploy
# it over /app/static on the Oracle AFFiNE VM.
#
# IMPORTANT: only deploy a frontend that matches the server image major/minor
# (e.g. both 0.27.4). A canary frontend on stable backend breaks GraphQL
# (Failed to load quota) and workspace sync.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST="${AFFINE_HOST:-159.54.149.50}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
SSH=(ssh -o BatchMode=yes -i "$SSH_KEY" "ubuntu@${HOST}")
RSYNC_SSH="ssh -o BatchMode=yes -i ${SSH_KEY}"

cd "$ROOT"

echo "==> Building @affine/web with local publicPath"
PUBLIC_PATH=/ BUILD_TYPE=stable yarn affine build -p @affine/web

echo "==> Uploading dist to ${HOST}"
rsync -az --delete -e "$RSYNC_SSH" \
  "$ROOT/packages/frontend/apps/web/dist/" \
  "ubuntu@${HOST}:/tmp/affine-web-dist/"

"${SSH[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
sudo mkdir -p /opt/affine/web-static
sudo rsync -a --delete --exclude mobile --exclude admin \
  /tmp/affine-web-dist/ /opt/affine/web-static/
sudo rsync -a /tmp/affine-web-dist/assets/ /opt/affine/web-static/assets/
sudo rsync -a /tmp/affine-web-dist/js/ /opt/affine/web-static/js/
sudo cp /tmp/affine-web-dist/selfhost.html /opt/affine/web-static/selfhost.html

if [[ ! -f /opt/affine/web-static/mobile/assets-manifest.json ]]; then
  cid=$(sudo docker create ghcr.io/toeverything/affine:stable)
  sudo docker cp "$cid:/app/static/mobile" /opt/affine/web-static/mobile
  sudo docker cp "$cid:/app/static/admin" /opt/affine/web-static/admin
  sudo docker rm "$cid" >/dev/null
fi

cd /opt/affine
# ensure compose mounts custom static
if ! grep -q './web-static:/app/static:ro' docker-compose.yml; then
  sudo python3 - <<'PY'
from pathlib import Path
p = Path('/opt/affine/docker-compose.yml')
text = p.read_text()
needle = "    volumes:\n      - ./data/storage:/root/.affine/storage\n      - ./config:/root/.affine/config\n"
repl = needle + "      - ./web-static:/app/static:ro\n"
if needle in text:
    p.write_text(text.replace(needle, repl, 1))
PY
fi

sudo docker compose up -d affine
sleep 3
curl -fsS -o /dev/null -w 'local %{http_code}\n' http://127.0.0.1:3010/
REMOTE

echo "==> Done. Open https://affine-uribe.duckdns.org"
echo "    New workspaces get AppFlowy sections: General / Tasks / Sprints / Projects / Shared"
