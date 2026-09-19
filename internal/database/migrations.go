package database

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/pressly/goose/v3"

	postgresmigrations "github.com/wechuli/wealthboard/db/postgres"
)

const migrationsDirectory = "migrations"
const CurrentSchemaVersion int64 = 3

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

func MigrateUp(ctx context.Context, db *sql.DB) error {
	if err := configureGoose(); err != nil {
		return err
	}
	if err := goose.UpContext(ctx, db, migrationsDirectory); err != nil {
		return fmt.Errorf("apply PostgreSQL migrations: %w", err)
	}
	return nil
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
