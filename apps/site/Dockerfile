# syntax=docker/dockerfile:1.7
#
# Production image for the Nixway marketing + documentation site (apps/site).
# Mirrors the apps/web-v2 Dockerfile so the two share the same operator model.

FROM node:24-alpine AS deps
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/site/package.json apps/site/package.json
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter site...

FROM node:24-alpine AS builder
WORKDIR /src
RUN corepack enable
COPY --from=deps /src/node_modules ./node_modules
COPY --from=deps /src/apps/site/node_modules ./apps/site/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/site apps/site
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm --filter site build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=80 \
    HOSTNAME=0.0.0.0

COPY --from=builder /src/apps/site/.next/standalone ./
COPY --from=builder /src/apps/site/.next/static ./apps/site/.next/static
COPY --from=builder /src/apps/site/public ./apps/site/public

EXPOSE 80
USER node
CMD ["node", "apps/site/server.js"]
