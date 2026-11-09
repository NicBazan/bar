# Plan de crecimiento: avisos automáticos, chatbot, panel de plataforma, temas y nube

Revisión del 9 de noviembre de 2026. Complementa el [plan maestro](../PLAN-MAESTRO.md): este documento baja a detalle lo pedido el 09/11 y propone cómo encaja en los hitos.

## 1. Avisos automáticos para que los clientes vuelvan

**Objetivo:** que el bar recupere clientes sin tener que acordarse de mandar nada.

| Aviso | Cuándo sale | Ejemplo | Estado |
| :-- | :-- | :-- | :-- |
| **Te extrañamos** | El cliente no viene hace N días (el bar elige 21, 30, 45, 60 o 90) | «Hace un mes que no te vemos. Esta semana, postre de regalo con tu pedido.» | ✅ Hecho (09/11) |
| **Gracias por venir** | Al día siguiente de la visita | «Gracias por venir ayer. ¿Nos dejás tu opinión?» + link de reseñas de Google | ✅ Hecho (09/11) |
| **Te falta poco para el premio** | Le falta 1 sello o pocos puntos | «Te falta 1 sello para la cerveza gratis.» | Siguiente bloque |
| **Cumpleaños** | El día del cumpleaños (dato opcional en Mi cuenta) | «Feliz cumple: el postre corre por nuestra cuenta.» | Siguiente bloque |

**Canales, en orden de costo:**
1. **Web Push** (gratis, ya funciona): llega al celular como una notificación.
2. **Email** (Resend, gratis hasta 3.000 por mes): para quien no activó las notificaciones.
3. **WhatsApp**, a futuro, a través de Gestion-bots. Meta cobra cada mensaje de plantilla, así que conviene ofrecerlo en un plan superior.

**Reglas que no se rompen:**
- Solo a quien aceptó avisos de ese bar.
- Como máximo 1 aviso automático por cliente cada 7 días, sumando todos los tipos.
- Solo entre las 10 y las 21, hora del local.
- Baja en un toque (Ley 25.326).
- Cada aviso queda registrado una sola vez por cliente y motivo (restricción `UNIQUE`), así nunca se manda dos veces.

**Motor:** la API tiene `runAutomations()`, que se dispara de tres formas:
- En la PC y en Render, cada 30 minutos desde el mismo proceso.
- En Vercel, con Vercel Cron, que llama a `POST /v1/internal/automations/run` con un secreto (`CRON_SECRET`).
- A mano, desde el super admin.

**Cómo se mide:** porcentaje de clientes que vuelven dentro de los 14 días posteriores al aviso. Se muestra en el admin del bar y en el super admin.

## 2. Chatbot: enlace con Gestion-bots

Gestion-bots (FastAPI) atiende WhatsApp, Telegram y Facebook por negocio. Ya tiene productos, una base de conocimiento, pedidos y webhooks firmados con HMAC SHA-256 (como Meta). El enlace se diseña para que ninguno de los dos sistemas dependa del otro para funcionar.

**Lo que agrega `bar` (lado servidor):**
1. **Claves de integración por bar.** El dueño o el super admin genera una clave, que se muestra una sola vez y se guarda con hash. Tiene permisos acotados (por ejemplo, solo lectura) y se puede revocar.
2. **API de integración** (`/v1/integrations/*`, header `X-Api-Key`). Expone la carta vigente con precios y agotados, las promos, horarios, dirección, link de la carta y de reseñas, y el estado del programa de puntos de un cliente (por email, con su consentimiento).
3. **Avisos de eventos firmados** (webhooks salientes, `X-Bar-Signature-256: sha256=…`, el mismo esquema que Gestion-bots ya valida para Meta). Eventos: cambió la carta, nueva promo, mesa cerrada, cliente nuevo con consentimiento. Con reintentos desde el outbox, que ya existe.

**Lo que agrega Gestion-bots:** un "conector Bar" por negocio, con la URL de la API, la clave y el secreto de firma. Sincroniza la carta como productos y la información del local como conocimiento, y responde «¿qué hay de comer?», «¿tienen promo?» o «mandame la carta» con el link real.

