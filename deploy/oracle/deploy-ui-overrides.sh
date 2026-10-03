#!/usr/bin/env bash
# Inject UI CSS + safe boot JS into:
#  1) static selfhost.html  (covers /)
#  2) SSR template in /app/dist/main.js  (covers /workspace/*)
# Without (2), workspace pages never get the overrides (env:renderer=ssr).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST="${AFFINE_HOST:-159.54.149.50}"
USER="${AFFINE_SSH_USER:-ubuntu}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
SSH=(ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$SSH_KEY" "${USER}@${HOST}")
CSS_SRC="$ROOT/deploy/oracle/affine-ui-overrides.css"
JS_SRC="$ROOT/deploy/oracle/affine-ui-boot.js"

SQL_SRC="$ROOT/deploy/oracle/auto-publish-docs.sql"

echo "==> Uploading UI overrides to ${HOST}"
scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$SSH_KEY" \
  "$CSS_SRC" "$JS_SRC" "$SQL_SRC" \
  "${USER}@${HOST}:/tmp/"

"${SSH[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
STATIC=/opt/affine/web-static
sudo mkdir -p "$STATIC/custom"
sudo cp /tmp/affine-ui-overrides.css "$STATIC/custom/affine-ui-overrides.css"
sudo cp /tmp/affine-ui-boot.js "$STATIC/custom/affine-ui-boot.js"

# Keep Shift docs auto-public (new docs too)
if [[ -f /tmp/auto-publish-docs.sql ]]; then
  cd /opt/affine
  sudo docker compose exec -T postgres psql -U affine -d affine < /tmp/auto-publish-docs.sql >/tmp/auto-publish-docs.log || true
  echo "auto-publish sql applied"
fi

# --- 1) Patch selfhost.html (static entry for /) ---
sudo python3 <<'PY'
from pathlib import Path
import re

css = Path('/opt/affine/web-static/custom/affine-ui-overrides.css').read_text()
p = Path('/opt/affine/web-static/selfhost.html')
text = p.read_text()

text = re.sub(r'\s*<link rel="stylesheet" href="/custom/affine-ui-overrides\.css[^"]*">\s*', '\n', text)
text = re.sub(r'\s*<style id="affine-ui-overrides-inline">[\s\S]*?</style>\s*', '\n', text)
text = re.sub(r'\s*<script id="affine-ui-overrides-boot"[^>]*>[\s\S]*?</script>\s*', '\n', text)
text = re.sub(r'\s*<script src="/custom/affine-ui-boot\.js[^"]*"></script>\s*', '\n', text)
text = re.sub(r'\s*<script>\s*\(function \(\) \{[\s\S]*?affine-ui-overrides[\s\S]*?\}\)\(\);\s*</script>\s*', '\n', text)

mtime = Path('/opt/affine/web-static/custom/affine-ui-overrides.css').stat().st_mtime_ns
jmtime = Path('/opt/affine/web-static/custom/affine-ui-boot.js').stat().st_mtime_ns
inline = f'''    <style id="affine-ui-overrides-inline">
{css}
    </style>
    <link rel="stylesheet" href="/custom/affine-ui-overrides.css?v={mtime}">
    <script src="/custom/affine-ui-boot.js?v={jmtime}" defer></script>
'''

if '</head>' in text:
    text = text.replace('</head>', inline + '</head>', 1)
else:
    text = inline + text
p.write_text(text)
print('selfhost.html patched')
PY

# --- 2) Patch SSR template inside the running container ---
# Workspace routes render HTML from /app/dist/main.js, not selfhost.html.
cat > /tmp/patch-affine-ssr.js <<'NODE'
const fs = require('fs');
const path = '/app/dist/main.js';
let t = fs.readFileSync(path, 'utf8');

const MARKER = '<!--affine-ui-overrides-->';
const v = Date.now();
const INJECT =
  MARKER +
  `<link rel="stylesheet" href="/custom/affine-ui-overrides.css?v=${v}">` +
  `<script src="/custom/affine-ui-boot.js?v=${v}" defer></script>`;

// Remove previous injection if present (with or without cache buster / old markers)
t = t.replace(
  /(?:\/\*affine-ui-overrides\*\/|<!--affine-ui-overrides-->)<link rel="stylesheet" href="\/custom\/affine-ui-overrides\.css[^"]*"><script src="\/custom\/affine-ui-boot\.js[^"]*" defer><\/script>/g,
  ''
);

const token =
  '${t.css.map(e=>`<link rel="stylesheet" href="${e}" crossorigin />`).join("\\n")}';
const idx = t.indexOf(token);
if (idx < 0) {
  // Some builds escape differently
  const idxAlt = t.indexOf('t.css.map(e=>`<link rel="stylesheet"');
  if (idxAlt < 0) {
    console.error('SSR css.map template not found');
    process.exit(1);
  }
  const headIdx = t.indexOf('</head>', idxAlt);
  if (headIdx < 0) {
    console.error('</head> after css.map not found');
    process.exit(1);
  }
  t = t.slice(0, headIdx) + INJECT + t.slice(headIdx);
} else {
  const headIdx = t.indexOf('</head>', idx);
  if (headIdx < 0) {
    console.error('</head> after css.map not found');
    process.exit(1);
  }
  t = t.slice(0, headIdx) + INJECT + t.slice(headIdx);
}

fs.writeFileSync(path, t);
console.log('main.js SSR template patched, has marker:', t.includes(MARKER));
NODE

sudo docker cp /tmp/patch-affine-ssr.js affine_server:/tmp/patch-affine-ssr.js
sudo docker exec affine_server node /tmp/patch-affine-ssr.js

# --- 3) Patch format toolbar: show on caret (not only on text selection) ---
# Official AFFiNE only toggles Flag.Text when selection is non-collapsed.
# Also rewrite HTML script src to a cache-busted filename so browsers pick it up.
sudo python3 <<'PY'
from pathlib import Path
import re

static = Path('/opt/affine/web-static')
js_dir = static / 'js'
needle = "r=!!(S.activated&&i&&t&&!t.isCollapsed()&&t.from.length+(t.to?.length??0))"
repl = "r=!!(S.activated&&i&&t&&g.host.contains(i.commonAncestorContainer))"
patched_marker = "g.host.contains(i.commonAncestorContainer)"

# Prefer original hashed index.*.js (not our previous *-shift.js copies)
hits = sorted(
    [p for p in js_dir.glob('index.*.js') if '-shift' not in p.name],
    key=lambda p: p.stat().st_mtime,
    reverse=True,
)
if not hits:
    print('WARN: no index.*.js to patch for format toolbar')
else:
    src = hits[0]
    text = src.read_text(errors='ignore')
    if needle in text:
        text = text.replace(needle, repl, 1)
        print(f'{src.name}: applied caret-mode patch')
    elif patched_marker in text:
        print(f'{src.name}: already contains caret-mode patch')
    else:
        m = re.search(
            r'r=!!\(S\.activated&&i&&t&&!t\.isCollapsed\(\)&&t\.from\.length\+\(t\.to\?\.length\?\?0\)\)',
            text,
        )
        if not m:
            print(f'{src.name}: format toolbar pattern not found')
            text = None
        else:
            text = text[: m.start()] + repl + text[m.end() :]
            print(f'{src.name}: applied caret-mode patch (regex)')

    if text is not None:
        # Write cache-busted copy and point HTML at it
        out = js_dir / (src.stem + '-shift.js')
        out.write_text(text)
        print(f'wrote {out.name}')
        for html_name in ('selfhost.html', 'index.html'):
            hp = static / html_name
            if not hp.exists():
                continue
            ht = hp.read_text()
            ht2 = re.sub(
                r'/js/index\.[A-Za-z0-9_.-]+\.js',
                f'/js/{out.name}',
                ht,
            )
            if ht2 != ht:
                hp.write_text(ht2)
                print(f'{html_name}: script src -> {out.name}')

        # SSR reads assets-manifest.json for script tags
        manifest = static / 'assets-manifest.json'
        if manifest.exists() and out.exists():
            mt = manifest.read_text()
            mt2 = re.sub(
                r'js/index\.[A-Za-z0-9_.-]+\.js',
                f'js/{out.name}',
                mt,
            )
            if mt2 != mt:
                manifest.write_text(mt2)
                print(f'assets-manifest.json -> {out.name}')
            else:
                print('assets-manifest.json already points at shift bundle')
PY

# Restart so Node reloads main.js (same container layer keeps the patch)
cd /opt/affine
sudo docker compose restart affine
sleep 5

echo -n 'static / markers: '
curl -fsS http://127.0.0.1:3010/ | grep -c 'affine-ui-overrides' || true
echo -n 'ssr /workspace markers: '
curl -fsS http://127.0.0.1:3010/workspace/test-doc | grep -c 'affine-ui-overrides' || true
curl -fsS -o /dev/null -w 'css %{http_code}\n' http://127.0.0.1:3010/custom/affine-ui-overrides.css
curl -fsS -o /dev/null -w 'boot %{http_code}\n' http://127.0.0.1:3010/custom/affine-ui-boot.js
echo -n 'format-toolbar patch: '
grep -c 'g.host.contains(i.commonAncestorContainer)' /opt/affine/web-static/js/index.*.js || true
REMOTE

echo "==> Done. Hard-refresh https://affine-uribe.duckdns.org (Cmd+Shift+R)"
