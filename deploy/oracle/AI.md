# Guía para IAs — Shift / AFFiNE en Oracle

Documento operativo para agentes. Lee esto **antes** de tocar el deploy.

## Enlace del archivo (pasa este link)

**Ruta en el repo:** [`deploy/oracle/AI.md`](./AI.md)

URL pública del sitio: https://affine-uribe.duckdns.org  
Workspace Shift: `ea8aff53-982d-4f60-88ee-e42e829b3bee`

---

## Arquitectura (lo importante)

| Capa | Dónde | Qué es |
|------|--------|--------|
| App live | VM Oracle `159.54.149.50` | Docker `affine:stable` en `/opt/affine` |
| UI custom | `deploy/oracle/affine-ui-overrides.css` + `affine-ui-boot.js` | CSS/JS inyectados en static + SSR |
| Auto-publish | `deploy/oracle/auto-publish-docs.sql` | Triggers Postgres: docs nuevos → públicos |
| Monorepo canary | código React/BlockSuite local | **NO** se despliega entero a Oracle (rompe sync) |

**Regla de oro:** en Oracle solo se refrescan overrides (`css`/`boot`/`sql`) o la imagen Docker oficial. No subir el build canary del monorepo sobre el backend stable.

---

## Qué archivo editar según el cambio

| Quieres… | Edita | Luego despliega |
|----------|--------|-----------------|
| Layout, ocultar UI, colores, tema | `deploy/oracle/affine-ui-overrides.css` | UI overrides |
| Comportamiento DOM (barra insert, share URL, tema, ocultar Download App) | `deploy/oracle/affine-ui-boot.js` | UI overrides |
| Docs públicos / comentarios con sesión | `deploy/oracle/auto-publish-docs.sql` | UI overrides (incluye SQL) o `psql` manual |
| Actualizar AFFiNE oficial | — | `deploy.sh stack` o `all` |
| Features profundas del editor (React/BlockSuite) | monorepo | Solo local; **no** a Oracle salvo rebuild controlado |

---

## Cómo refrescar cambios en Oracle

### 1) UI (CSS + boot + SQL) — lo más habitual

Desde la raíz del repo en tu Mac:

```bash
bash deploy/oracle/deploy-ui-overrides.sh
```

Eso:

1. Sube por SCP a la VM (`ubuntu@159.54.149.50`)
2. Copia a `/opt/affine/web-static/custom/`
3. Parchea `selfhost.html` y el SSR en `/app/dist/main.js` (dentro del contenedor)
4. Aplica `auto-publish-docs.sql` en Postgres
5. **Reinicia el contenedor `affine`** (`docker compose restart affine`)

### 2) Stack Docker (imagen oficial)

```bash
bash deploy/oracle/deploy.sh stack   # solo pull + restart
bash deploy/oracle/deploy.sh all     # stack + UI
bash deploy/oracle/deploy.sh css     # legacy: solo CSS vía deploy.sh
```

### 3) GitHub Actions

Push a `main` o workflow **Deploy Oracle** (secrets `ORACLE_SSH_KEY`, etc.). Ver `deploy/oracle/README.md`.

---

## Qué reiniciar (y qué no)

| Acción | ¿Reiniciar? | Comando / efecto |
|--------|-------------|------------------|
| Cambios CSS/boot vía `deploy-ui-overrides.sh` | **Sí** — contenedor `affine` | El script ya hace `docker compose restart affine` |
| Solo SQL en Postgres | No hace falta reiniciar app | `docker compose exec -T postgres psql -U affine -d affine < …` |
| Pull nueva imagen | **Sí** — stack | `deploy.sh stack` / `docker compose up -d` |
| Tras cualquier deploy UI | Hard refresh navegador | `Cmd+Shift+R` en https://affine-uribe.duckdns.org |

**No reinicies** Postgres salvo mantenimiento. Los triggers de auto-publish viven en la DB y persisten.

SSH típico:

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@159.54.149.50
cd /opt/affine && sudo docker compose ps
sudo docker compose restart affine
```

---

## Dónde viven los archivos en la VM

```
/opt/affine/
  docker-compose.yml
  web-static/
    selfhost.html          ← inyecta CSS/boot
    custom/
      affine-ui-overrides.css
      affine-ui-boot.js
  data/postgres/           ← datos persistentes
```

Dentro del contenedor `affine`:

- `/app/dist/main.js` — plantilla SSR de `/workspace/*` (también recibe inject)

Rutas web tras deploy:

- CSS: `https://affine-uribe.duckdns.org/custom/affine-ui-overrides.css`
- Boot: `https://affine-uribe.duckdns.org/custom/affine-ui-boot.js`

---

## Comportamiento de producto ya configurado

- **Share público:** usar `/share/<workspaceId>/<docId>` (no `/workspace/...`).
- **Copy link** (boot): reescribe `/workspace/` → `/share/`.
- **Lectura:** cualquiera sin sesión.
- **Comentarios:** solo con sesión (`member_default_role = commenter`, `public_role = external`).
- **Docs nuevos:** trigger Postgres auto-publica en workspace Shift.
- **Tema Claro/Oscuro:** botón flotante (boot); sincroniza `data-theme` del editor.
- **Oculto:** Download App, Built with, “Open this doc in AFFiNE app”.

Ejemplo link público:

`https://affine-uribe.duckdns.org/share/ea8aff53-982d-4f60-88ee-e42e829b3bee/<DOC_ID>?mode=page`

---

## Checklist rápido para un agente

1. ¿El cambio cabe en CSS/boot/SQL de `deploy/oracle/`? Si no → explicar limitación.
2. Editar archivos locales en `deploy/oracle/`.
3. Correr `bash deploy/oracle/deploy-ui-overrides.sh`.
4. Confirmar restart del contenedor `affine` (el script lo hace).
5. Pedir hard refresh al usuario (`Cmd+Shift+R`).
6. Verificar con curl o navegador las URLs `/custom/...`.

---

## Anti-patrones

- No desplegar `packages/frontend` canary completo sobre Oracle stable.
- No asumir que editar React local ya está en producción.
- No usar solo `selfhost.html`: las rutas `/workspace/*` van por SSR → hace falta el patch de `main.js` (ya incluido en el script).
- No pedir force-push ni tocar secrets en commits.
