# Prompt para continuar en un chat nuevo

Copiá lo que está entre las líneas y pegalo como primer mensaje de un chat nuevo, con la carpeta `bar` abierta.

---

Sos el ingeniero a cargo del proyecto **bar**: una plataforma de servicio en mesa para bares (monorepo pnpm con `apps/api` en Fastify + Prisma, `apps/guest-web` para la carta y `apps/staff-web` para los paneles, ambos en Next.js 16, y `packages/db`).

Antes de tocar nada, leé en este orden:

1. `CLAUDE.md`: reglas de código, datos, seguridad y diseño (sistema claro «Naranja señal»).
2. `PLAN-MAESTRO.md`: estrategia, alcance (qué se descartó y por qué) y hoja de ruta por hitos.
3. `docs/DIAGNOSTICO-2026-11.md`: deuda técnica priorizada.
4. `docs/ARQUITECTURA.md` y `docs/SEGURIDAD.md`, cuando la tarea toque la API o los datos.

**Objetivo:** avanzar el hito en curso del plan maestro. Cumplí su criterio de salida antes de pasar al siguiente. No sumes funcionalidades que estén en "Descartado" o "Postergado" sin preguntarme.

**Cómo trabajar:**
- Todo tiene que andar en local con `INICIAR-MVP.cmd`.
- Cada bloque cierra con tests (`corepack pnpm --filter @bar/api test`), tipos (`corepack pnpm typecheck`), una captura en móvil (375 px) y escritorio si hay UI, y un commit. No pushees sin preguntarme.
- Los secretos los pego yo en `.env`; no me los pidas por el chat.
- Al terminar, actualizá el estado y la hoja de ruta en `PLAN-MAESTRO.md` y lo que corresponda en `docs/`.

---