**Más adelante:**
- Reservas desde WhatsApp.
- Avisos automáticos por WhatsApp (sección 1), con plantillas aprobadas por Meta.

## 3. Panel de plataforma (super admin = ZainSoft)

El super admin es "nosotros". Tiene que mostrar todo el negocio en una pantalla y tener la marca ZainSoft.

| Sección | Qué muestra | Estado |
| :-- | :-- | :-- |
| Resumen | Bares activos, mesas y pedidos del mes, ingresos recurrentes estimados, bares en riesgo (sin uso en 14 días) | Ampliar lo existente |
| Bares | Alta, plan, cuota, suspensión, equipo, contraseñas temporales | Existe |
| Avisos | Envíos automáticos y campañas por bar, entregas, bajas, tasa de regreso | Nuevo (con la sección 1) |
| Integraciones | Claves y webhooks por bar, últimos errores de entrega | Nuevo (con la sección 2) |
| Salud del sistema | Eventos del outbox atrasados, errores 5xx, último backup, versión desplegada | Nuevo |
| Auditoría | Registro global | Existe |
| Soporte | "Ver como el bar" en modo solo lectura, con registro en auditoría | Nuevo (necesita su propio análisis de seguridad) |

**Marca:** logo de ZainSoft (`logo.png` en claro y `logo-dark.png` en oscuro) y acento de ZainSoft (`#F05A28`), solo en el super admin. Los paneles del bar siguen con «Naranja señal», así el dueño ve su herramienta y nosotros la nuestra.

## 4. Tema claro y oscuro en todas las pantallas

- Botón de tema en el encabezado de cada panel, en la carta y en Mi cuenta: **Automático** (sigue al sistema), **Claro** u **Oscuro**. Se recuerda por dispositivo.
- Se implementa sobre los tokens que ya existen: el modo oscuro redefine las variables (`--color-paper`, `--color-surface`, `--color-cream`…), así que los componentes no cambian.
- La paleta oscura sale de la base de conocimientos (`09-diseno-visual/tokens.css`): grafito `#101216` y `#1A1D23`, tinta `#E6E8EB`, acento `#FF7A2F`. El texto sobre el acento sigue siendo oscuro (6,8:1).
- Un script mínimo en el `<head>` aplica el tema antes de pintar, para que no haya parpadeo.

## 5. Auditoría del 09/11

**Seguridad, resuelto hoy:**
- El panel ya no guarda el token en el navegador: usa solo la cookie `HttpOnly`.
- Las sesiones del staff se pueden revocar: con un reseteo de contraseña, una baja o "cerrar todas mis sesiones". El test encontró y se corrigió que un token emitido en el mismo segundo que la revocación sobrevivía.
- Las cookies `Secure` ahora son configurables (el MVP corre por HTTP en la red de la casa).
- En producción, la API no arranca sin un lugar persistente para las fotos.
- El comprobante muestra la hora del local.

**Seguridad, pendiente (por prioridad):**

| # | Riesgo | Arreglo |
| --: | :-- | :-- |
| 1 | Super admin sin segundo factor: una contraseña filtrada da acceso a todos los bares | TOTP (app autenticadora) obligatorio para `SUPER_ADMIN` |
| 2 | "Mi cuenta" del cliente: token de 90 días sin forma de cerrarlo desde otro celular | `tokensValidAfter` también en `Customer` + "Cerrar sesión en todos lados" |
| 3 | Alta de bares sin captcha (tope global de 30 por hora) | Cloudflare Turnstile en el registro |
| 4 | Rate limit en memoria: con varias instancias se multiplica | Store en Redis (Upstash) |
| 5 | Sin registro centralizado de errores | Sentry, plan gratuito |
| 6 | Claves de integración (sección 2) | Hash + prefijo visible, permisos mínimos, rotación y registro de uso desde el primer día |

**Problemas que van a aparecer con el crecimiento:**

