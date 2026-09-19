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
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/wealthboard ./cmd/wealthboard

FROM gcr.io/distroless/static-debian12:nonroot AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_PATH=/app/web/dist

COPY --from=go-builder --chown=nonroot:nonroot /out/wealthboard /app/wealthboard
COPY --from=web-builder --chown=nonroot:nonroot /app/web/dist /app/web/dist

USER nonroot
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/app/wealthboard", "healthcheck"]
ENTRYPOINT ["/app/wealthboard"]
CMD ["serve"]
