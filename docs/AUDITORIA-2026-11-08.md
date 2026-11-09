# Auditoría del 8 de noviembre de 2026: reglas de consorcio, pedidos, comprobante y estructura

## 1. Qué se tomó del proyecto `consorcio`

`consorcio` (FastAPI, 333 tests, 92 % de cobertura) tiene reglas maduras que en `bar` faltaban o estaban a medias. Se adoptaron estas:

| Regla en consorcio | Cómo quedó en bar |
| :-- | :-- |
| El número de recibo sale de un `UPDATE … RETURNING` atómico, más un `UNIQUE` | Comprobante N.º correlativo por local: `Venue.receiptSeq` + `UNIQUE (venueId, receiptNumber)` |
| Lo histórico se copia (el recibo guarda los datos del momento) | `TableSession.receipt` guarda la copia fija al cerrar la mesa |
| Recibo desglosado por concepto (RN-09) | Líneas agrupadas con precio unitario y subtotal, y lo que no se cobra aparte, con el motivo |
| "El primero que actúa gana": `UPDATE … WHERE estado` y contar filas | Aprobar o rechazar un pedido, y abrir, cerrar o cambiar el PIN de una mesa |
| Una carrera se prueba con pedidos simultáneos, y el test se rompe a propósito | Tests de pedidos, aprobaciones y cierres simultáneos; verificados sacando cada protección |
| Lo que el usuario acaba de hacer no puede desaparecer de la pantalla | Al cerrar la mesa, el mozo ve el comprobante recién emitido |
| La matriz de permisos es documentación que se ejecuta | Ya estaba (85 rutas); ahora son 88, con las del comprobante |
| Informe de calidad con métricas medidas | Este documento (sección 4) |

Quedan para más adelante, en este orden: forma de error con `id_error` para soporte, backups con restauración probada (Hito 2) y reloj inyectable para los tests de vencimientos.

## 2. Reglas nuevas de pedidos (`apps/api/src/modules/ordering/order-policy.ts`)

| Regla | Límite | Respuesta |
| :-- | :-- | :-- |
| Tamaño de un pedido | 40 unidades en total (20 por línea, 30 líneas) | 422 `ORDER_TOO_LARGE`: "Para algo más grande, llamá al mozo" |
| Pedidos sin confirmar por mesa | 3 a la vez | 429 `TOO_MANY_PENDING_ORDERS`: "Esperá a que el mozo los confirme" |
| Volumen por mesa | 120 unidades por hora desde la carta | 429 `SESSION_ORDER_LIMIT` |
| Pedido repetido sin querer | El mismo contenido en los últimos 3 minutos | 409 `DUPLICATE_ORDER`: la carta pregunta "¿Pedir otro igual?" y reenvía con `confirmDuplicate` |
| Ritmo por celular | 10 pedidos por minuto | 429 (rate limit) |
| Mismo pedido reenviado por mala red | Igual `Idempotency-Key` | Devuelve el mismo pedido (ya existía) |

**Dos celulares de la misma mesa al mismo tiempo:** el pedido bloquea la fila de la sesión (`SELECT … FOR UPDATE`) dentro de su transacción. Los pedidos de una mesa entran en fila, y el segundo ve al primero. Sin ese bloqueo, el test de Lucía y Martín falla siempre (se probó tres veces).

## 3. Comprobante de consumo

- **Mientras la mesa está abierta:** "Cuenta provisoria", calculada al vuelo (botón "Ver cuánto llevamos" en la carta y "🧾 Cuenta" en el panel del mozo).
- **Al cerrar:** "Comprobante N.º 000123", con el número correlativo del local y una copia fija. Si mañana cambian el nombre o el precio de un plato, el comprobante sigue igual (hay un test que lo verifica).
- **Contenido:** local y dirección, mesa, apertura y cierre, líneas agrupadas ("4 × Cerveza tirada IPA (Pinta)", $4.500 c/u), lo que no se cobra con su motivo ("Rechazado: se terminó el flan", "Sin confirmar por el mozo", "Mesa cerrada por inactividad"), total y la leyenda "No válido como factura".
- **Quién lo ve:** el comensal (`GET /v1/session/receipt`, también con la mesa cerrada), el mozo y la caja (`GET /v1/staff/sessions/:id/receipt`) y el cliente desde Mi cuenta (`GET /v1/customer/me/visits/:id/receipt`, solo de visitas donde pidió).
- **Un solo cierre:** el mozo y el cierre automático por abandono usan `closeSession`. Antes, el cierre por abandono no anulaba lo pendiente ni resolvía los llamados.

