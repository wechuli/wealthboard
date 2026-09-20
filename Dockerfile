FROM node:24-bookworm-slim AS web-builder
WORKDIR /app
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci --no-audit --no-fund
COPY api ./api
COPY app/globals.css ./app/globals.css
COPY web ./web
RUN npm --prefix web run build

FROM golang:1.27-bookworm AS go-builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY db/postgres ./db/postgres
COPY internal ./internal
RUN mkdir -p /out/socket-dir \
  && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/wealthboard ./cmd/wealthboard

FROM node:24-bookworm-slim AS extraction-dependencies
WORKDIR /worker
COPY extraction-worker/package.json extraction-worker/package-lock.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund

FROM node:24-bookworm-slim AS extraction-worker
WORKDIR /worker
ENV NODE_ENV=production \
  AI_EXTRACTION_SOCKET=/run/wealthboard/extraction.sock

COPY --from=extraction-dependencies --chown=65532:65532 /worker/node_modules ./node_modules
COPY --chown=65532:65532 scripts/extract-import-source.mjs scripts/extraction-worker-daemon.mjs ./scripts/
RUN mkdir -p /run/wealthboard \
  && chown 65532:65532 /run/wealthboard

USER 65532:65532
ENTRYPOINT ["node", "--max-old-space-size=160", "/worker/scripts/extraction-worker-daemon.mjs"]

FROM gcr.io/distroless/static-debian12:nonroot AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_PATH=/app/web/dist

COPY --from=go-builder --chown=nonroot:nonroot /out/wealthboard /app/wealthboard
COPY --from=go-builder --chown=nonroot:nonroot /out/socket-dir /run/wealthboard
COPY --from=web-builder --chown=nonroot:nonroot /app/web/dist /app/web/dist

USER nonroot
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/app/wealthboard", "healthcheck"]
ENTRYPOINT ["/app/wealthboard"]
CMD ["serve"]
