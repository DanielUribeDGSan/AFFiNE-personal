#!/usr/bin/env bash
# Instala/actualiza AFFiNE self-hosted con Docker Compose en la VM.
set -euo pipefail

AFFINE_DIR="${AFFINE_DIR:-/opt/affine}"
PUBLIC_HOST="${1:-}"

if [[ -z "${PUBLIC_HOST}" ]]; then
  PUBLIC_HOST="$(curl -fsS --max-time 5 http://169.254.169.254/opc/v2/vnics/ \
    -H 'Authorization: Bearer Oracle' 2>/dev/null \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)[0].get("publicIp",""))' 2>/dev/null || true)"
fi

if [[ -z "${PUBLIC_HOST}" ]]; then
  PUBLIC_HOST="$(curl -fsS --max-time 5 https://ifconfig.me || true)"
fi

if [[ -z "${PUBLIC_HOST}" ]]; then
  echo "No se pudo detectar la IP pública. Uso: $0 <IP_O_DOMINIO>"
  exit 1
fi

EXTERNAL_URL="http://${PUBLIC_HOST}:3010"

echo "==> Directorio: ${AFFINE_DIR}"
echo "==> URL pública: ${EXTERNAL_URL}"

sudo mkdir -p "${AFFINE_DIR}/config" "${AFFINE_DIR}/data/postgres" "${AFFINE_DIR}/data/storage"
sudo chown -R "$(id -u):$(id -g)" "${AFFINE_DIR}"

curl -fsSL -o "${AFFINE_DIR}/docker-compose.yml" \
  https://github.com/toeverything/AFFiNE/releases/latest/download/docker-compose.yml

cat > "${AFFINE_DIR}/config/config.json" <<EOF
{
  "\$schema": "https://github.com/toeverything/affine/releases/latest/download/config.schema.json",
  "deployment": {
    "type": "selfhosted"
  },
  "server": {
    "name": "AFFiNE Personal",
    "externalUrl": "${EXTERNAL_URL}"
  },
  "copilot": {
    "enabled": true,
    "byok": {
      "enabled": true,
      "allowCustomEndpoint": true
    }
  },
  "indexer": {
    "enabled": true,
    "provider.type": "embedded"
  }
}
EOF

cd "${AFFINE_DIR}"
docker compose pull
docker compose up -d

echo
echo "AFFiNE desplegado."
echo "Abre: ${EXTERNAL_URL}"
echo "Crea ahí la cuenta de administrador (solo la primera vez)."
docker compose ps
