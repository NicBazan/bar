# Bar: plataforma de servicio en mesa

Carta digital con 3D y realidad aumentada, pedidos desde la mesa con aprobación del mozo, cocina por estaciones, fidelización de clientes y administración multi-local. El comensal escanea un QR o toca un NFC y no instala nada.

## Probarlo en local

Requisitos: Windows con Docker Desktop y Node 22.

1. Doble clic en `INICIAR-MVP.cmd`. Se abre `.mvp/LINKS.html` con los links y los QR para el celular.
2. Para apagarlo: `DETENER-MVP.cmd`.

Usuarios de demostración (solo desarrollo; nunca se cargan en producción):

| Rol | Email | Contraseña |
| :-- | :-- | :-- |
| Dueño | `dueno@bardemo.test` | `demo1234` |
| Mozo | `mozo@bardemo.test` | `demo1234` |
| Cocina | `cocina@bardemo.test` | `demo1234` |
| Super admin | `superadmin@bar.test` | `superadmin1234` |

## Documentación

| Documento | Contenido |
| :-- | :-- |
| [PLAN-MAESTRO.md](PLAN-MAESTRO.md) | Estrategia, modelo de negocio, alcance y hoja de ruta |
| [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) | Componentes, datos, tiempo real y referencia de la API |
| [docs/SEGURIDAD.md](docs/SEGURIDAD.md) | Auditoría de seguridad y riesgos pendientes |
| [docs/DESARROLLO-LOCAL.md](docs/DESARROLLO-LOCAL.md) | Modo desarrollo, pruebas desde el celular y problemas conocidos |
| [DEPLOY.md](DEPLOY.md) | Pase a la nube (Neon, Upstash, Render, Vercel, Cloudinary) |
| [docs/DIAGNOSTICO-2026-11.md](docs/DIAGNOSTICO-2026-11.md) | Diagnóstico técnico y deuda priorizada |
| [CLAUDE.md](CLAUDE.md) | Reglas de trabajo para el código |

## Calidad

`corepack pnpm typecheck` · `corepack pnpm --filter @bar/api test` · CI en GitHub Actions en cada push.
