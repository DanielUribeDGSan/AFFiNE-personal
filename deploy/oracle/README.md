# Deploy Oracle (`affine-uribe.duckdns.org`)

**Para IAs / agentes:** lee [`AI.md`](./AI.md) (cómo funciona, qué subir, qué reiniciar).

## Qué se despliega

| Modo | Qué hace | Seguro |
|------|----------|--------|
| `css` | Sube `affine-ui-overrides.css` y lo inyecta en `selfhost.html` | Sí |
| `stack` | `docker compose pull` de `affine:stable` + restart | Sí (imagen oficial) |
| `all` | `stack` + `css` | Sí |

**No** se despliega el frontend canary del monorepo sobre el backend stable: rompe GraphQL/sync.

## Manual (desde tu Mac)

```bash
./deploy/oracle/deploy.sh css      # solo CSS
./deploy/oracle/deploy.sh stack    # actualizar imagen Docker
./deploy/oracle/deploy.sh all
```

## Automático con GitHub Actions

1. En el repo → **Settings → Secrets and variables → Actions**, crea:

   | Secret | Valor |
   |--------|--------|
   | `ORACLE_SSH_KEY` | Contenido de la private key (`~/.ssh/id_ed25519`) que ya entra a la VM |
   | `ORACLE_HOST` | `159.54.149.50` (opcional) |
   | `ORACLE_SSH_USER` | `ubuntu` (opcional) |

2. **Push a `main`** → Actions corre **`all`** (Docker `affine:stable` + CSS) automáticamente.

3. Manual (opcional): **Actions → Deploy Oracle → Run workflow** y elige `css` / `stack` / `all`.

Tras el deploy, hard-refresh del navegador (`Cmd+Shift+R`).

### Qué NO se despliega aún con el push

El código custom del monorepo (React/BlockSuite canary) **no** se sube solo a Oracle: un frontend canary sobre backend stable rompe GraphQL/sync. Lo que sí se actualiza solo es la imagen oficial + tu CSS en `deploy/oracle/`.
