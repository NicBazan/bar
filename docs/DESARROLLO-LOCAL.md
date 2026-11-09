# Desarrollo local

Cómo correr la plataforma en una PC y probarla desde el celular. La arquitectura está en [ARQUITECTURA.md](ARQUITECTURA.md) y el pase a la nube en [DEPLOY.md](../DEPLOY.md).

## Arrancar el MVP (lo normal)
**Doble clic en `INICIAR-MVP.cmd`.** Hace todo y abre `.mvp/LINKS.html` con los QR. Para apagar: `DETENER-MVP.cmd`. Logs en `.mvp/logs/`.

Usuarios demo (contraseñas solo de desarrollo, definidas en `packages/db/prisma/seed.ts`):

| Rol | Email | Contraseña | Entra a |
| :-- | :-- | :-- | :-- |
| Dueño | `dueno@bardemo.test` | `demo1234` | `/admin` |
| Mozo | `mozo@bardemo.test` | `demo1234` | `/waiter` |
| Cocina | `cocina@bardemo.test` | `demo1234` | `/kds` |
| Super admin | `superadmin@bar.test` | `superadmin1234` | `/superadmin` |

## Modo desarrollo (para programar)
```bash
corepack pnpm infra:up                          # Postgres :5433 + Redis :6380
corepack pnpm db:deploy                         # migraciones
corepack pnpm db:seed                           # SOLO si querés resetear el demo (regenera los QR)
corepack pnpm --filter @bar/api dev             # API        http://localhost:4000
corepack pnpm --filter @bar/guest-web dev       # Carta      http://localhost:3000/t/{code}
corepack pnpm --filter @bar/staff-web dev       # Panel      http://localhost:3001/login
corepack pnpm --filter @bar/api test            # 74 tests (base propia bar_test)
node scripts/mvp/smoke.mjs                      # prueba de humo contra el MVP arrancado
```
No mezclar: si el MVP está andando, los puertos 3000/3001/4000 están ocupados (primero `DETENER-MVP.cmd`).

## Celular
- **Sin HTTPS local:** se decidió no instalar certificados en el celular (el arranque ya no levanta Caddy). Para cámara, AR y notificaciones push se usa el túnel HTTPS con datos móviles.
- **En el Wi-Fi de casa, sin instalar nada:** `http://192.168.100.25:3000/t/{code}`. Funciona todo menos la cámara/AR.
- **Con datos móviles:** el link `https://….trycloudflare.com` del túnel. Funciona todo, incluida la AR. En el Wi-Fi de casa no abre porque el router bloquea `trycloudflare.com` (ver §12).
- **Producción:** [DEPLOY.md](DEPLOY.md).

## "Mi cuenta" en local
- **Emails:** con `EMAIL_PROVIDER` sin definir se usa el adaptador **consola**: el código de ingreso y los emails de promos se escriben en `.mvp/logs/api.log` (no sale nada a internet). En producción: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` y `EMAIL_FROM` con un dominio verificado.
- **Web Push:** claves VAPID en `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (y `VAPID_SUBJECT=mailto:…`). Si no están, se derivan de `JWT_SECRET` (estables entre reinicios). Push solo anda en contexto seguro: `localhost` en la PC o el túnel HTTPS; por `http://192.168.x.x` el perfil lo explica y no lo ofrece. En iPhone, solo con la carta agregada a la pantalla de inicio (iOS 16.4+).
- **Seed:** el bar demo arranca con sellos por visita ("Café o cerveza gratis" a los 5, "Postre gratis" a los 10).

## Problemas conocidos

| Síntoma | Causa | Solución |
| :-- | :-- | :-- |
| El celular dice "no se puede acceder" con el link `trycloudflare.com` | El DNS del router (`192.168.100.1`) bloquea **todo** `trycloudflare.com` (verificado: el dominio raíz y los subdominios fallan; google.com anda) | En el celular: datos móviles, o Android → Ajustes → DNS privado → `one.one.one.one`. O cambiar el DNS del router. En el Wi-Fi, usar el link `http://192.168.100.25:3000` |
| `cloudflared` no arranca: `lookup api.trycloudflare.com: no such host` | Mismo bloqueo, en la PC | Ya se cambió el DNS de la PC a 1.1.1.1 / 8.8.8.8 (IPv4 e IPv6). Para volver: `Set-DnsClientServerAddress -InterfaceAlias "Ethernet 2" -ResetServerAddresses` |
| `EADDRINUSE` en 3000 / 3001 / 4000 | El MVP (u otro server) ya está corriendo | `DETENER-MVP.cmd`, o `Get-NetTCPConnection -LocalPort 3000,3001,4000 -State Listen \| % { Stop-Process -Id $_.OwningProcess -Force }` |
| "Error de conexión" en el celular por `http://192.168.x.x` | `crypto.randomUUID()` no existe fuera de HTTPS | Resuelto: `uuid()` de `lib/storage.ts` |
| "El mozo todavía no abrió la mesa" | Protección contra pedidos falsos | El mozo toca **Abrir mesa** (o se entra por NFC) |
| Pide PIN al entrar | La mesa ya tiene sesión desde otro dispositivo (otro navegador u otro dominio cuenta como otro dispositivo) | Ver el PIN en el panel del mozo; si se bloqueó, **PIN nuevo** |
| El 3D se queda en "Cargando 3D…" en el panel del navegador de Claude | El panel oculto no pinta y `<model-viewer>` espera a estar visible | No pasa en un navegador normal |
| No llega el código de "Mi cuenta" | En local no se mandan emails (adaptador consola) | Buscar `[EMAIL]` en `.mvp/logs/api.log`. En producción: `EMAIL_PROVIDER=resend` |
| "Notificaciones en este celular" aparece desactivado | Por `http://192.168.x.x` no hay contexto seguro; en iPhone hace falta agregar la carta a inicio | Usar el túnel HTTPS (datos móviles). En iPhone: Compartir → Agregar a inicio |
| "Podés mandar 1 aviso por semana" | Tope por bar (Ley 25.326 y para no quemar la base) | Esperar la fecha que muestra el admin. En la base local de pruebas: borrar la fila de `Campaign` |
| `sharp` / `gltf-transform`: `colourspace: parameter space not set` | libvips roto en esta PC | Comprimir modelos en Linux o en CI |
| En PowerShell 5.1, `psql -c "... \"Tabla\" ..."` falla | PowerShell 5.1 rompe las comillas dobles al pasarlas a un .exe | Pasar el SQL por stdin (como hace `start-mvp.ps1`) |
| Después de `db:seed` los links de las mesas cambian | El seed regenera los códigos QR | Usar los links nuevos (están en `.mvp/LINKS.html` al arrancar) |
