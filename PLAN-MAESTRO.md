# Plan maestro

**Plataforma de servicio en mesa para bares y restaurantes.** El cliente escanea un QR o toca un NFC, ve la carta (con 3D y realidad aumentada), pide y llama al mozo sin instalar nada. El local opera el salón, la cocina y la fidelización desde un solo panel.

> Documento de estrategia y hoja de ruta. Última revisión: **8 de noviembre de 2026**.
> **Plan de crecimiento (09/11):** avisos automáticos, chatbot con Gestion-bots, panel de plataforma ZainSoft, temas y nube por etapas en [docs/PLAN-CRECIMIENTO.md](docs/PLAN-CRECIMIENTO.md).
>
> Referencias: [Arquitectura](docs/ARQUITECTURA.md) · [Seguridad](docs/SEGURIDAD.md) · [Desarrollo local](docs/DESARROLLO-LOCAL.md) · [Deploy](DEPLOY.md) · [Diagnóstico técnico](docs/DIAGNOSTICO-2026-11.md) · Repo: https://github.com/NicBazan/bar

---

## 1. Resumen ejecutivo

- **Producto:** el MVP está completo y funciona de punta a punta en local. Incluye carta digital con 3D/AR, pedidos con aprobación del mozo, KDS por estación, cuenta del cliente con fidelización, promociones y avisos, admin del bar y super admin multi-local. Tiene 87 tests de API en verde, CI y una auditoría de seguridad hecha.
- **Lo que falta para vender:** no está en la nube, no cobra y no tiene ningún local real usándolo. Ninguna de las tres cosas es un problema técnico grande.
- **Decisión de esta revisión:** se dejan de lado las líneas caras y de retorno incierto (App Clip, fotogrametría propia, IA de facturas, infraestructura de escala). El foco pasa a **nube → piloto con bares reales → cobro**.

## 2. Propuesta de valor

| Para quién | Problema | Qué resolvemos |
| :-- | :-- | :-- |
| **Dueño del bar** | Mozos saturados en horas pico, pedidos mal tomados, clientes que no vuelven | Pedidos directos a cocina con control del mozo, carta que se edita en segundos (agotados, precios), base de clientes propia con fidelización y avisos |
| **Mozo** | Ir y venir para tomar pedidos y traer la cuenta | Aprueba pedidos y recibe llamados desde el celular; solo lleva lo que está listo |
| **Cocina** | Comandas en papel, pedidos perdidos | KDS por estación con tiempos y sonido |
| **Comensal** | Esperar la carta, esperar al mozo, esperar la cuenta | Carta al instante, pide cuando quiere, ve el estado del pedido; suma puntos sin descargar una app |

**Diferencial frente a cartas QR comunes:** pedido con aprobación del mozo (sin pedidos falsos), NFC con prueba de presencia física, fidelización por bar sin app, y 3D/AR como gancho de venta en platos destacados.

## 3. Modelo de negocio

> Precios a validar con los primeros locales. Son hipótesis, no compromisos.

| Plan | Para | Incluye | Precio de referencia |
| :-- | :-- | :-- | :-- |
| **Gratis** | Probar sin riesgo | Carta, pedidos, mozo y cocina; hasta 50 mesas abiertas por mes | $0 |
| **Profesional** | Un local en operación | Mesas ilimitadas, Mi cuenta y fidelización, promociones y avisos, 3D/AR, reportes | USD 25–40 por mes por local |
| **Multi-local** | Cadenas | Todo lo anterior + varias sucursales con una carta base | A medida |

- **Ingreso recurrente:** suscripción mensual cobrada con Mercado Pago (suscripciones). Hoy el límite del plan Gratis ya está implementado (`billing.guard.ts`); falta el cobro.
- **Ingreso adicional (Hito 5):** pago en la mesa con Mercado Pago, que acorta la rotación de mesas y habilita una comisión por transacción.
- **Servicio opcional:** carga inicial de la carta y modelos 3D de platos destacados, con un proveedor externo y cobrado aparte.

### Costo fijo estimado del piloto (valores aproximados, verificar al contratar)

