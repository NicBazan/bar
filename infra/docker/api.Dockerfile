# Imagen de la API + workers (mismo código del monorepo, distinto comando de arranque).
# Build (desde la raíz del repo):  docker build -f infra/docker/api.Dockerfile -t bar-api .
#   API:     docker run -p 4000:4000 --env-file .env bar-api
#   Worker:  docker run --env-file .env bar-api worker
FROM node:22-slim

# Prisma necesita OpenSSL en runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /app

# Primero solo los manifiestos: la capa de dependencias se cachea entre builds
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY apps/api/package.json apps/api/
COPY apps/workers/package.json apps/workers/
RUN pnpm install --frozen-lockfile --filter "@bar/api..." --filter "@bar/workers..."

COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/workers ./apps/workers
RUN pnpm --filter @bar/db generate

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

COPY infra/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["api"]
