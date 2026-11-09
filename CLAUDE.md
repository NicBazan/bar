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
- **Documentos vivos:** `PLAN-MAESTRO.md` (estrategia y hitos), `docs/ARQUITECTURA.md`, `docs/DESARROLLO-LOCAL.md`, `docs/SEGURIDAD.md`, `docs/PLAN-APP-CLIENTE.md`, `docs/DIAGNOSTICO-2026-11.md`, `DEPLOY.md`.

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
- **Estructura (GRASP/GoF):** funciones de hasta ~40 líneas y una responsabilidad. Controlador fino que coordina; el cálculo va en funciones puras (Pure Fabrication) y cada decisión en quien tiene los datos (Information Expert). Reglas que crecen → Strategy (`ordering/order-policy.ts`); acciones por nombre → Command (`SESSION_ACTIONS`). Medir con el script de `docs/AUDITORIA-2026-11-08.md`.
- **Estado de una mesa:** solo `table-session/lifecycle.ts` lo cambia (abrir, PIN nuevo, cerrar). Cerrar siempre emite el comprobante numerado.
- **Pedidos:** toda regla anti-abuso o anti-duplicado va en `order-policy.ts`, se evalúa con la sesión bloqueada (`FOR UPDATE`) y lleva su test en `escenarios-mesa.e2e.test.ts`.
- **Comprobante:** lo histórico se copia. El comprobante final no se recalcula nunca; el número sale de `UPDATE ... RETURNING` + `UNIQUE`.

## 3. Pruebas

- `corepack pnpm --filter @bar/api test` (vitest, necesita Docker arriba). Usa su propia base `bar_test` (nunca la de desarrollo). Ruta nueva → clasificarla en `test/permissions-matrix.test.ts`. Tipos: `npx tsc --noEmit -p .` en cada app.
- Todo bug lleva un test `REGRESIÓN: ...` que lo reproduce primero.
- Lo que depende del motor (concurrencia, transacciones, restricciones) se prueba contra Postgres real, nunca contra la base del desarrollador con datos.
- Probar el payload exacto que manda cada pantalla antes de endurecer una validación.

## 4. Diseño visual

Paleta **ZainSoft en pastel** (decidido por el usuario el 09/11) en la carta, Mi cuenta y todos los paneles. Títulos en **Fraunces** (serif suave, `font-display`) y texto en **Outfit** (`font-sans`), autoalojadas con next/font. Tema **Automático / Claro / Oscuro** en todas las pantallas (`ThemeToggle`, el cambio se revela con un círculo desde el botón).

Tokens (en `globals.css` de cada app, nombres heredados — no renombrar sin migrar todos los usos):

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `paper` | `#FAF6F1` | `#1B1917` | fondo de página |
| `surface` | `#FFFFFF` | `#24211E` | tarjetas, hojas |
| `surface-2` | `#F4EEE7` | `#2E2A26` | chips, inputs, botones secundarios |
| `line` | `#ECE4DA` | `#3A352F` | bordes de 1 px |
| `cream` (= tinta) | `#2B2622` | `#F1EBE4` | texto principal |
| `muted` | `#6E655D` | `#B4AAA0` | texto secundario (5,0:1 sobre chips) |
| `amber` / `brand` | `#F6B49A` | `#F4A988` | **único acento** (coral pastel): botón primario, barra de 4 px |
| `amber-ink` | `#5A2410` | `#3A1A0C` | texto sobre el acento (7,0:1) |
| `brand-dark` | `#B53D17` | `#F7B79C` | acento como **texto** o enlace |
| `ok` / `warn` + `on-state` | `#2F7A55` / `#B4413A` | `#7FD1A4` / `#F28B82` | solo estados |

- Sin sombras ni degradados. Radios amables (12–20 px). Firma: `border-l-4 border-l-amber` en lo destacado. Un acento por zona.
- Prohibido: mayúsculas espaciadas en rótulos, `text-amber` como texto, colores fijos (`bg-white`, `text-white`) donde corresponde un token.
- Layout: pantallas de lectura (admin, plataforma) centradas con `max-w-6xl` (`StaffHeader contained`); salón y cocina a todo el ancho. Las tarjetas llevan `min-w-0` (sin eso desbordan en el celular dentro de una grilla). Métricas en 2 columnas en el celular.
- El super admin muestra el logo de ZainSoft (`/zainsoft/logo.png` y `logo-dark.png` según el tema).
- Cada pantalla: estados vacío/cargando/error, foco visible, muestra `data.error`, deshabilita el botón al enviar.
- Verificación: captura en escritorio y móvil (375 px) y chequeo de desborde horizontal antes de cerrar.

## 5. Cierre de cada bloque

Mostrar la salida de tests, tipos y build. Si algo falla, decirlo. Commit con mensaje en español (`feat(...)`, `fix(...)`). Lista explícita de lo pendiente y de lo que no se pudo verificar. Al correr el MVP, entregar `.mvp/LINKS.html` con QR, links y logins.