| Servicio | Uso | Costo |
| :-- | :-- | :-- |
| Vercel | Carta y paneles | Pro, USD 20 por mes (el plan Hobby no permite uso comercial) |
| Render | API + worker | Starter, USD 7 por mes por servicio (el gratuito se duerme y tarda unos 50 s en despertar: inaceptable en un salón) |
| Neon | Postgres | Gratis hasta 0,5 GB, con backups |
| Upstash | Redis | Gratis en el volumen del piloto |
| Cloudinary | Fotos, logos y 3D | Gratis en el volumen del piloto |
| Resend | Emails de Mi cuenta | Gratis hasta 3.000 por mes |
| Dominio | `carta.<marca>.com` | Unos USD 15 por año |

**Total: unos USD 35–45 por mes.** Con dos locales en plan Profesional se cubre el costo fijo.

## 4. Estado actual

| Área | Estado |
| :-- | :-- |
| Comensal: QR/NFC → carta (Clásico, Reels o Lista) → pedido → estado en vivo, mozo, cuenta, Wi-Fi, reseñas, promos | Listo |
| Mi cuenta: código por email, historial, "Pedir lo mismo", sellos o puntos, avisos push y email, exportar y borrar (Ley 25.326) | Listo |
| Salón: mesas, PIN, pedidos, llamados, canje de premios | Listo |
| Cocina: KDS por estación con tiempos y sonido | Listo |
| Admin del bar: carta, agotados, fotos y 3D, mesas y QR, NFC, equipo, local, fidelización, promociones, avisos | Listo |
| Super admin: bares, planes, cuota, suspensión, altas, auditoría | Listo |
| Diseño: sistema claro y minimalista, IBM Plex Sans, un solo acento, AA | Listo |
| Calidad: 87 tests de API (matriz de permisos y escenarios con personas), tipos en 7 paquetes, CI en GitHub Actions | Listo |
| Seguridad: auditoría de 24 puntos, NFC SUN, rate limit, CSP, secretos que fallan cerrado | Listo, con pendientes en el Hito 2 |
| Nube, dominio y HTTPS fijo | **Pendiente (Hito 1)** |
| Cobro de suscripciones | **Pendiente (Hito 4)** |
| Locales reales usándolo | **Pendiente (Hito 3)** |

## 5. Auditoría del plan anterior: qué se recorta y por qué

El plan original apuntaba a un "sistema operativo gastronómico" completo. Para un equipo chico, eso dispersa el esfuerzo antes de tener el primer cliente. En el repositorio había 21 carpetas vacías reservadas para líneas que no existen; se eliminaron.

### Descartado

| Línea | Motivo |
| :-- | :-- |
| **App Clip de iOS** (Wi-Fi nativo, push efímera) | USD 99 por año de cuenta de Apple, aprobación incierta del permiso de Wi-Fi dentro de un App Clip y una segunda base de código. El Wi-Fi ya se resuelve con "Copiar contraseña" y el QR de Wi-Fi impreso; los avisos, con Web Push |
| **Pipeline 3D propio** (fotogrametría, Gaussian Splatting, captura autoservicio) | Requiere equipo, horas de QA por plato y no es lo que decide la compra. El 3D queda como gancho en pocos platos, cargado por el bar o por un proveedor |
| **Facturas de proveedores con IA, inventario y food cost** | Es otro producto, compite con ERPs y sistemas de gestión ya instalados |
| **Facturación electrónica propia (ARCA)** | Se delega en el proveedor de pagos o en el sistema de gestión del local |
| **Infraestructura de escala** (Centrifugo, Temporal, ClickHouse, particionado) | Resuelve problemas de miles de locales. Hoy cuesta mantenimiento sin beneficio |
| **Apple/Google Wallet** | Decidido el 21/10: costo de Apple y poco uso. La tarjeta vive en Mi cuenta |
| **Integraciones con POS, impresoras y QR e-ink** | Solo si un cliente pagante lo pide y lo financia |

### Postergado, con condición para retomarlo

| Línea | Se retoma cuando |
| :-- | :-- |
| **Chef IA** (recomendaciones con la carta) | Haya al menos 10 locales en plan Profesional y se mida que los comensales lo usan. Se vende como función del plan, con costo por consulta acotado |
| **Reservas** | Un piloto lo pida. Hay muchas soluciones gratuitas y no es el núcleo |
| **Feedback con fotos** | Después del piloto, si los dueños lo valoran por encima de las reseñas de Google |
| **Más juegos de espera** | Se mida que el Sudoku se usa |

## 6. Hoja de ruta

Cada hito tiene un criterio de salida medible. No se empieza el siguiente sin cumplir el anterior, salvo el Hito 2, que corre en paralelo.

