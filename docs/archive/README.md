# Legacy migration provenance

The `drizzle-migrations` directory preserves the final append-only SQLite and
Drizzle migration history at the Phase 6 cutover. These files are historical
evidence only. They are not executable application migrations and are not part
of build, test, deployment, backup, or restore workflows.

PostgreSQL Goose migrations under `db/postgres/migrations` are the only current
schema authority.
