#!/usr/bin/env bash
# Deploy AFFiNE self-host bits to the Oracle VM.
#
# Modes:
#   css    — safe UI CSS overrides only (default)
#   stack  — pull ghcr.io/toeverything/affine:stable + restart compose
#   all    — css + stack
#
# Never deploys a canary web build over stable backend (breaks GraphQL/sync).
set -euo pipefail

MODE="${1:-css}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST="${AFFINE_HOST:-159.54.149.50}"
USER="${AFFINE_SSH_USER:-ubuntu}"
SSH_KEY="${SSH_KEY:-${AFFINE_SSH_KEY:-$HOME/.ssh/id_ed25519}}"

if [[ -n "${AFFINE_SSH_KEY_CONTENT:-}" ]]; then
  KEY_FILE="$(mktemp)"
  printf '%s\n' "$AFFINE_SSH_KEY_CONTENT" >"$KEY_FILE"
  chmod 600 "$KEY_FILE"
  SSH_KEY="$KEY_FILE"
  trap 'rm -f "$KEY_FILE"' EXIT
fi

SSH=(ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$SSH_KEY" "${USER}@${HOST}")
SCP=(scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$SSH_KEY")

deploy_css() {
  echo "==> [css] Uploading UI overrides"
  AFFINE_HOST="$HOST" SSH_KEY="$SSH_KEY" bash "$ROOT/deploy/oracle/deploy-ui-overrides.sh"
}

deploy_stack() {
  echo "==> [stack] Sync docker-compose + pull stable image"
  "${SCP[@]}" "$ROOT/deploy/oracle/docker-compose.yml" "${USER}@${HOST}:/tmp/affine-docker-compose.yml"
  "${SSH[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
cd /opt/affine
# Keep local volume mounts / data; only refresh service definitions carefully.
if [[ -f /tmp/affine-docker-compose.yml ]]; then
  # Preserve web-static mount if present in running compose
  if grep -q 'web-static:/app/static' docker-compose.yml 2>/dev/null; then
    sudo cp /tmp/affine-docker-compose.yml docker-compose.yml
  else
    sudo cp /tmp/affine-docker-compose.yml docker-compose.yml
  fi
fi
sudo docker compose pull affine affine_migration
sudo docker compose up -d
sleep 4
curl -fsS -o /dev/null -w 'affine %{http_code}\n' http://127.0.0.1:3010/
REMOTE
}

case "$MODE" in
  css) deploy_css ;;
  stack) deploy_stack ;;
  all)
    deploy_stack
    deploy_css
    ;;
  *)
    echo "Usage: $0 [css|stack|all]" >&2
    exit 1
    ;;
esac

echo "==> Deploy finished ($MODE) → https://affine-uribe.duckdns.org"
