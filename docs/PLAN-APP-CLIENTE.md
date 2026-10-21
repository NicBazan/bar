# 📱 Plan: "Mi cuenta" del cliente (historial, fidelización y notificaciones)

> Estado: **idea evaluada, sin implementar.** Para retomar en un chat nuevo. Contexto del proyecto: [PLAN-MAESTRO.md](../PLAN-MAESTRO.md).

## 1. La idea
Una sección para el **cliente del bar** (no para el staff), con el estilo de la imagen de referencia (app tipo billetera: saludo, tarjeta destacada oscura, accesos rápidos en círculos, barra de progreso, "actividad reciente" y menú inferior):

- **Historial:** qué pidió, cuándo y dónde.
- **Fidelización:** sellos o puntos, con la barra de progreso hacia el próximo premio.
- **Promociones** del bar.
- **Volver al bar:** recordatorios y avisos al estar cerca.

## 2. ¿Se puede? (respuesta corta: sí, casi todo, con dos matices)

| Pedido | ¿Se puede como web, sin instalar? | Cómo |
| :-- | :-- | :-- |
| Registro de lo que comió/pidió | ✅ Sí | Ya se guarda cada pedido; falta **identificar al cliente** entre visitas (hoy es anónimo por mesa) |
| Puntos / sellos con barra de progreso | ✅ Sí | Nuevo módulo de fidelización (estaba en la Fase 2 del plan) |
| Promociones dentro de la app | ✅ Sí | Las carga el dueño en el admin; se ven en "Mi cuenta" y en la carta |
| Avisos al celular (promos, "te extrañamos") | 🟡 Sí, con condiciones | **Web Push**: en Android anda desde el navegador; en **iPhone solo si el cliente "agrega a la pantalla de inicio"** (iOS 16.4+). Alternativa sin condiciones: **WhatsApp o email** |
| **Avisar al estar cerca del bar** | 🟡 Limitado en web | Una página web **no puede** seguir la ubicación con el celular bloqueado. Opciones reales: **pase de Apple Wallet** con la ubicación del bar (aparece solo en la pantalla bloqueada al acercarse, sin instalar app: es "agregar a Wallet"); en Android, Google Wallet sin aviso por cercanía confiable. Geofencing de verdad = **app nativa** (Fase 3+) |

**Conclusión:** la idea es buena y viable. Recomiendo **cambiar "avisar al estar cerca" por "pase de Wallet + push/WhatsApp segmentado"**: logra lo mismo (que vuelvan) sin app nativa.

## 3. Diseño (adaptado a ZainSoft)

Colores de ZainSoft (de `Enterprice-portafolio/src/app/globals.css`):

| Token | Color | Uso (equivale al verde lima de la referencia) |
| :-- | :-- | :-- |
| `brand` | `#f05a28` | Botones circulares, chip activo, barra de progreso, ítem activo del menú |
| `brand-dark` | `#c8431a` | Presionado / hover |
| `ink` | `#0f1115` | Tarjeta de saldo/puntos y menú inferior oscuros |
| `paper` | `#faf8f5` | Fondo claro de la app |
| blanco | `#ffffff` | Tarjetas de actividad |

Pantallas (estructura de la referencia):

1. **Inicio:** "Hola de nuevo, {nombre}" + avatar · tarjeta oscura con **puntos / sellos** (y "+X este mes") · accesos circulares: *Mi QR*, *Promos*, *Reservar*, *Wallet* · tarjeta "Próximo premio: 7/10 sellos" con barra naranja · **Actividad reciente**: visitas y pedidos (bar, fecha, total, "+15 pts").
2. **Historial:** cada visita con su detalle y **"Pedir lo mismo"** (si está en ese bar).
3. **Promos:** las del bar donde está o de los que visitó.
4. **Perfil:** datos, permisos de notificación, borrar cuenta / exportar datos.
- Menú inferior oscuro: Inicio · Historial · Promos · Perfil (como la variante 1 de la imagen).

## 4. Cómo funciona por dentro

### Identidad sin fricción (no instalar, no contraseña)
- El cliente sigue entrando a la mesa **anónimo**, como hoy. Al terminar (o al pedir la cuenta) aparece **"Guardá tus puntos"**: **email o teléfono → código de 6 dígitos** (magic code). Sin contraseña.
- Se vincula el `GuestDevice` actual y los pedidos de esa sesión a un **`Customer`**. Las próximas visitas desde ese celular se reconocen solas (cookie de larga duración + "¿Sos {nombre}?").
- El modelo ya tenía previsto `GUEST_PROFILE` / `LOYALTY_CARD` / `STAMP_EVENT` en el diagrama del plan maestro.

### Modelo de datos nuevo (borrador)
- `Customer` (global de la plataforma: email/teléfono verificado, nombre, consentimientos con fecha).
- `CustomerVenue` (relación cliente ↔ bar: primera/última visita, total, opt-in de promos **por bar**).
- `LoyaltyProgram` (por bar: "1 sello por visita con pedido", "premio a los 10") y `StampEvent`.
- `Promotion` (por bar: título, vigencia, segmento: todos / no vienen hace 30 días / cumpleaños…).
- `PushSubscription` (Web Push) y `WalletPass`.
- Los pedidos ya existen: se agrega `Order.customerId` (opcional).

### Notificaciones
- **Web Push** (VAPID, sin servicios pagos) para promos y "tu pedido está listo".
- **Campañas del dueño** desde el admin: "mandar promo a clientes que no vienen hace 30 días". Con límite de frecuencia (máximo 1 por semana por bar).
- **Wallet:** pase de fidelidad de Apple Wallet con `locations` (lat/long del bar) → aparece en la pantalla bloqueada al acercarse. Requiere cuenta de Apple Developer (USD 99/año) para firmar los pases.
- **WhatsApp** (opcional, pago por mensaje vía API oficial) para quien no acepte push.

### Privacidad (obligatorio, Ley 25.326 de Datos Personales)
- **Opt-in explícito y separado** para promos y para ubicación. Nunca preseleccionado.
- Cada bar ve **solo sus clientes** (los que aceptaron ese bar); la plataforma no comparte datos entre bares.
- Exportar y borrar la cuenta desde el perfil. Desuscribirse en un toque desde cada aviso.
- Guardar el mínimo: no se guarda la ubicación del cliente (el aviso por cercanía lo resuelve Wallet en el propio celular).

## 5. Fases propuestas

| Fase | Entregable | Esfuerzo aprox. |
| :-- | :-- | :-- |
| A | "Mi cuenta" con código por email, historial de visitas y pedidos, "Pedir lo mismo", diseño ZainSoft | 1 sesión larga |
| B | Fidelización: sellos/puntos configurables por bar, tarjeta con progreso, canje en caja/mozo | 1 sesión |
| C | Promociones + Web Push + campañas segmentadas desde el admin | 1 sesión |
| D | Pase de Apple/Google Wallet (requiere cuenta Apple Developer) | 1 sesión + trámite de cuentas |
| E | App nativa con geofencing (solo si A–D no alcanzan) | proyecto aparte |

## 6. Decisiones a tomar antes de arrancar
1. ¿Identificar por **email** (gratis) o **teléfono/WhatsApp** (más natural en Argentina, pero los SMS/WhatsApp cuestan)?
2. ¿Sellos (simple: "10 visitas = postre gratis") o puntos ($ gastado → puntos)?
3. ¿La cuenta es **por bar** (cada bar con su "app") o **una sola cuenta** que sirve en todos los bares de la plataforma? (Recomendado: una sola cuenta, con los datos separados por bar.)
4. ¿Se paga la cuenta de Apple Developer para Wallet?
