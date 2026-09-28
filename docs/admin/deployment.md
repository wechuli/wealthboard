---
title: Deployment
description: Run the Go service with PostgreSQL directly or on Kubernetes.
---

# Deployment

Wealthboard is a Go HTTP service backed by PostgreSQL. It serves a compiled
Vite/React client and can run multiple stateless application replicas against
one managed or self-operated PostgreSQL database.

New PostgreSQL deployments start from the Goose migrations; later releases
upgrade that database through append-only migrations. Wealthboard does not
import or dual-write legacy SQLite databases. The
[legacy cutover and removal](./cutover) is complete and remains documented as
historical context, not an outstanding installation step.

## Requirements

- Go 1.27 or newer for a direct source build
- Node.js 24 and npm for the Vite client build
- PostgreSQL 18 with durable storage and tested backups
- PostgreSQL 18 `pg_dump` and `pg_restore` clients for operator recovery
- persistent, access-controlled storage for backups
- HTTPS termination in a trusted reverse proxy for production
- a deployment plan for maintenance mode during destructive restore

## PostgreSQL deployment

Create the database and login role before starting Wealthboard. The application
applies its schema migrations but does not provision a PostgreSQL server or
create the target database. Its configured role must be able to apply DDL in the
application schema and read/write its tables; no application user needs a
PostgreSQL login.

The current migrations require no extra PostgreSQL extensions. The Go connection
pool defaults to 10 open and 5 idle connections per application process. Budget
database connections across all replicas and operator jobs; these pool settings
are currently code defaults, not environment-variable controls.

Use authenticated TLS for remote PostgreSQL. The development Compose URL's
`sslmode=disable` is for the local test stack, not a remote production default.
Use the tested PostgreSQL 18 server/client baseline for backup and restore, and
handle PostgreSQL major-version upgrades separately from application migrations.

### Upgrading from PostgreSQL 17

The Compose examples now use `postgres:18`. The official image stores data in
`/var/lib/postgresql/18/docker` and expects the volume at `/var/lib/postgresql`,
not the PostgreSQL 17 mount at `/var/lib/postgresql/data`.

Do not point PostgreSQL 18 at an existing PostgreSQL 17 data directory or assume
that changing the image/mount upgrades it. Goose upgrades Wealthboard's schema,
not the PostgreSQL storage format.

1. Stop application writes and take a verified custom-format backup of the old
   database. Keep its original volume and stable deployment secrets.
2. Provision PostgreSQL 18 with a **new empty volume** and a separate temporary
   endpoint or Compose project. Do not delete or overwrite the old volume.
3. Use PostgreSQL 18 client tools to restore into the new database, following
   [maintenance-mode recovery](./backup-recovery). Use the Wealthboard release
   matching the archive's application schema; handle any application upgrade
   separately after recovery.
4. Verify readiness, authentication, financial totals, and backups on the new
   database before switching the application's `DATABASE_URL`.
5. Retain the old database and backup until recovery validation is complete.

