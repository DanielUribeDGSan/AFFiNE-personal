#!/usr/bin/env bash
# Inject compact left-aligned UI CSS into official stable static (no JS rebuild).
# IMPORTANT: CSS only — never inject MutationObserver/style JS (causes reload loops).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST="${AFFINE_HOST:-159.54.149.50}"
USER="${AFFINE_SSH_USER:-ubuntu}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
SSH=(ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$SSH_KEY" "${USER}@${HOST}")
CSS_SRC="$ROOT/deploy/oracle/affine-ui-overrides.css"

echo "==> Uploading UI overrides to ${HOST}"
scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$SSH_KEY" "$CSS_SRC" "${USER}@${HOST}:/tmp/affine-ui-overrides.css"

"${SSH[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
STATIC=/opt/affine/web-static
sudo mkdir -p "$STATIC/custom"
sudo cp /tmp/affine-ui-overrides.css "$STATIC/custom/affine-ui-overrides.css"

sudo python3 <<'PY'
from pathlib import Path
import re

css = Path('/opt/affine/web-static/custom/affine-ui-overrides.css').read_text()
p = Path('/opt/affine/web-static/selfhost.html')
text = p.read_text()

# Strip any previous injections (including the dangerous boot script)
text = re.sub(r'\s*<link rel="stylesheet" href="/custom/affine-ui-overrides\.css[^"]*">\s*', '\n', text)
text = re.sub(r'\s*<style id="affine-ui-overrides-inline">[\s\S]*?</style>\s*', '\n', text)
text = re.sub(r'\s*<script id="affine-ui-overrides-boot">[\s\S]*?</script>\s*', '\n', text)
text = re.sub(r'\s*<script>\s*\(function \(\) \{[\s\S]*?affine-ui-overrides[\s\S]*?\}\)\(\);\s*</script>\s*', '\n', text)

mtime = Path('/opt/affine/web-static/custom/affine-ui-overrides.css').stat().st_mtime_ns
# CSS only — no JS observers (those caused infinite reload loops)
inline = f'''    <style id="affine-ui-overrides-inline">
{css}
    </style>
    <link rel="stylesheet" href="/custom/affine-ui-overrides.css?v={mtime}">
'''

if '</head>' in text:
    text = text.replace('</head>', inline + '</head>', 1)
else:
    text = inline + text
p.write_text(text)
print('selfhost.html patched (CSS only)')
print('has boot script:', 'affine-ui-overrides-boot' in text)
PY

curl -fsS -o /dev/null -w 'css %{http_code}\n' http://127.0.0.1:3010/custom/affine-ui-overrides.css
if curl -fsS http://127.0.0.1:3010/ | grep -q 'affine-ui-overrides-boot\|MutationObserver\|setInterval(apply'; then
  echo 'ERROR: dangerous boot script still present' >&2
  exit 1
fi
echo -n 'inline markers: '
curl -fsS http://127.0.0.1:3010/ | grep -c 'affine-ui-overrides-inline'
REMOTE

echo "==> Done. Hard-refresh https://affine-uribe.duckdns.org (Cmd+Shift+R)"
