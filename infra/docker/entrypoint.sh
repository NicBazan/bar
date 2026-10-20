#!/bin/sh
set -e
case "$1" in
  api)
    # Migraciones pendientes antes de aceptar tráfico (idempotente)
    pnpm --filter @bar/db run migrate:deploy
    cd apps/api && exec npx tsx src/server.ts
    ;;
  worker)
    cd apps/workers && exec npx tsx src/index.ts
    ;;
  *)
    exec "$@"
    ;;
esac
