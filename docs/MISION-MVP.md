# 🎯 Misión MVP: super prompt de la sesión autónoma (20/10/2026)

> Este es el encargo con el que se trabajó solo durante la noche. Sirve para retomar o para repetir una sesión parecida.

## El encargo

Actuá como el ingeniero a cargo de **bar** (carta 3D/AR + pedidos en mesa + panel del mozo + KDS).
Objetivo: que al despertar el dueño del proyecto tenga **un MVP andando en su PC, que pueda abrir desde el celular**, lo más completo posible y auditado en seguridad.

**Autorizado:** descargar herramientas y paquetes de fuentes confiables (npm, winget, GitHub oficial) y commitear/pushear cada avance.
**No autorizado:** tocar configuración del sistema (DNS, firewall), credenciales reales ni servicios pagos.

## Definición de "terminado" (criterio de aceptación)

1. **Un solo comando** levanta todo (Docker, base, API, carta, panel, túnel) y muestra los links y un QR para el celular.
2. Desde el celular, por Wi-Fi (HTTP) y por túnel HTTPS: escanear → unirse → pedir → el mozo confirma → cocina → "listo" en el celular.
3. **El dueño del bar puede administrar sin tocar código:** platos (crear, editar, precio, agotado, ocultar), categorías, mesas y QR imprimibles.
4. Carta con al menos un plato 3D/AR que sobreviva a `db:seed`.
5. Auditoría de seguridad hecha y documentada: dependencias, autorización por rol y tenant, validación de entradas, headers, secretos.
6. Tests en verde, chequeo de tipos de todas las apps y build de producción de los front.
7. `PLAN-MAESTRO.md` actualizado con qué quedó hecho, cómo usarlo y qué falta.

## Orden de trabajo (prioridad)

1. API de administración (`/v1/admin/*`): carta, agotados, mesas, regenerar QR. Solo OWNER/MANAGER, siempre filtrado por tenant.
2. Panel `/admin` en staff-web: carta, mesas con QR imprimible, ajustes del local.
3. Seed completo: plato 3D, estaciones, staff demo.
4. Auditoría de seguridad + arreglos.
5. Modo "MVP local": build de producción + script `start-mvp` + túnel + página con links y QR.
6. Prueba de punta a punta en el navegador, como celular.
7. Documentación y entrega.

## Reglas

- Cada paso termina con tests y chequeo de tipos en verde, y con un commit.
- Nada de datos inventados presentados como reales; lo demo se marca como demo.
- Si algo no se puede resolver sin el usuario (DNS del router, cuentas en la nube), se documenta con la solución exacta en vez de forzarlo.

## Resultado (21/10/2026)

| Criterio | Estado |
| :-- | :-- |
| 1. Un solo comando levanta todo | ✅ `INICIAR-MVP.cmd` (Docker, migraciones, secretos, build, API, carta, panel, túneles y `.mvp/LINKS.html` con QR) |
| 2. Flujo completo desde el celular | ✅ Probado con `scripts/mvp/smoke.mjs` por localhost **y por los túneles HTTPS**. En el Wi-Fi de casa, el link HTTPS no abre por un bloqueo del router a `trycloudflare.com`: usar el link de red local o datos móviles |
| 3. El dueño administra sin código | ✅ `/admin`: carta, agotados, fotos/3D, mesas y QR imprimibles, NFC, equipo, Wi-Fi y reseñas |
| 4. Plato 3D/AR que sobrevive al seed | ✅ Tostada de palta (Avocado de Khronos, CC0) |
| 5. Auditoría de seguridad | ✅ [SEGURIDAD.md](SEGURIDAD.md): 17 puntos, 2 problemas reales corregidos (spoofing de IP y límite compartido), `pnpm audit` limpio |
| 6. Tests, tipos y build | ✅ 46 tests de la API, typecheck de las 4 apps, build de producción con CSP |
| 7. Plan actualizado | ✅ [PLAN-MAESTRO.md](../PLAN-MAESTRO.md) §9–§13 |

Además, pedido durante la sesión: **Super Admin** de la plataforma y **Sudoku** para la espera.
