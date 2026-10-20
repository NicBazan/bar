# Bar: Plataforma de Experiencia en Mesa

Carta 3D/AR + pedidos + KDS + hub en mesa con NFC/QR, sin instalar apps.

- 📘 Plan, decisiones, estado y pendientes: [PLAN-MAESTRO.md](PLAN-MAESTRO.md). Para retomar: §11 (qué falta) y §12 (problemas conocidos)
- 🚀 Deploy: [DEPLOY.md](DEPLOY.md)
- 📁 Estructura: `apps/` (guest-web, staff-web, api, workers) · `packages/` (db, shared-types, config) · `infra/` · `tools/` · `docs/`

**Estado:** Fase 1 avanzada. El flujo QR → carta → pedido → mozo → cocina funciona en local, con 23 tests en verde. Falta el deploy real y el admin de carta.

```bash
corepack pnpm infra:up && corepack pnpm db:deploy
corepack pnpm --filter @bar/api dev        # :4000
corepack pnpm --filter @bar/guest-web dev  # :3000
corepack pnpm --filter @bar/staff-web dev  # :3001
```
