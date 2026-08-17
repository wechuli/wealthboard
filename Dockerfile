FROM node:24-bookworm-slim AS build-base
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

FROM build-base AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM build-base AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_PATH=/data/wealthboard.db \
    BACKUP_PATH=/backups \
    PORT=3000

RUN groupadd --system --gid 1001 wealthboard \
  && useradd --system --uid 1001 --gid wealthboard wealthboard \
    && mkdir -p /data /backups \
  && chown -R wealthboard:wealthboard /data /backups

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=builder --chown=wealthboard:wealthboard /app/.next ./.next
COPY --from=builder --chown=wealthboard:wealthboard /app/public ./public
COPY --from=builder --chown=wealthboard:wealthboard /app/db/migrations ./db/migrations
COPY --from=builder --chown=wealthboard:wealthboard /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder --chown=wealthboard:wealthboard /app/scripts/reset-password.mjs ./scripts/reset-password.mjs
COPY --from=builder --chown=wealthboard:wealthboard /app/scripts/backup.mjs ./scripts/backup.mjs
COPY --from=builder --chown=wealthboard:wealthboard /app/scripts/restore-backup.mjs ./scripts/restore-backup.mjs
COPY --from=builder --chown=wealthboard:wealthboard /app/package.json ./

USER wealthboard
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["npm", "start"]
