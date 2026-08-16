---
title: Deployment
description: Run Wealthboard locally, with Docker Compose, or as a single-replica Kubernetes workload.
---

# Deployment

Wealthboard is one Next.js process backed by one SQLite database. It requires a
persistent writable filesystem but no separate API or database service.

## Requirements

- Node.js 22 or newer for a direct installation
- persistent storage for the SQLite database
- persistent, access-controlled storage for backups
- HTTPS termination in a trusted reverse proxy for production
- one application replica

SQLite is deliberately retained for a simple self-hosted deployment. Do not run
multiple Wealthboard replicas against one database file.

## Essential configuration

| Variable              | Purpose                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| `DATABASE_PATH`       | SQLite path; defaults to `./data/wealthboard.db`                          |
| `SESSION_SECRET`      | Unique high-entropy session key, at least 32 characters                   |
| `APP_URL`             | Canonical external URL used for origin and OIDC validation                |
| `AUTH_METHODS`        | `local`, `oidc`, or `local,oidc`                                          |
| `TRUST_PROXY_HEADERS` | Enable only behind an ingress that overwrites forwarded client-IP headers |
| `BACKUP_PATH`         | Persistent operator backup directory                                      |
| `TZ`                  | Default timezone for new users                                            |

OIDC and AI variables are described in [Authentication](./authentication) and
the repository README.

## Direct Node.js installation

```bash
npm ci
cp .env.example .env
# Edit .env before starting.
npm run build
npm start
```

`npm start` applies pending migrations before starting Next.js. The process must
be able to create and write the database directory.

For development:

```bash
npm install
npm run dev
```

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

## Docker Compose

1. Copy `.env.example` to `.env`.
2. Set `SESSION_SECRET`, `APP_URL`, authentication policy, and provider values.
3. Start the application:

```bash
docker compose up -d --build
docker compose ps
```

The Compose file mounts persistent data and backup storage. Protect both from
other host users and never publish them in an image.

Before an update:

```bash
npm run backup
docker compose up -d --build
```

Verify readiness after migrations finish.

## Position-account migration

The position-account schema is delivered through two append-only migrations. Migration
`0005` introduces account tracking mode, instruments, position events, security
prices, and reconciliation observations. Migration `0006` completes the epic
with conversion provenance, advanced-action relationships, grouped cash,
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

- one replica;
- `Recreate` update strategy;
- ReadWriteOnce persistent storage;
- startup, readiness, and liveness probes;
- a non-root security context;
- TLS at ingress.

Create secrets out of band, adjust the image and host, then apply the manifest:

```bash
kubectl apply -f deploy/kubernetes.yaml
kubectl get pods
kubectl get ingress
```

Do not scale the Deployment above one replica. SQLite supports concurrent reads
inside the process, not independent application replicas on shared storage.

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
