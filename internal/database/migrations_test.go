package database

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/wechuli/wealthboard/internal/config"
)

func TestPostgreSQLMigrations(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}

	ctx := context.Background()
	admin, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open admin database: %v", err)
	}
	defer admin.Close()

	schema := fmt.Sprintf("wealthboard_test_%d", time.Now().UnixNano())
	if _, err := admin.ExecContext(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatalf("create test schema: %v", err)
	}
	defer func() {
		if _, err := admin.ExecContext(ctx, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Errorf("drop test schema: %v", err)
		}
	}()

	schemaURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse TEST_DATABASE_URL: %v", err)
	}
	query := schemaURL.Query()
	query.Set("search_path", schema)
	schemaURL.RawQuery = query.Encode()

	db, err := Open(ctx, config.Database{
		URL:             schemaURL.String(),
		MaxOpenConns:    2,
		MaxIdleConns:    1,
		ConnMaxLifetime: time.Minute,
		ConnMaxIdleTime: time.Minute,
		PingTimeout:     5 * time.Second,
	})
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	if err := CheckReady(ctx, db); err == nil {
		t.Fatal("expected an unmigrated database to be unavailable")
	}
	if err := MigrateUp(ctx, db); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}
	if err := MigrateUp(ctx, db); err != nil {
		t.Fatalf("reapply migrations: %v", err)
	}
	if err := CheckReady(ctx, db); err != nil {
		t.Fatalf("migrated database is not ready: %v", err)
	}

	var tableCount int
	if err := db.QueryRowContext(ctx, `
		SELECT count(*)
		FROM information_schema.tables
		WHERE table_schema = current_schema()
		  AND table_name = ANY($1)
	`, []string{"users", "oidc_identities", "user_settings", "categories", "institutions", "accounts", "api_keys"}).Scan(&tableCount); err != nil {
		t.Fatalf("count migrated tables: %v", err)
	}
	if tableCount != 7 {
		t.Fatalf("foundational table count = %d, want 7", tableCount)
	}

	assertCompleteSchema(t, ctx, db)
	assertCrossUserCategoryRejected(t, ctx, db)
}

func assertCompleteSchema(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()
	var tableCount int
	if err := db.QueryRowContext(ctx, `
		SELECT count(*)
		FROM information_schema.tables
		WHERE table_schema = current_schema()
		  AND table_name <> 'goose_db_version'
	`).Scan(&tableCount); err != nil {
		t.Fatalf("count complete schema: %v", err)
	}
	if tableCount != 29 {
		t.Fatalf("application table count = %d, want 29", tableCount)
	}

	var amountType string
	if err := db.QueryRowContext(ctx, `
		SELECT data_type
		FROM information_schema.columns
		WHERE table_schema = current_schema()
		  AND table_name = 'transactions'
		  AND column_name = 'amount_minor'
	`).Scan(&amountType); err != nil {
		t.Fatalf("read amount_minor type: %v", err)
	}
	if amountType != "bigint" {
		t.Fatalf("transactions.amount_minor type = %q, want bigint", amountType)
	}

	var rateType string
	if err := db.QueryRowContext(ctx, `
		SELECT data_type
		FROM information_schema.columns
		WHERE table_schema = current_schema()
		  AND table_name = 'exchange_rates'
		  AND column_name = 'rate'
	`).Scan(&rateType); err != nil {
		t.Fatalf("read exchange rate type: %v", err)
	}
	if rateType != "numeric" {
		t.Fatalf("exchange_rates.rate type = %q, want numeric", rateType)
	}
}

func assertCrossUserCategoryRejected(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()
	const userOne = "00000000-0000-0000-0000-000000000001"
	const userTwo = "00000000-0000-0000-0000-000000000002"
	const categoryID = "00000000-0000-0000-0000-000000000003"
	const accountID = "00000000-0000-0000-0000-000000000004"

	for _, userID := range []string{userOne, userTwo} {
		if _, err := db.ExecContext(ctx, `
			INSERT INTO users (id, username, created_at, updated_at)
			VALUES ($1, $2, now(), now())
		`, userID, "user-"+userID); err != nil {
			t.Fatalf("insert user: %v", err)
		}
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO categories (id, user_id, name, slug, created_at, updated_at)
		VALUES ($1, $2, 'Cash', 'cash', now(), now())
	`, categoryID, userOne); err != nil {
		t.Fatalf("insert category: %v", err)
	}

	if _, err := db.ExecContext(ctx, `
		INSERT INTO accounts (
			id, user_id, name, category_id, currency, created_at, updated_at
		) VALUES ($1, $2, 'Foreign account', $3, 'KES', now(), now())
	`, accountID, userTwo, categoryID); err == nil {
		t.Fatal("expected cross-user category reference to fail")
	}
}
