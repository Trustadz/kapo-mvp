# syntax=docker/dockerfile:1

# Kapo production image: Next.js standalone output, Node 24, non-root user,
# persistent SQLite/upload volume at /app/data.

FROM node:24-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Native module toolchain for better-sqlite3 when no prebuilt binary matches.
FROM base AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/app/data/kapo.db \
    UPLOAD_DIR=/app/data/uploads \
    KAPO_MIGRATIONS_DIR=/app/migrations

RUN groupadd --system --gid 1001 kapo \
  && useradd --system --uid 1001 --gid kapo --create-home kapo \
  && mkdir -p /app/data/uploads \
  && chown -R kapo:kapo /app

WORKDIR /app

# Next.js standalone server + static assets + public files.
COPY --from=builder --chown=kapo:kapo /app/.next/standalone ./
COPY --from=builder --chown=kapo:kapo /app/.next/static ./.next/static
COPY --from=builder --chown=kapo:kapo /app/public ./public

# SQL migrations are read at runtime, not bundled by Next.js.
COPY --from=builder --chown=kapo:kapo /app/src/server/db/migrations ./migrations

USER kapo
VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
