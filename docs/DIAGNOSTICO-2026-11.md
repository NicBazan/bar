# Diagnóstico del proyecto — 8 de noviembre de 2026

Revisión del estado de `bar` contra las reglas de la base de conocimiento (`REGLAS-ESENCIALES`, plantilla `CLAUDE.md`, sistema visual «Naranja señal»). Qué está bien, qué falta y en qué orden conviene avanzar.

## Estado medido hoy

| Chequeo | Resultado |
|---|---|
| Tipos (`pnpm typecheck`, 7 paquetes) | ✅ sin errores |
| Tests de la API (`vitest`, 10 archivos) | ✅ 74 de 74, contra la base propia `bar_test` |
| Tests de las webs (carta y paneles) | ❌ no hay |
| Integración continua | 🆕 `.github/workflows/ci.yml` (tipos + tests contra Postgres descartable) |
| Diseño claro y minimalista | ✅ capturas de bienvenida, carta, login, admin, salón y cocina (Mi cuenta y super admin migrados por código, sin captura) |

## Pros (lo que ya está sólido)

- **Producto completo de punta a punta:** QR/NFC → carta 3D/AR → pedido → aprobación del mozo → KDS por estación → cuenta → caja. Además: Mi cuenta con fidelización, promos, avisos push/email, Sudoku, onboarding de bares y super admin.
- **Dinero bien tratado:** enteros en centavos, precios y totales calculados en el servidor.
- **Seguridad por encima de la media de un MVP:** NFC SUN (NXP AN12196) con anti-replay, PIN de mesa con bloqueo, rate limit por dispositivo/email, CSP en producción, `trustProxy` solo explícito, secretos que fallan cerrado en producción, cookie de staff `HttpOnly` + `SameSite=Strict`, CORS con lista blanca.
- **Tiempo real con outbox** y catch-up en `/v1/state`: si se cae la conexión, el panel no pierde eventos.
- **Multi-tenant** con alcance por tenant/venue en las rutas del staff y tenant suspendible.
- **MVP local de un clic** (`INICIAR-MVP.cmd`) con QR y links listos.
- **Diseño unificado:** una sola paleta clara, IBM Plex Sans, un acento naranja, sin sombras ni degradados, texto sobre naranja que pasa AA.

## Contras (riesgos y deuda), por prioridad

### Alta

1. ✅ **Resuelto (8/11):** los tests usan `bar_test`, creada y migrada en el `globalSetup`. *Antes:* **los tests usaban la base de desarrollo con el seed** (`vitest.config.ts` apunta a `localhost:5433/bar`). La base de conocimiento lo prohíbe: un test puede borrar o ensuciar los datos con los que estás probando, y el resultado depende de lo que haya en la base. *Arreglo:* base `bar_test` separada, creada y migrada en el `globalSetup` de vitest. En CI ya es descartable.
2. ✅ **Resuelto (8/11):** `test/permissions-matrix.test.ts`. *Antes:* **no había test de matriz de permisos (L-025).** Cada ruta tiene su guardia, pero ningún test falla si mañana se agrega una ruta sin clasificar o con el rol equivocado. *Arreglo:* test que recorra `app.printRoutes()` y exija que cada ruta esté en una tabla `{ ruta → roles }`, y que pruebe cada rol contra cada ruta.
3. **El token del staff también vive en `localStorage`.** Ya hay cookie `HttpOnly`, pero el login devuelve el token en el cuerpo y el panel lo guarda y lo manda como Bearer. Un XSS en el panel podría robarlo. *Arreglo:* que el panel use solo la cookie (los rewrites `/v1/*` la hacen same-origin) y dejar Bearer únicamente para apps nativas.

### Media

4. **Sin tests en las webs.** Lo mínimo útil es un e2e con Playwright del camino crítico: escanear, pedir, aprobar, servir y cobrar.
5. **Rate limit en memoria por instancia.** Con más de una instancia de la API (Vercel serverless, por ejemplo) el límite se multiplica. Para el prototipo alcanza; para un bar real conviene un store en Redis (ya está en el stack).
6. **API en Vercel serverless:** el tiempo real (SSE/WebSocket) y el worker de BullMQ no encajan bien en funciones. Para el prototipo, la API va mejor en Render (ya configurado en `render.yaml`) y las dos webs en Vercel.
7. **No hay ADR** (`docs/adr/` está vacío). Las decisiones grandes (Fastify + Prisma, outbox, NFC SUN, cuenta por bar) están repartidas en `PLAN-MAESTRO.md`. Conviene extraerlas en 4 o 5 ADR cortos.

### Baja

8. Quedan flechas «→» en algunos enlaces de la carta y tarjetas de estadísticas iguales en el admin: son detalles del sistema visual, no rompen nada.
9. El aviso de turbo `no output files found for task @bar/db#build` ensucia la salida: falta declarar `outputs` en `turbo.json`.

## Plan para escalarlo (orden sugerido)

1. **Prototipo en la nube** (seguir `DEPLOY.md`): Neon → Upstash → API en Render → `cartabar` y `panelbar` en Vercel. Las cuentas y los secretos los cargás vos; yo dejo todo listo en el repo.
2. Base de test separada + test de matriz de permisos (contras 1 y 2).
3. Panel solo con cookie (contra 3).
4. Un e2e con Playwright del camino crítico, sumado al CI.
5. Rate limit con Redis antes del primer bar real.
