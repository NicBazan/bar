# CLAUDE.md — Bar (carta digital + pedidos en mesa + panel del local)

> Lo que Claude lee **antes** de escribir código en este repo. Adaptado de la base de conocimiento:
> `C:\Users\nico pc\Desktop\Portafolio\base de conocimientos\Base-Conocimiento\` (hacer `git pull` ahí antes de una tarea grande).
> Ante conflicto, este archivo manda sobre la base; ante conflicto entre un patrón y la simplicidad, gana la simplicidad.

## 0. Contexto

- **Qué es:** el cliente escanea el QR/NFC de la mesa, ve la carta (con 3D/AR), pide y paga; el mozo aprueba, la cocina prepara (KDS), el dueño administra; el super admin administra la plataforma (multi-bar).
- **Roles:** cliente (sin cuenta o con "Mi cuenta" por email), WAITER, KITCHEN, CASHIER, MANAGER, OWNER, SUPER_ADMIN.
- **Stack:** monorepo pnpm + Turborepo · `apps/api` Fastify 5 + Zod 4 + jose · `packages/db` Prisma 6 + Postgres 16 · `apps/guest-web` (carta) y `apps/staff-web` (paneles) en Next 16 + Tailwind v4 · `apps/workers`.
- **Dónde corre:** local con `INICIAR-MVP.cmd` (Docker: Postgres en 5433 + Redis); prototipo en la nube según `DEPLOY.md` (webs en Vercel, API en Render/Vercel, base en Neon).
- **Datos sensibles:** dinero (pedidos, caja), datos personales de clientes (email), credenciales del staff.
- **Documentos vivos:** `PLAN-MAESTRO.md`, `docs/SEGURIDAD.md`, `docs/PLAN-APP-CLIENTE.md`, `docs/DIAGNOSTICO-2026-11.md`, `DEPLOY.md`.

## 1. Antes de empezar

1. Leer `01-fundamentos/REGLAS-ESENCIALES.md` de la base y las lecciones del tema.
2. Leer el código real antes de editarlo; verificar el comportamiento antes de documentarlo.
3. Decisiones con alternativas y consecuencias → preguntar y registrar en `docs/adr/NNNN-titulo.md`.
4. El usuario escribe en español rioplatense: responder igual. Commits autorizados; **preguntar antes de `git push`**.
5. Secretos (`CLOUDINARY_URL`, claves, contraseñas reales) los pega el usuario en `.env`; nunca pedirlos por el chat ni commitearlos.

## 2. Reglas de oro del proyecto

- **Editar con Edit/Write**, no con `sed`/`node -e` cuando hay regex o barras invertidas (se pierden; L-054/L-058).
- **Dinero en enteros** (`*Cents`). El servidor calcula precios y totales; el cliente nunca los decide.
- **Una operación de negocio = una transacción.** Transiciones de estado con escritura condicional (`updateMany ... where status in (...)`, `count === 0` → 409).
- **Efectos externos** (push, email, tiempo real) después del commit o por el outbox.
- Toda ruta: autenticación + rol + **alcance por tenant/venue** (`staffScope`). Nunca confiar en un `venueId` que mande el cliente.
- Entrada validada con Zod en el borde → 400 legible; forma de error única `{ error, message }`.
- Sesión revocable: el usuario activo, su rol y el tenant no suspendido se leen de la base en cada petición.
- No confiar en `X-Forwarded-For` salvo con `TRUST_PROXY`. Rate limit por dispositivo/email.
- Secretos: falla cerrado en producción (`config.ts`), aleatorios en desarrollo.

## 3. Pruebas

- `corepack pnpm --filter @bar/api test` (vitest, necesita Docker arriba). Tipos: `npx tsc --noEmit -p .` en cada app.
- Todo bug lleva un test `REGRESIÓN: ...` que lo reproduce primero.
- Lo que depende del motor (concurrencia, transacciones, restricciones) se prueba contra Postgres real, nunca contra la base del desarrollador con datos.
- Probar el payload exacto que manda cada pantalla antes de endurecer una validación.

## 4. Diseño visual

Dos superficies, dos criterios:

- **Paneles (`staff-web`: login, salón, cocina, admin, super admin)** → sistema «Naranja señal» de la base (`09-diseno-visual/`).
- **Carta y Mi cuenta (`guest-web`)** → misma paleta clara y las mismas reglas de calidad; radios algo más amables (10–18 px) porque es de cara al cliente. Si el bar sube su logo, la identidad del bar se respeta.

Tokens (en `globals.css` de cada app, nombres heredados — no renombrar sin migrar todos los usos):

| Token | Valor | Uso |
|---|---|---|
| `paper` | `#F4F5F6` | fondo de página |
| `surface` | `#FFFFFF` | tarjetas, hojas |
| `surface-2` | `#EEF0F2` | chips, botones secundarios |
| `line` | `#E3E5E8` | bordes de 1 px |
| `cream` (= tinta) | `#16181D` | texto principal |
| `muted` | `#5B616B` | texto secundario |
| `amber` / `brand` | `#E8590C` | **único acento**: relleno de botón primario, barra de 4 px |
| `amber-ink` | `#16181D` | texto sobre el acento (el blanco no pasa AA) |
| `brand-dark` | `#C2410C` | acento como **texto** o enlace (5,2:1) |
| `ok` / `warn` | `#1F7A4D` / `#B42318` | solo estados; texto blanco encima |

- IBM Plex Sans (300–700). Sin sombras (los tokens `shadow-*` valen 0), sin degradados, sin brillos de fondo, sin superficies oscuras.
- Firma: `border-l-4 border-l-amber` en lo actual o destacado. Un acento por zona.
- Prohibido: Inter/Roboto, degradados, crema cálido, mayúsculas espaciadas sobre títulos, `text-amber` como color de texto, `bg-night` como superficie.
- Cada pantalla: estados vacío/cargando/error, foco visible, muestra `data.error`, deshabilita el botón al enviar.
- Verificación: captura en escritorio y móvil (375 px) antes de cerrar.

## 5. Cierre de cada bloque

Mostrar la salida de tests, tipos y build. Si algo falla, decirlo. Commit con mensaje en español (`feat(...)`, `fix(...)`). Lista explícita de lo pendiente y de lo que no se pudo verificar. Al correr el MVP, entregar `.mvp/LINKS.html` con QR, links y logins.
