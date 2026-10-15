package database

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"log/slog"
	"time"

	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"

	postgresmigrations "github.com/wechuli/wealthboard/db/postgres"
)

const migrationsDirectory = "migrations"
const CurrentSchemaVersion int64 = 4

// migrationLockID is the PostgreSQL advisory lock key that serializes
// migrations across replicas and operator commands sharing a database. It is
// specific to Wealthboard so it cannot block another Goose-managed application.
const migrationLockID int64 = 0x5765616c74686264 // "Wealthbd"

// Migration lock acquisition retries every second for up to five minutes.
const (
	migrationLockRetrySeconds  = 1
	migrationLockRetryAttempts = 300
)

func CheckReady(ctx context.Context, db *sql.DB) error {
	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("ping PostgreSQL: %w", err)
	}

	var version int64
	if err := db.QueryRowContext(ctx, `
		SELECT COALESCE(MAX(version_id), 0)
		FROM goose_db_version
		WHERE is_applied
	`).Scan(&version); err != nil {
		return fmt.Errorf("read PostgreSQL schema version: %w", err)
	}
	if version != CurrentSchemaVersion {
		return fmt.Errorf("PostgreSQL schema version is %d, want %d", version, CurrentSchemaVersion)
	}
	return nil
}

// MigrateUp applies pending migrations while holding a session-level advisory
// lock, so concurrently starting replicas run each migration exactly once; the
// others wait for the lock and then find nothing left to apply.
func MigrateUp(ctx context.Context, db *sql.DB) error {
	provider, err := newMigrationProvider(db)
	if err != nil {
		return err
	}
	started := time.Now()
	results, err := provider.Up(ctx)
	if err != nil {
		return fmt.Errorf("apply PostgreSQL migrations: %w", err)
	}
	for _, result := range results {
		slog.InfoContext(ctx, "applied PostgreSQL migration", "version", result.Source.Version, "duration", result.Duration)
	}
	version, err := provider.GetDBVersion(ctx)
	if err != nil {
		return fmt.Errorf("read PostgreSQL schema version: %w", err)
	}
	slog.InfoContext(ctx, "PostgreSQL schema is current", "version", version, "applied", len(results), "duration", time.Since(started))
	return nil
}

func newMigrationProvider(db *sql.DB) (*goose.Provider, error) {
	locker, err := lock.NewPostgresSessionLocker(
		lock.WithLockID(migrationLockID),
		lock.WithLockTimeout(migrationLockRetrySeconds, migrationLockRetryAttempts),
	)
	if err != nil {
		return nil, fmt.Errorf("configure PostgreSQL migration lock: %w", err)
	}
	migrations, err := fs.Sub(postgresmigrations.Migrations, migrationsDirectory)
	if err != nil {
		return nil, fmt.Errorf("load PostgreSQL migrations: %w", err)
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, db, migrations, goose.WithSessionLocker(locker))
	if err != nil {
		return nil, fmt.Errorf("configure PostgreSQL migrations: %w", err)
	}
	return provider, nil
}

func MigrateStatus(ctx context.Context, db *sql.DB) error {
	if err := configureGoose(); err != nil {
		return err
	}
	if err := goose.StatusContext(ctx, db, migrationsDirectory); err != nil {
		return fmt.Errorf("read PostgreSQL migration status: %w", err)
	}
	return nil
}

func configureGoose() error {
	goose.SetBaseFS(postgresmigrations.Migrations)
	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("configure PostgreSQL migrations: %w", err)
	}
	return nil
}
