# 🚀 Deploy: de la PC a Internet

Arquitectura en producción:

```
Celular ──HTTPS──▶ Vercel: guest-web  ─┐  (rewrite /v1/* → API)
Mozo/KDS ─HTTPS──▶ Vercel: staff-web  ─┼──▶ Render: bar-api (Docker) ──▶ Neon (Postgres)
                                       │         ▲
                                       └─────────┘    Render: bar-outbox-worker ──▶ Upstash (Redis)
```

Los navegadores **solo hablan con su propio dominio de Vercel**: Next reenvía `/v1/*` a la API (`next.config.ts → rewrites`). Por eso no hace falta CORS, y la carta funciona igual en localhost, por la IP de la red, por el túnel o en producción.

---

## 0. Probar sin deployar: MVP local con un clic

Doble clic en **`INICIAR-MVP.cmd`** (raíz del repo): levanta Docker, migra la base, compila en modo producción, arranca API + carta + panel, abre los túneles HTTPS y muestra `.mvp/LINKS.html` con los QR. Para apagar: **`DETENER-MVP.cmd`**. Logs en `.mvp/logs`.

## 0.b Túnel HTTPS a mano (cámara/AR desde el celular)

```bash
cloudflared tunnel --url http://localhost:3000   # carta
cloudflared tunnel --url http://localhost:3001   # panel (en otra terminal)
```
Cada comando imprime una URL `https://xxxx.trycloudflare.com`. Abrila en el celular: es HTTPS real, así que la cámara y la Realidad Aumentada funcionan. La URL cambia cada vez y solo vive mientras la PC esté prendida.

---

## 1. Base de datos: Neon (Postgres)
1. Crear un proyecto en https://neon.tech (región **São Paulo** si está disponible).
2. Copiar el **connection string** con `?sslmode=require` → será `DATABASE_URL`.
3. Las migraciones las aplica la API sola al arrancar (`prisma migrate deploy`).
4. Datos de demo (opcional, una vez, desde tu PC):
   ```bash
   DATABASE_URL="<url de neon>" corepack pnpm db:seed
   ```

## 2. Redis: Upstash
1. Crear una base Redis en https://upstash.com (misma región).
2. Copiar la URL `rediss://...` → será `REDIS_URL` (la usa el worker del outbox).

## 3. API + worker: Render
1. En Render → **New → Blueprint** → elegir el repo `NicBazan/bar`. Toma `render.yaml`.
2. Cargar las variables:

| Variable | Valor |
| :-- | :-- |
| `DATABASE_URL` | la de Neon |
| `REDIS_URL` | la de Upstash |
| `JWT_SECRET` | la genera Render (`generateValue`) |
| `NFC_MASTER_KEY` | 32 caracteres hex. Generar: `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"` |
| `CORS_ORIGINS` | los dominios de Vercel separados por coma (solo si algún cliente llama a la API directo) |
| `PUBLIC_GUEST_URL` | la URL de la carta en Vercel (ej. `https://bar-carta.vercel.app`): con ella el admin arma los QR |
| `TRUST_PROXY` | `2` (Vercel + Render). **Nunca** `true`: permitiría inventarse la IP y saltear los límites |
| `UPLOADS_DIR` | `/data/uploads` con el disco persistente de `render.yaml` (sin disco, las fotos se pierden en cada deploy) |

3. Probar: `https://bar-api.onrender.com/health` → `{"ok":true}`.
4. Crear el super admin de la plataforma (una vez, desde tu PC, con la `DATABASE_URL` de Neon):
   ```bash
   DATABASE_URL="<url de neon>" corepack pnpm --filter @bar/db create-superadmin admin@tudominio.com "una-contraseña-larga"
   ```

> El plan free de Render "duerme" la API tras 15 minutos sin uso; el primer pedido tarda ~30 s en despertarla. Para un bar real: plan Starter.
> El **worker** no tiene plan free. Mientras no exista el broker de tiempo real, la app funciona sin él (los fronts hacen polling a `/v1/state`), así que se puede dejar para después.

## 4. Fronts: Vercel (dos proyectos)

| Proyecto | Root Directory | Variable |
| :-- | :-- | :-- |
| `bar-carta` | `apps/guest-web` | `API_INTERNAL_URL=https://bar-api.onrender.com` |
| `bar-panel` | `apps/staff-web` | `API_INTERNAL_URL=https://bar-api.onrender.com` |

Vercel detecta pnpm y el monorepo solo. Después del primer deploy, los QR de las mesas apuntan a `https://bar-carta.vercel.app/t/{code}`.

---

## Checklist antes de abrirlo a un bar real
- [ ] `JWT_SECRET` y `NFC_MASTER_KEY` propios. En producción la API **no arranca** sin ellos.
- [ ] Usuarios demo (`*@bardemo.test` / `demo1234`, `superadmin@bar.test`) **no** cargados en la base de producción: no correr el seed; usar `create-superadmin`.
- [ ] Leer [docs/SEGURIDAD.md](docs/SEGURIDAD.md) → "Riesgos aceptados / pendientes".
- [ ] Dominio propio (ej. `carta.tubar.com`) y QR impresos con ese dominio.
- [ ] Backups automáticos de Neon activados.
- [ ] Rate limit con store en Redis (hoy es por instancia; con una sola instancia alcanza).