Managed PostgreSQL operators may instead use their provider's tested
major-version upgrade process or a properly staged `pg_upgrade`. Do not use
Compose volume deletion as a migration procedure. The official image documents
the [PostgreSQL 18 data-directory change](https://github.com/docker-library/docs/blob/master/postgres/README.md#pgdata).

## Essential configuration

| Variable                       | Purpose                                                                   |
| ------------------------------ | ------------------------------------------------------------------------- |
| `DATABASE_URL`                 | Required PostgreSQL connection URL                                        |
| `SESSION_SECRET`               | Unique high-entropy session key, at least 32 characters                   |
| `APP_URL`                      | Canonical external URL used for origin and OIDC validation                |
| `NODE_ENV`                     | Set `production` so application session cookies require HTTPS             |
| `PORT`                         | Go HTTP listener port; default `3000`                                     |
| `AUTH_METHODS`                 | `local`, `oidc`, or `local,oidc`                                          |
| `TRUST_PROXY_HEADERS`          | Legacy no-op; Go rate limits use the socket peer IP                       |
| `TZ`                           | Default timezone for new users                                            |
| `AI_CREDENTIAL_ENCRYPTION_KEY` | Canonical base64 32-byte key for remembered provider credentials          |
| `AI_ALLOWED_ENDPOINTS`         | Exact comma-separated custom provider base URLs                           |
| `AI_EXTRACTION_SOCKET`         | Shared Unix socket for a container document-parser sidecar                |
| `AI_EXTRACTION_SCRIPT`         | Direct-install Node parser path when no socket is configured              |
| `WEB_DIST_PATH`                | Compiled Vite assets served by Go; default `web/dist`                     |

OIDC and AI variables are described in [Authentication](./authentication) and
the repository README. Set `NODE_ENV=production` for every direct production
installation; the supplied container image already sets it.

## Direct installation

```bash
make postgres-up
npm ci
make web-install
make build
DATABASE_URL='postgres://wealthboard:wealthboard@localhost:5433/wealthboard?sslmode=disable' \
SESSION_SECRET="$(openssl rand -hex 32)" \
APP_URL=http://localhost:3000 \
AUTH_METHODS=local \
./bin/wealthboard serve
```

`serve` applies embedded PostgreSQL migrations before accepting requests.
The example generates a disposable development session secret; keep a stable
secret for persistent deployments. Go reads exported process variables and does
not automatically load `.env`. Export `DATABASE_URL` for subsequent operator
commands; `.env.example` is a configuration reference, not a Go dotenv loader.

Root npm dependencies support docs, browser tests, and local document extraction;
the separate `web/` dependencies support the Vite client. A deployment that
only runs a prebuilt Go binary and client needs neither set unless it uses the
direct-install Node parser.

Useful operator commands are:

```bash
./bin/wealthboard migrate
./bin/wealthboard migrate-status
NEW_USER_PASSWORD='replacement-password' ./bin/wealthboard reset-password --username alice
DEMO_DATA=true ./bin/wealthboard seed-demo --username alice
./bin/wealthboard healthcheck
```

Backup and restore are covered separately because restore requires exclusive
maintenance mode and the explicit `--confirm-maintenance` flag.

For client hot reload, build once as above, export `DATABASE_URL` and
`SESSION_SECRET`, and run Go in one terminal:

```bash
PORT=3100 APP_URL=http://127.0.0.1:5173 AUTH_METHODS=local make go-run
```

Run `make web-dev` in a second terminal and open <http://127.0.0.1:5173>.
Vite proxies `/api` to Go on port `3100`. The browser origin must match
`APP_URL` for origin/CSRF protection; opening the Go listener instead still
shows the last `web/dist` build. Reuse an existing development server rather
than starting another on the same port.

## Dependency security and npm registry

The repository pins the canonical public npm registry in `.npmrc` and disables
registry-host rewriting so lockfile tarballs cannot be redirected through an
incomplete proxy. Install with `npm ci` for reproducibility. Install scripts are
reviewed and pinned through the `allowScripts` policy in `package.json`; do not
approve every pending script automatically.

Upgrade direct dependencies to maintained stable releases and resolve
transitive advisories by upgrading their owning package. Do not use
`npm audit fix --force` when it proposes a downgrade or unreviewed breaking
change. Run `make security` against the current dependency set: it checks Go
vulnerabilities and audits the root, web, and extraction-worker npm packages.
Install the corresponding dependencies before auditing; a previous clean scan
is not a guarantee about newly published advisories.

## Containers

The production-style Compose stack starts PostgreSQL, Wealthboard, and the
network-disabled extraction worker. Set `POSTGRES_PASSWORD`, a stable
`SESSION_SECRET`, and the browser-facing `APP_URL` in an uncommitted `.env` or
exported environment before starting it:

```bash
docker compose up -d --build
docker compose ps
```

Generate secrets once (for example, with `openssl rand -hex 24` for the database
password and `openssl rand -hex 32` for the session secret) and keep them in
private deployment configuration. Do not regenerate the database password on
each update: the existing PostgreSQL volume retains its initialized credentials.
Use HTTPS at the configured external origin in production; the image already
sets `NODE_ENV=production`.

`docker-compose.go.yml` remains the minimal PostgreSQL-only development stack.
Neither Compose file schedules database backups. Build only the application
image with:

```bash
docker build -t wealthboard:local .
```

Run that image with an external `DATABASE_URL` and the required authentication
environment. The image runs as non-root; the supplied Compose and Kubernetes
configurations additionally enforce a read-only application filesystem.

Node.js is not part of the application container. It remains an intentional
runtime exception only in the separate extraction worker for PDF, XLSX, and
DOCX parsing. UTF-8 CSV, TSV, JSON, and TXT are parsed by Go.

Before an update, export the target deployment's `DATABASE_URL` on the operator
host, ensure the backup directory exists, and choose a new backup filename:

```bash
make backup BACKUP_FILE="$PWD/backups/pre-update.dump"
docker build -t wealthboard:local .
```

Building an image alone does not replace running containers. Roll out the
chosen release with the deployment's stable configuration, then verify readiness
after migrations finish.

## Position-account migration

The PostgreSQL migration lineage includes account tracking mode,
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
storage or a backup controller. It does include a bounded document extraction
sidecar over an in-memory Unix socket; Kubernetes containers share the pod
network namespace. The operator is
responsible for PostgreSQL availability, upgrades, point-in-time or scheduled
backup policy, retention, encryption, and restore drills. The application image
is distroless and contains no `pg_dump`, `pg_restore`, Node.js, or shell, so run
database operations from a trusted admin host/job. Adjust the example egress
NetworkPolicy to match the real PostgreSQL namespace and labels. It permits
only DNS and that PostgreSQL destination by default. OIDC and AI require
additional, deliberately scoped outbound access to their configured providers.
All replicas must share the same session, OIDC transaction, and optional AI
credential-encryption secrets.

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
These checks run on health requests, not as a pre-listen startup gate. Route
traffic only after `/api/health/ready` succeeds. `wealthboard healthcheck` checks
that endpoint on the local Go listener.

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
