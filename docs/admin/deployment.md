---
title: Deployment
description: Run the Go service with PostgreSQL directly or on Kubernetes.
---

# Deployment

Wealthboard is a Go HTTP service backed by PostgreSQL. It serves a compiled
Vite/React client and can run multiple stateless application replicas against
one managed or self-operated PostgreSQL database.

## Requirements

- Go 1.27 or newer for a direct source build
- Node.js 24 and npm for the Vite client build
- PostgreSQL 17 with durable storage and tested backups
- compatible `pg_dump` and `pg_restore` clients for operator recovery
- persistent, access-controlled storage for backups
- HTTPS termination in a trusted reverse proxy for production
- a deployment plan for maintenance mode during destructive restore

## Essential configuration

| Variable              | Purpose                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| `DATABASE_URL`        | Required PostgreSQL connection URL                                        |
| `SESSION_SECRET`      | Unique high-entropy session key, at least 32 characters                   |
| `APP_URL`             | Canonical external URL used for origin and OIDC validation                |
| `AUTH_METHODS`        | `local`, `oidc`, or `local,oidc`                                          |
| `TRUST_PROXY_HEADERS` | Enable only behind an ingress that overwrites forwarded client-IP headers |
| `TZ`                  | Default timezone for new users                                            |
| `AI_CREDENTIAL_ENCRYPTION_KEY` | Canonical base64 32-byte key for remembered provider credentials |
| `AI_ALLOWED_ENDPOINTS` | Exact comma-separated custom provider base URLs                          |
| `AI_EXTRACTION_SOCKET` | Shared Unix socket for a container document-parser sidecar               |

OIDC and AI variables are described in [Authentication](./authentication) and
the repository README.

## Direct installation

```bash
make postgres-up
make web-install
make build
DATABASE_URL='postgres://wealthboard:wealthboard@localhost:5433/wealthboard?sslmode=disable' \
SESSION_SECRET="$(openssl rand -hex 32)" \
APP_URL=http://localhost:3000 \
AUTH_METHODS=local \
./bin/wealthboard serve
```

`serve` applies embedded PostgreSQL migrations before accepting requests.

For development:

```bash
make postgres-up
make web-build
make go-run
```

Run `make web-dev` in a separate terminal only when actively developing the
client; the Go server continues to serve `web/dist` until it is rebuilt.

## Dependency security and npm registry

The repository pins the canonical public npm registry in `.npmrc` and disables
registry-host rewriting so lockfile tarballs cannot be redirected through an
incomplete proxy. Install with `npm ci` for reproducibility. Install scripts are
reviewed and pinned through the `allowScripts` policy in `package.json`; do not
approve every pending script automatically.

Upgrade direct dependencies to maintained stable releases and resolve
transitive advisories by upgrading their owning package. Do not use
`npm audit fix --force` when it proposes a downgrade or unreviewed breaking
change. The reviewed dependency baseline has zero findings from both
`npm audit` and `npm audit --omit=dev`; rerun both after dependency changes.

## Containers

The production-style Compose stack starts PostgreSQL, Wealthboard, and the
network-disabled extraction worker:

```bash
POSTGRES_PASSWORD="$(openssl rand -hex 24)" \
SESSION_SECRET="$(openssl rand -hex 32)" \
docker compose up -d --build
docker compose ps
```

`docker-compose.go.yml` remains the minimal PostgreSQL-only development stack.
Neither Compose file schedules database backups. Build only the application
image with:

```bash
docker build -t wealthboard:local .
```

Run that image with an external `DATABASE_URL` and the required authentication
environment. The image runs as non-root with a read-only application filesystem.

Before an update:

```bash
make backup BACKUP_FILE="$PWD/backups/pre-update.dump"
docker build -t wealthboard:local .
```

Verify readiness after migrations finish.

## Position-account migration

The PostgreSQL financial-domain migration introduces account tracking mode,
instruments, position events, security prices, reconciliation observations,
conversion provenance, advanced-action relationships, grouped cash,
deterministic event order, and freshness settings.

- Existing accounts remain in total-value mode and keep their balances.
- No migration infers instruments or quantities from monetary history.
- Users opt into units and prices when creating an account or through guided
  conversion.
- Create and verify a deployment backup before upgrading.
- After startup, check readiness, one existing balance account, and one
  position-account value before removing the pre-upgrade backup from immediate
  recovery storage.

## Kubernetes

The example at `deploy/kubernetes.yaml` uses:

- two application replicas with a rolling update;
- an external PostgreSQL URL from `wealthboard-database`;
- startup, readiness, and liveness probes;
- a non-root security context;
- TLS at ingress.

Create secrets out of band, adjust the image and host, then apply the manifest:

```bash
kubectl apply -f deploy/kubernetes.yaml
kubectl get pods
kubectl get ingress
```

The manifest intentionally does not provision PostgreSQL, persistent database
storage or a backup controller. It does include a network-isolated document
extraction sidecar over an in-memory Unix socket. The operator is
responsible for PostgreSQL availability, upgrades, point-in-time or scheduled
backup policy, retention, encryption, and restore drills. The application image
is distroless and contains no `pg_dump`, `pg_restore`, Node.js, or shell, so run
database operations from a trusted admin host/job. Adjust the example egress
NetworkPolicy to match the real PostgreSQL namespace and labels.

## Optional fictional demo data

Demo data is never created by signup. The command requires both an explicit
existing username and the exact opt-in gate:

```bash
make seed-demo DEMO_DATA=true TARGET_USERNAME=alice
```

It never creates an identity or seeds every user.

## Health endpoints

| Endpoint            | Use                                                                     |
| ------------------- | ----------------------------------------------------------------------- |
| `/api/health/live`  | Process liveness; temporary dependencies should not cause restart loops |
| `/api/health/ready` | Database, configuration, migration, and authentication readiness        |
| `/api/health`       | Legacy readiness-compatible endpoint                                    |

Readiness may reject an authentication mode that would strand active users.

## Publish this documentation

The repository includes `.github/workflows/publish-docs.yml`. In the GitHub
repository:

1. Open **Settings → Pages**.
2. Set the source to **GitHub Actions**.
3. Push documentation changes to `main`, or run **Publish documentation**
   manually from the Actions tab.

The workflow builds with the project base `/wealthboard/` and deploys the
VitePress output as a Pages artifact.

Local documentation commands:

```bash
npm run docs:dev
DOCS_BASE=/wealthboard/ npm run docs:build
npm run docs:preview
```
