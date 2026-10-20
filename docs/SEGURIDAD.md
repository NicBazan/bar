# 🛡️ Auditoría de seguridad (20/10/2026)

Revisión hecha sobre todo el monorepo (API, carta, panel, scripts) antes de dejar el MVP andando. Cada punto dice qué se encontró, qué se hizo y cómo se verifica.

## Resumen

| # | Área | Hallazgo | Estado | Verificación |
| :-- | :-- | :-- | :-- | :-- |
| 1 | Rate limit | La API confiaba en `X-Forwarded-For` (`trustProxy: true`): cualquiera podía inventarse una IP por request y saltear el límite del login | ✅ Corregido | `hardening.e2e`: "cambiar X-Forwarded-For no da más intentos" y "la API ignora X-Forwarded-For" |
| 2 | Rate limit | Con los rewrites de Next, todos los celulares llegan a la API con la misma IP: 20 mesas haciendo polling compartían un solo cupo de 300/min (el bar se bloqueaba solo) | ✅ Corregido | Límite global por dispositivo/usuario con token **válido** (`shared/rate-limit/keys.ts`) |
| 3 | Login | Fuerza bruta contra una cuenta | ✅ 10 intentos/min **por cuenta** + tiempo de respuesta constante (scrypt contra hash falso si el email no existe) | `hardening.e2e` |
| 4 | Sesiones de staff | Un JWT de 12 h seguía sirviendo después de dar de baja al usuario o suspender el bar | ✅ `requireStaff` consulta el estado vivo (caché de 10 s); el rol vigente es el de la base | `admin.e2e`: "al desactivarlo pierde el acceso al instante" |
| 5 | PIN de mesa | 4 dígitos = 10.000 combinaciones; sin tope por sesión | ✅ 8 intentos fallidos bloquean el ingreso por PIN (423); el mozo genera uno nuevo. Comparación en tiempo constante | `admin.e2e`: "tras 8 intentos fallidos se bloquea" |
| 6 | Subida de archivos | (nuevo) Fotos y modelos 3D del admin | ✅ Tipo detectado por **firma de bytes** (no por extensión), solo JPG/PNG/WebP/GLB/USDZ, límites de tamaño, nombre generado por el servidor (UUID), servidos con `nosniff` + `CSP: default-src 'none'; sandbox` | `admin.e2e`: HTML disfrazado de .jpg → 415; path traversal → 400 |
| 7 | URLs guardadas | Fotos/3D/reseñas por URL podían ser `javascript:` o `http:` | ✅ Solo `https://` o archivos propios | `admin.e2e`: "nada de javascript: ni http:" |
| 8 | Aislamiento entre bares | (nuevo) Todas las rutas de admin | ✅ El `tenantId` sale **siempre del token**; cada recurso por id se busca con `tenantId` + sucursal | `admin.e2e`: "el bar B no puede ver ni tocar los platos del bar A" |
| 9 | Super admin | (nuevo) Acceso a todos los bares | ✅ Rol `SUPER_ADMIN` **y** usuario del tenant de la plataforma; un bar no puede crear ese rol (el admin solo asigna MANAGER/WAITER/KITCHEN/CASHIER); todo queda en el AuditLog | `admin.e2e`: "un dueño recibe 403" |
| 10 | Escalada de rol | Un encargado podía intentar crear encargados o editar al dueño | ✅ Matriz de roles en la API; nadie cambia su propio rol ni se desactiva | `admin.e2e` |
| 11 | Wi-Fi del local | La clave no debe llegar a quien solo fotografió el QR | ✅ Solo se entrega con la mesa **abierta** por el mozo | `admin.e2e`: "el Wi-Fi solo se entrega a mesas abiertas" |
| 12 | Headers HTTP | Faltaban CSP y Permissions-Policy en los front | ✅ CSP en producción (scripts solo del propio sitio), HSTS, `Permissions-Policy`, `X-Frame-Options: DENY`, sin `X-Powered-By`; API con `no-store` en datos de staff | `smoke.mjs`: "la carta sirve CSP en producción" |
| 13 | Dependencias externas en runtime | `<model-viewer>` se bajaba de `ajax.googleapis.com` | ✅ Incluido en el bundle (import dinámico): sin CDN de terceros ejecutando código | — |
| 14 | Dependencias | `pnpm audit`: 2 críticas, 1 alta, 2 moderadas (todas de herramientas de dev: vitest/tinypool, CLI de Prisma) | ✅ vitest 4.1.11+, overrides de `deepmerge-ts` y `tinypool` | `pnpm audit` → "No known vulnerabilities found" |
| 15 | Exposición de la API | En el MVP local la API escuchaba en todas las interfaces | ✅ `HOST=127.0.0.1`: solo la ven los front de la PC | `start-mvp.ps1` |
| 16 | Secretos | `JWT_SECRET` y `NFC_MASTER_KEY` con valores de desarrollo | ✅ En producción la API no arranca sin ellos; el script del MVP los genera al azar en `.env` (ignorado por git) | `config.ts` |
| 17 | Hashes | Que ningún endpoint devuelva `passwordHash` | ✅ `select` explícito en staff/admin/superadmin | `admin.e2e`: "no expone hashes de contraseñas" |

## Lo que ya estaba bien (revisado)

- **SQL injection:** todas las consultas son de Prisma; el SQL crudo (worker del outbox, purga) usa *tagged templates* parametrizados.
- **XSS:** React escapa todo; no hay `dangerouslySetInnerHTML`. Los SVG/HTML no se pueden subir.
- **CSRF:** el panel y la carta usan `Authorization: Bearer` (no se envía solo); las cookies son `SameSite=strict` (staff) y `lax` (comensal), y CORS solo acepta orígenes configurados.
- **NFC SUN:** algoritmo de NXP verificado con el vector oficial, UID ligado a la mesa y anti-replay atómico.
- **Pedidos:** precios, estación y total los calcula el servidor; `Idempotency-Key` evita duplicados.
- **Errores:** los 500 no exponen detalles internos (`errorHandler`).

## Riesgos aceptados / pendientes (para producción real)

| Riesgo | Por qué se acepta hoy | Qué hacer |
| :-- | :-- | :-- |
| Token del staff en `localStorage` (robable con XSS) | No hay vectores de XSS conocidos y hay CSP | Pasar a cookie `HttpOnly` + `SameSite=strict` exclusivamente |
| `script-src 'unsafe-inline'` en la CSP | Next inyecta scripts inline para hidratar | CSP con *nonces* (middleware de Next) |
| Rate limit en memoria | Una sola instancia de la API | Store en Redis al escalar a varias instancias |
| Archivos subidos en el disco de la API (sin `CLOUDINARY_URL`) | MVP local | Configurar `CLOUDINARY_URL`: las subidas van a Cloudinary con firma del lado del servidor (el secreto nunca llega al navegador) y se borran al reemplazarlas |
| Una sola `NFC_MASTER_KEY` para todos los chips | El UID está ligado a la mesa, así que una firma de otro chip no sirve | Claves diversificadas por chip (AN10922) |
| Onboarding abierto (cualquiera crea un bar) | Tope global de 30 altas por hora | Captcha (Turnstile) y verificación de email |
| Sin 2FA para super admin | MVP | TOTP para SUPER_ADMIN |
| Usuarios demo con contraseñas conocidas | Solo en la base local | No correr el seed en producción; usar `create-superadmin` |