| Cuándo | Problema | Qué hacer |
| :-- | :-- | :-- |
| ~20 bares en hora pico | El polling cada 3 a 4 s por celular multiplica las consultas (50 mesas × 4 celulares ≈ 60 consultas por segundo por bar) | SSE sobre el outbox (Hito 6) |
| Desde el primer bar real | Mesas que el mozo no cierra quedan abiertas hasta el próximo escaneo | Barrido automático de mesas abandonadas en el mismo motor de la sección 1 |
| Con Vercel o varias instancias | Conexiones a Postgres agotadas | Pooler de Neon (`-pooler` en la URL) y `connection_limit` bajo |
| Con miles de pedidos por día | `OutboxEvent` y los pedidos crecen sin límite | Purga del outbox (ya existe, a las 24 h) e índices por fecha; los pedidos se archivan, nunca se borran |
| Al cambiar el plan de un bar | El cobro todavía no existe | Hito 4 (Mercado Pago suscripciones) |
| Funciones largas restantes | `provisionTenant` (137 líneas), `POST /admin/campaigns` | Se parten en este bloque y en el siguiente |

## 6. Nube para crecer

**Principio:** la región importa más que el proveedor. Los usuarios están en Argentina: la base, la API y las funciones tienen que estar en **São Paulo** (AWS `sa-east-1`, `gru`). Render no tiene región en Sudamérica: sirve para el piloto, pero cada consulta suma ~150 ms de ida y vuelta.

| Etapa | Bares | Carta y paneles | API y motor de avisos | Base de datos | Otros | Costo aprox. por mes* |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| **1. Piloto** | 1 a 10 | Vercel Pro (funciones en `gru1`) | Render Starter (Oregon) | Neon Launch, región São Paulo | Upstash gratis, Cloudinary gratis, Resend gratis, Sentry gratis | USD 40–60 |
| **2. Crecimiento** | 10 a 150 | Vercel Pro | **Fly.io en `gru`**, 2 máquinas (alta disponibilidad, sin cold start) + 1 worker | Neon Scale, autoescalado y réplica de lectura | Upstash pago por uso (rate limit y colas), Cloudinary Plus, Resend Pro, Better Stack (monitoreo y alertas) | USD 250–500 |
| **3. Escala** | 150 a 2.000+ | Vercel Pro o Enterprise | **AWS `sa-east-1`**: ECS Fargate con autoescalado, ALB y SQS para avisos | RDS o Aurora PostgreSQL Multi-AZ + réplicas | ElastiCache, CloudFront, SES (emails baratos), observabilidad completa | USD 1.500–4.000 |

\* Valores de referencia de noviembre de 2026: se confirman al contratar. Con los planes de la sección 3 del plan maestro (USD 25–40 por bar), la etapa 2 se paga con unos 15 bares y la 3 con unos 100.

**Cuándo saltar de etapa** (lo primero que pase):
- **De 1 a 2:** más de 10 bares pagando, o una sola vez que el cold start o la latencia molestaron en el salón, o la base supera el plan gratuito.
- **De 2 a 3:** más de 150 bares, más de 2.000 mesas abiertas a la vez en hora pico, o un cliente grande (cadena) que pide SLA y contrato.

**Qué cambia en el código en cada etapa:**
- **Etapa 2:** SSE en lugar de polling, rate limit en Redis, pooler de Neon, motor de avisos en un proceso aparte, backups verificados.
- **Etapa 3:** colas reales (SQS) para avisos y webhooks, réplicas de lectura para reportes y particionado de pedidos por mes.

**Lo que no hace falta en ninguna etapa:** microservicios, Kubernetes ni multi-región activa. Un monolito modular bien desplegado en una región alcanza hasta miles de bares.

## 7. Orden de trabajo propuesto

1. ✅ **Hecho el 09/11:** avisos automáticos (Te extrañamos y Gracias por venir) con su pantalla en el admin y test con personas, tema claro y oscuro en todas las pantallas, super admin con la marca ZainSoft, panel solo con cookie y sesiones del staff revocables.
2. **Siguiente:** API de integración y webhooks para Gestion-bots, sección de avisos e integraciones en el super admin, y 2FA del super admin.
3. **Después:** "Te falta poco" y "Cumpleaños", barrido de mesas abandonadas, salud del sistema y SSE (antes de los 20 bares).
4. **Con el piloto en marcha:** etapa 2 de la nube cuando se cumpla el criterio.
