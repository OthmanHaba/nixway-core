# syntax=docker/dockerfile:1.7
#
# Production image for the Nixway Core operator console (apps/web-v2).
#
# Multi-stage build:
#   1. deps    — pnpm install with the workspace lockfile
#   2. builder — copy source + build (Next standalone output)
#   3. runner  — minimal Node image running .next/standalone/server.js
#
# The compose service is fronted by Traefik on host port 80, so the runner
# listens on PORT=80 inside the container. NIXWAY_API_URL is required at
# startup so the /api/* rewrite resolves to the api service over the
# internal docker network.

FROM node:24-alpine AS deps
WORKDIR /src
RUN corepack enable
# Workspace metadata only — keeps the deps layer cache hot across source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web-v2/package.json apps/web-v2/package.json
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter web-v2...

FROM node:24-alpine AS builder
WORKDIR /src
RUN corepack enable
COPY --from=deps /src/node_modules ./node_modules
COPY --from=deps /src/apps/web-v2/node_modules ./apps/web-v2/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web-v2 apps/web-v2
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm --filter web-v2 build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=80 \
    HOSTNAME=0.0.0.0

# The standalone bundle is anchored at the monorepo root (because
# outputFileTracingRoot points at apps/web-v2/../..), so the entry point
# lives at /app/apps/web-v2/server.js once we mirror the layout.
COPY --from=builder /src/apps/web-v2/.next/standalone ./
COPY --from=builder /src/apps/web-v2/.next/static ./apps/web-v2/.next/static
COPY --from=builder /src/apps/web-v2/public ./apps/web-v2/public

EXPOSE 80
USER node
CMD ["node", "apps/web-v2/server.js"]