### Hito 1. Prototipo en la nube (1 semana)
- Neon, Upstash, Render (API + worker), Vercel (`carta` y `panel`) y Cloudinary, siguiendo [DEPLOY.md](DEPLOY.md).
- Dominio propio y QR generados con ese dominio.
- Super admin creado con `create-superadmin`; sin usuarios demo en producción.
- **Salida:** links HTTPS fijos, prueba de humo verde contra producción y una demo que abre desde cualquier celular.

### Hito 2. Base profesional (en paralelo, 2 semanas)
- ~~Base de datos de test separada de la de desarrollo~~ (hecho: `bar_test`, recreada en cada corrida).
- ~~Test de matriz de permisos~~ (hecho: 85 rutas clasificadas; una ruta nueva sin clasificar rompe el CI).
- Panel del staff solo con cookie `HttpOnly` (sin token en `localStorage`).
- Prueba e2e del camino crítico con Playwright en el CI.
- Monitoreo de errores (Sentry, plan gratuito) y backups verificados de Neon.
- **Salida:** CI en verde con e2e; un error en producción llega como alerta.

### Hito 3. Piloto con 1 a 3 locales (4 a 6 semanas)
- Alta asistida: carta cargada, QR impresos y una capacitación de 30 minutos al equipo.
- Medición semanal: porcentaje de mesas que piden por QR, tiempo de pedido a servido, ticket promedio y altas en Mi cuenta.
- Ajustes de producto según lo que pidan mozos y dueños.
- **Salida:** al menos un local usándolo todos los días durante 4 semanas y dispuesto a pagar.

### Hito 4. Cobro (2 semanas)
- Suscripción del plan Profesional con Mercado Pago; alta, baja y vencimiento automáticos sobre el modelo `Subscription` existente.
- Página comercial con planes y un formulario de contacto.
- **Salida:** primer cobro recurrente real.

### Hito 5. Pago en la mesa y cierre de caja (3 a 4 semanas)
- Pagar la cuenta desde la carta con Mercado Pago, división de cuenta y propina.
- Cierre de turno simple en el panel (cobrado por medio de pago).
- **Salida:** mesas que se cierran sin que el mozo lleve la cuenta.

### Hito 6. Escala (según demanda)
- Tiempo real con SSE sobre el outbox (reemplaza el polling).
- Rate limit compartido en Redis, RLS en Postgres, 2FA para el super admin y captcha en el registro.
- Multi-sucursal con carta base y reportes comparativos.
- Compresión 3D automática en el worker.

## 7. Métricas que guían las decisiones

| Métrica | Por qué importa | Objetivo del piloto |
| :-- | :-- | :-- |
| Mesas que piden por QR / mesas abiertas | Adopción real en el salón | Más del 40 % |
| Tiempo de pedido aprobado a servido | Valor operativo para el dueño | Medirlo y bajarlo semana a semana |
| Altas en Mi cuenta / mesas cerradas | Base de clientes propia del bar | Más del 10 % |
| Clientes que vuelven en 30 días | Retorno de la fidelización | Medirlo |
| Locales activos que pagan | Viabilidad | 2 al cierre del Hito 4 |

## 8. Riesgos

| Riesgo | Impacto | Mitigación |
| :-- | :-- | :-- |
| El salón no adopta el pedido por QR | Alto | Piloto acompañado; el mozo sigue tomando pedidos a mano cuando hace falta |
| Conectividad del local | Medio | Carta liviana y reintentos idempotentes; a futuro, carta disponible sin conexión |
| Un incidente de seguridad con datos de clientes | Alto | Hito 2, auditoría vigente, datos mínimos y borrado a pedido |
| Costos de nube que crecen con el uso | Bajo | Servicios con plan gratuito y precios por uso; revisar al pasar los 10 locales |
| Dependencia de una sola persona | Medio | CLAUDE.md, documentación al día, CI y tests |

## 9. Cómo se trabaja

- Reglas de código, datos, seguridad y diseño: [CLAUDE.md](CLAUDE.md), alineado con la base de conocimiento del portafolio.
- Cada bloque de trabajo cierra con tests, tipos y build en verde, y con la documentación al día.
- Las decisiones con alternativas se registran como ADR en `docs/adr/`.
- El historial de cambios es el de git (`git log`). Este documento solo registra estrategia, alcance y estado.
