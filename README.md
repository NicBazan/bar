# 🍸 Bar: plataforma de experiencia en mesa

Carta 3D/AR + pedidos desde la mesa + panel del mozo + KDS de cocina + admin del bar + super admin de la plataforma. Se usa escaneando un QR o tocando un NFC, sin instalar apps.

## Arrancar

**Doble clic en `INICIAR-MVP.cmd`.** Abre `.mvp/LINKS.html` con los links y QR para el celular.
Para apagarlo: `DETENER-MVP.cmd`.

| Rol | Email | Contraseña |
| :-- | :-- | :-- |
| Dueño (admin) | `dueno@bardemo.test` | `demo1234` |
| Mozo | `mozo@bardemo.test` | `demo1234` |
| Cocina | `cocina@bardemo.test` | `demo1234` |
| Super admin | `superadmin@bar.test` | `superadmin1234` |

*Contraseñas solo de desarrollo: no usar en producción.*

## Documentación

- 📘 [PLAN-MAESTRO.md](PLAN-MAESTRO.md): arquitectura, estado, pendientes (§11) y problemas conocidos (§12)
- 🛡️ [docs/SEGURIDAD.md](docs/SEGURIDAD.md): auditoría de seguridad
- 🚀 [DEPLOY.md](DEPLOY.md): pasar a la nube (Neon, Upstash, Render, Vercel)
- 🎯 [docs/MISION-MVP.md](docs/MISION-MVP.md): el encargo de la sesión que armó el MVP

## Estructura

`apps/` (guest-web: carta · staff-web: mozo, KDS, admin y super admin · api · workers) · `packages/` (db, shared-types, config) · `infra/` · `scripts/mvp/` · `docs/`
