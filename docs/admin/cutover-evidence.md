---
title: Phase 6 cutover evidence
description: Recorded acceptance evidence for removal of the legacy runtime.
---

# Phase 6 cutover evidence

The owner authorized the full Phase 6 removal on 20 September 2026 after the
parity, migration, integration, native PostgreSQL backup/restore,
documentation, and Phase 5 browser gates passed.

## Retained parity evidence

- Source archive fixture: `tests/fixtures/phase6-parity-v8.json`
- Source fixture SHA-256:
  `ea2728c30b2e22d3698a3ce2453f93d4a76e048fd82d37b4ed04272ba8d9ff99`
- Frozen normalized outcome: `tests/fixtures/phase6-parity-expected.json`
- Normalized outcome SHA-256:
  `3a3a825d597a25cc260e726168664c624d0fba4d6dcb2b4b289c70a54be411d9`

`TestPhase6ParityEvidence` restores the source archive into a disposable
PostgreSQL database and compares exports, balances, positions, goals, reports,
and estate snapshots with the frozen normalized outcome. The legacy runtime is
no longer required to repeat this assertion.

## Post-cutover gates

The supported validation surface is:

```bash
make generate
make lint
make typecheck
make test
make migrate-check
make go-test-integration
make test-e2e-go
make build
npm run docs:build
```

Native backup/restore coverage remains in `internal/operator/postgres_test.go`.
Phase 5 browser workflows remain in `tests/e2e-go/phase5.spec.ts`. Legacy
Drizzle migration history remains as non-executable provenance under
`docs/archive/drizzle-migrations`.