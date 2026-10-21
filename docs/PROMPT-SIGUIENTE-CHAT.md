# Prompt para continuar en un chat nuevo

Copiá todo lo que está entre las líneas y pegalo como primer mensaje del chat nuevo (con la carpeta `bar` abierta).

---

Sos el ingeniero a cargo del proyecto **bar**, en esta carpeta (monorepo pnpm: `apps/api` Fastify + Prisma, `apps/guest-web` carta Next.js 16, `apps/staff-web` panel Next.js 16, `packages/db`). Antes de tocar nada, leé en este orden:

1. `PLAN-MAESTRO.md`: arquitectura, convenciones (§9), API (§10), estado y pendientes (§11), problemas conocidos (§12).
2. `docs/SEGURIDAD.md`: reglas que no se rompen (el tenantId sale siempre del token, nunca `trustProxy: true`, archivos validados por contenido, URLs solo `https://`).
3. `docs/PLAN-APP-CLIENTE.md`: la próxima funcionalidad, con las **decisiones ya tomadas** en la sección 6.

**Objetivo de este chat:** implementar **"Mi cuenta" del cliente**, siguiendo `docs/PLAN-APP-CLIENTE.md`, en este orden y con un commit al terminar cada fase:

- **Fase A:** cuenta del cliente **por bar** (`Customer` con `tenantId`, `@@unique([tenantId, email])`), login por **email con código de 6 dígitos** (sin contraseña; en local el código se muestra en el log de la API mediante un adaptador de email "consola", con SMTP/Resend preparado para producción), vínculo con los pedidos (`Order.customerId` opcional), **historial** de visitas y pedidos con **"Pedir lo mismo"**, perfil con **exportar y borrar cuenta**. Ofrecer "Guardá tus puntos" al pedir la cuenta, sin obligar a nadie a registrarse para pedir.
- **Fase B:** fidelización **configurable por cada bar** en el admin: modo **sellos por visita** o **puntos por gasto**, premios, tarjeta con barra de progreso y **canje desde el panel del mozo**.
- **Fase C:** **promociones** cargadas por el dueño + **Web Push** (VAPID, sin servicios pagos) + **emails segmentados** ("no venís hace 30 días"), con opt-in explícito por bar, límite de 1 envío por semana por bar y baja en un toque (Ley 25.326). **Sin Apple Wallet.**

**Diseño de "Mi cuenta":** estilo app de billetera (como la imagen de referencia que voy a pegar): saludo con avatar, tarjeta oscura destacada con puntos/sellos, accesos rápidos en círculos, tarjeta "próximo premio" con barra de progreso, lista de actividad reciente y menú inferior oscuro (Inicio, Historial, Promos, Perfil). **Colores de ZainSoft** (de `../Enterprice-portafolio/src/app/globals.css`): brand `#f05a28` (botones circulares, chip activo, progreso, ítem activo), brand-dark `#c8431a`, ink `#0f1115` (tarjeta y menú oscuros), paper `#faf8f5` (fondo), blanco para las tarjetas. Mobile-first, botones de 44 px o más.

**Reglas de trabajo:**
- Todo tiene que **funcionar en local** con `INICIAR-MVP.cmd` (no vamos a deployar todavía).
- Cada fase: migración de Prisma (si `migrate dev` no anda por ser no interactivo, usar `prisma migrate diff --from-schema-datasource ... --script`), tests e2e en `apps/api/test`, `tsc --noEmit` de las apps tocadas, prueba en el navegador como celular (375×812) y **commit**. No pushear sin preguntarme.
- Reutilizá lo que ya existe: `requireAdmin`/`requireGuest`, `saveMedia`, `useToasts`/`Modal`/`Btn` de `staff-web/src/components/ui.tsx`, `uuid()` de `guest-web/src/lib/storage.ts` (nunca `crypto.randomUUID()` directo: en HTTP por la red local no existe).
- Cuidado al editar con `node -e` o `sed` desde Bash: los `\` de las regex se pierden. Para regex usá la herramienta Edit.
- Al terminar: actualizá `PLAN-MAESTRO.md` (§7, §10, §11, §13) y `docs/SEGURIDAD.md` con lo nuevo.

**Pendientes chicos que podés resolver de paso:**
- Sacar el HTTPS local con certificado (Caddy) del arranque: decidí no instalar nada en el celular. Para probar con cámara se usa el túnel con datos móviles.
- La carta todavía no usa el `layoutMode` (Clásico/Reels/Lista) que se elige en Admin → Local.

Arrancá leyendo los tres documentos y contame el plan de la Fase A en pocas líneas antes de escribir código.

---