## 4. Estructura: GRASP y GoF aplicados

Medido con el compilador de TypeScript (líneas y complejidad ciclomática aproximada por función):

| Función | Antes | Después | Cómo |
| :-- | :-- | :-- | :-- |
| `joinTableSession` | 147 líneas, cc 7 + transacción de 83 líneas y cc 13 | 41 líneas, cc 1 | **Controller** fino + 6 funciones con una responsabilidad (`verifyNfcPresence`, `burnSunCounter`, `currentSession`, `startSession`, `assertMayJoin`, `issueGuestToken`) |
| `createOrder` | 116 líneas, map de 47 líneas y cc 17 | menos de 40 | **Controller** + `pricing.ts` (**Information Expert** del catálogo) + `order-policy.ts` (**Strategy**: una regla por objeto) |
| Acción de mesa del mozo | 70 líneas, 3 responsabilidades | 8 líneas | **Command**: mapa `SESSION_ACTIONS` sobre `lifecycle.ts` (**Information Expert** del estado de la mesa) |
| Aprobar / rechazar pedido | 2 copias de 20 líneas | 1 función `decidePendingOrder` | Sin duplicación; escritura condicional |
| Envío del carrito (carta) | `handleSendOrder` de 60 líneas | 13 líneas | `submitOrder.ts`: armado del pedido, idempotencia y mensajes de error fuera del componente |
| Comprobante | — | `buildReceipt` es una función pura | **Pure Fabrication**: se prueba sin base |

Funciones de 40 líneas o más en la API: **39 → 30**. Las que siguen (las `xxxRoutes` son solo registro de rutas y no cuentan):

| Pendiente | Tamaño | Propuesta |
| :-- | :-- | :-- |
| `provisionTenant` (alta de un bar) | 137 líneas | Partir en crear tenant, local, carta base, equipo y suscripción (Builder) |
| `POST /admin/campaigns` | 58 líneas, cc 10 | Mover audiencia y envío a un servicio de campañas |
| `POST /customer/auth/verify` | 56 líneas | Separar validación del código, alta de la cuenta y vínculo con la mesa |
| `assertTenantCanOpenSession` | 54 líneas | Separar el reinicio del período de la verificación de cuota |
| Panel: `AccountApp.tsx` (686 líneas), `DishEditor.tsx` (389), `superadmin/page.tsx` (366) | — | Un componente por pestaña o sección |

## 5. Pruebas con personas (`apps/api/test/escenarios-mesa.e2e.test.ts`)

Una mesa de amigos un viernes: Lucía abre por QR y el mozo abre la mesa. Martín se equivoca de PIN y después entra. Lucía y Martín mandan la misma ronda al mismo tiempo (entra una y al otro se le pregunta), y Martín confirma otra igual. Tomás intenta pedir 100 y después 60 unidades, y llega al tope de pedidos sin confirmar. El mozo y el dueño aprueban la misma ronda a la vez (va una sola vez a cocina). El mozo rechaza el flan. Lucía pide la cuenta y entiende qué se cobra. El mozo cierra la mesa, la caja ve el mismo comprobante y un mes después dice lo mismo. Además: dos mesas que cierran a la vez reciben números seguidos, y dos personas que cierran la misma mesa la cierran una sola vez.

**Recorrido en el navegador** (carta a 375 px y panel del mozo en escritorio): pedido enviado, aviso de pedido repetido con "Sí, pedir otro igual / No, era el mismo", cuenta provisoria, cierre con el comprobante a la vista y comprobante en el celular con la mesa cerrada.

**Error encontrado en el recorrido y corregido:** el mozo podía aprobar un pedido que había quedado pendiente en una mesa ya cerrada, y ese pedido no figuraba en ningún comprobante. Ahora responde 409 `SESSION_CLOSED`. Tiene un test `REGRESIÓN`, que falla sin el arreglo.

**Resultado:** 87 tests de la API en verde, tipos de las 3 apps sin errores.
