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
	if tableCount != 35 {
		t.Fatalf("application table count = %d, want 35", tableCount)
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

func TestPostgreSQLMigrationsRunOnceAcrossConcurrentReplicas(t *testing.T) {
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
	schema := fmt.Sprintf("wealthboard_concurrent_%d", time.Now().UnixNano())
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

	const replicas = 4
	databases := make([]*sql.DB, replicas)
	for index := range databases {
		databases[index], err = Open(ctx, config.Database{
			URL:             schemaURL.String(),
			MaxOpenConns:    2,
			MaxIdleConns:    1,
			ConnMaxLifetime: time.Minute,
			ConnMaxIdleTime: time.Minute,
			PingTimeout:     5 * time.Second,
		})
		if err != nil {
			t.Fatalf("open replica database: %v", err)
		}
		defer databases[index].Close()
	}

	start := make(chan struct{})
	errs := make(chan error, replicas)
	for _, db := range databases {
		go func() {
			<-start
			errs <- MigrateUp(ctx, db)
		}()
	}
	close(start)
	for range replicas {
		if err := <-errs; err != nil {
			t.Fatalf("concurrent migration failed: %v", err)
		}
	}

	if err := CheckReady(ctx, databases[0]); err != nil {
		t.Fatalf("migrated database is not ready: %v", err)
	}
	var applied, distinct int
	if err := databases[0].QueryRowContext(ctx, `
		SELECT count(*), count(DISTINCT version_id)
		FROM goose_db_version
		WHERE version_id > 0 AND is_applied
	`).Scan(&applied, &distinct); err != nil {
		t.Fatalf("read migration history: %v", err)
	}
	if applied != int(CurrentSchemaVersion) || distinct != int(CurrentSchemaVersion) {
		t.Fatalf("migration history has %d rows for %d versions, want each of %d versions once", applied, distinct, CurrentSchemaVersion)
	}
	assertCompleteSchema(t, ctx, databases[0])
}

func TestPostgreSQLPortfolioReviewRemovalUpgradesAndRollsBack(t *testing.T) {
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
	schema := fmt.Sprintf("wealthboard_review_removal_%d", time.Now().UnixNano())
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
	db, err := Open(ctx, config.Database{URL: schemaURL.String(), MaxOpenConns: 2, MaxIdleConns: 1, ConnMaxLifetime: time.Minute, ConnMaxIdleTime: time.Minute, PingTimeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	provider, err := newMigrationProvider(db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.UpTo(ctx, 5); err != nil {
		t.Fatalf("migrate to the previous version: %v", err)
	}

	const ownerID, foreignID = "00000000-0000-0000-0000-0000000000a1", "00000000-0000-0000-0000-0000000000b2"
	for _, statement := range []string{
		`INSERT INTO users (id, username, created_at, updated_at) VALUES ('` + ownerID + `', 'review-owner', now(), now()), ('` + foreignID + `', 'review-foreign', now(), now())`,
		`INSERT INTO ai_provider_settings (id, user_id, provider, base_url, model, include_exact_amounts, include_account_names, monthly_token_limit, max_output_tokens, created_at, updated_at)
		 VALUES (gen_random_uuid(), '` + ownerID + `', 'openai', 'https://api.openai.com/v1', 'gpt-5.5', true, true, 50000, 1200, now(), now()),
		        (gen_random_uuid(), '` + foreignID + `', 'anthropic', 'https://api.anthropic.com', 'claude-sonnet-5', false, false, 70000, 900, now(), now())`,
		`INSERT INTO ai_usage_events (id, user_id, provider, endpoint_host, model, status, billing_month, created_at, updated_at)
		 VALUES (gen_random_uuid(), '` + ownerID + `', 'openai', 'api.openai.com', 'gpt-5.5', 'success', '2026-11', now(), now())`,
	} {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			t.Fatalf("seed version 5: %v", err)
		}
	}

	// Version 8 drops the AI tables, so this test stops at version 6.
	if _, err := provider.UpTo(ctx, 6); err != nil {
		t.Fatalf("upgrade: %v", err)
	}
	assertAISharingColumns(t, ctx, db, 0)
	var limits string
	if err := db.QueryRowContext(ctx, `SELECT string_agg(user_id::text || ':' || monthly_token_limit || ':' || max_output_tokens, ',' ORDER BY user_id) FROM ai_provider_settings`).Scan(&limits); err != nil {
		t.Fatal(err)
	}
	if limits != ownerID+":50000:1200,"+foreignID+":70000:900" {
		t.Fatalf("provider settings after upgrade = %s", limits)
	}
	var historical, defaulted string
	if err := db.QueryRowContext(ctx, `SELECT request_type FROM ai_usage_events WHERE user_id = $1`, ownerID).Scan(&historical); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO ai_usage_events (id, user_id, provider, endpoint_host, model, status, billing_month, created_at, updated_at)
		VALUES (gen_random_uuid(), $1, 'anthropic', 'api.anthropic.com', 'claude-sonnet-5', 'started', '2026-11', now(), now())`, foreignID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, `SELECT request_type FROM ai_usage_events WHERE user_id = $1`, foreignID).Scan(&defaulted); err != nil {
		t.Fatal(err)
	}
	if historical != "portfolio_review" || defaulted != "import_conversion" {
		t.Fatalf("request types = %q (historical), %q (new default)", historical, defaulted)
	}

	if _, err := provider.DownTo(ctx, 5); err != nil {
		t.Fatalf("roll back: %v", err)
	}
	assertAISharingColumns(t, ctx, db, 2)
	var shared int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM ai_provider_settings WHERE include_exact_amounts OR include_account_names`).Scan(&shared); err != nil || shared != 0 {
		t.Fatalf("rolled-back sharing preferences = %d, %v; want private defaults", shared, err)
	}
	if _, err := provider.UpTo(ctx, 6); err != nil {
		t.Fatalf("re-apply after rollback: %v", err)
	}
	assertAISharingColumns(t, ctx, db, 0)
}

func TestPostgreSQLAIProviderRemovalUpgradesAndRollsBack(t *testing.T) {
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
	schema := fmt.Sprintf("wealthboard_ai_removal_%d", time.Now().UnixNano())
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
	db, err := Open(ctx, config.Database{URL: schemaURL.String(), MaxOpenConns: 2, MaxIdleConns: 1, ConnMaxLifetime: time.Minute, ConnMaxIdleTime: time.Minute, PingTimeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	provider, err := newMigrationProvider(db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.UpTo(ctx, 7); err != nil {
		t.Fatalf("migrate to the previous version: %v", err)
	}

	const ownerID, foreignID = "00000000-0000-0000-0000-0000000000a1", "00000000-0000-0000-0000-0000000000b2"
	key := func(name, user, scopes string) string {
		return `INSERT INTO api_keys (id, user_id, name, display_prefix, token_hash, scopes, created_at)
			VALUES (gen_random_uuid(), '` + user + `', '` + name + `', 'wbk_` + name + `', decode(md5('` + name + `'), 'hex'), '` + scopes + `'::JSONB, now())`
	}
	for _, statement := range []string{
		`INSERT INTO users (id, username, created_at, updated_at) VALUES ('` + ownerID + `', 'ai-owner', now(), now()), ('` + foreignID + `', 'ai-foreign', now(), now())`,
		`INSERT INTO ai_provider_settings (id, user_id, provider, base_url, model, encrypted_api_key, created_at, updated_at)
		 VALUES (gen_random_uuid(), '` + ownerID + `', 'openai', 'https://api.openai.com/v1', 'gpt-5.5', 'sealed', now(), now())`,
		`INSERT INTO ai_usage_events (id, user_id, provider, endpoint_host, model, status, billing_month, created_at, updated_at)
		 VALUES (gen_random_uuid(), '` + ownerID + `', 'openai', 'api.openai.com', 'gpt-5.5', 'success', '2026-11', now(), now())`,
		key("ai-only", ownerID, `["ai:invoke"]`),
		key("mixed", ownerID, `["ai:invoke","exports:read"]`),
		key("reader", foreignID, `["portfolio:read"]`),
	} {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			t.Fatalf("seed version 7: %v", err)
		}
	}

	if err := MigrateUp(ctx, db); err != nil {
		t.Fatalf("upgrade: %v", err)
	}
	if err := CheckReady(ctx, db); err != nil {
		t.Fatalf("upgraded database is not ready: %v", err)
	}
	assertAITables(t, ctx, db, 0)
	var keys string
	if err := db.QueryRowContext(ctx, `SELECT string_agg(name || '=' || scopes::text, ' ' ORDER BY name) FROM api_keys`).Scan(&keys); err != nil {
		t.Fatal(err)
	}
	// The AI-only key granted nothing else, so it is gone instead of falling back to the default read scope.
	if keys != `mixed=["exports:read"] reader=["portfolio:read"]` {
		t.Fatalf("API keys after upgrade = %s", keys)
	}
	if _, err := db.ExecContext(ctx, key("new-ai", foreignID, `["ai:invoke"]`)); err == nil {
		t.Fatal("a new key with ai:invoke was accepted")
	}

	if _, err := provider.DownTo(ctx, 7); err != nil {
		t.Fatalf("roll back: %v", err)
	}
	assertAITables(t, ctx, db, 2)
	if _, err := db.ExecContext(ctx, key("restored-ai", foreignID, `["ai:invoke"]`)); err != nil {
		t.Fatalf("rolled-back scope check rejects ai:invoke: %v", err)
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM api_keys WHERE name = 'restored-ai'`); err != nil {
		t.Fatal(err)
	}
	if err := MigrateUp(ctx, db); err != nil {
		t.Fatalf("re-apply after rollback: %v", err)
	}
	assertAITables(t, ctx, db, 0)
}

func assertAITables(t *testing.T, ctx context.Context, db *sql.DB, want int) {
	t.Helper()
	var got int
	if err := db.QueryRowContext(ctx, `
		SELECT count(*) FROM information_schema.tables
		WHERE table_schema = current_schema() AND table_name IN ('ai_provider_settings', 'ai_usage_events')`).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("AI tables = %d, want %d", got, want)
	}
}

func assertAISharingColumns(t *testing.T, ctx context.Context, db *sql.DB, want int) {
	t.Helper()
	var got int
	if err := db.QueryRowContext(ctx, `
		SELECT count(*) FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = 'ai_provider_settings'
		  AND column_name IN ('include_exact_amounts', 'include_account_names')`).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("AI sharing columns = %d, want %d", got, want)
	}
}

func TestPostgreSQLImportBatchesUpgradeIsolateUsersAndRollBack(t *testing.T) {
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
	schema := fmt.Sprintf("wealthboard_import_batches_%d", time.Now().UnixNano())
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
	db, err := Open(ctx, config.Database{URL: schemaURL.String(), MaxOpenConns: 2, MaxIdleConns: 1, ConnMaxLifetime: time.Minute, ConnMaxIdleTime: time.Minute, PingTimeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	provider, err := newMigrationProvider(db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.UpTo(ctx, 8); err != nil {
		t.Fatalf("migrate to the previous version: %v", err)
	}

	const ownerID, foreignID = "00000000-0000-0000-0000-0000000000a1", "00000000-0000-0000-0000-0000000000b2"
	const ownerAccount, foreignAccount = "00000000-0000-0000-0000-0000000000c1", "00000000-0000-0000-0000-0000000000c2"
	const transactionID = "00000000-0000-0000-0000-0000000000d1"
	for _, statement := range []string{
		`INSERT INTO users (id, username, created_at, updated_at) VALUES ('` + ownerID + `', 'batch-owner', now(), now()), ('` + foreignID + `', 'batch-foreign', now(), now())`,
		`INSERT INTO categories (id, user_id, name, slug, created_at, updated_at) VALUES
			('00000000-0000-0000-0000-0000000000e1', '` + ownerID + `', 'Cash', 'cash', now(), now()),
			('00000000-0000-0000-0000-0000000000e2', '` + foreignID + `', 'Cash', 'cash', now(), now())`,
		`INSERT INTO accounts (id, user_id, name, category_id, currency, created_at, updated_at) VALUES
			('` + ownerAccount + `', '` + ownerID + `', 'Owner', '00000000-0000-0000-0000-0000000000e1', 'KES', now(), now()),
			('` + foreignAccount + `', '` + foreignID + `', 'Foreign', '00000000-0000-0000-0000-0000000000e2', 'KES', now(), now())`,
		`INSERT INTO transactions (id, user_id, account_id, type, amount_minor, currency, transaction_date, created_at, updated_at)
			VALUES ('` + transactionID + `', '` + ownerID + `', '` + ownerAccount + `', 'deposit', 100, 'KES', '2026-01-01', now(), now())`,
	} {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			t.Fatalf("seed version 8: %v", err)
		}
	}

	if err := MigrateUp(ctx, db); err != nil {
		t.Fatalf("upgrade: %v", err)
	}
	if err := CheckReady(ctx, db); err != nil {
		t.Fatalf("upgraded database is not ready: %v", err)
	}
	var linked sql.NullString
	if err := db.QueryRowContext(ctx, `SELECT import_batch_id::TEXT FROM transactions WHERE id = $1`, transactionID).Scan(&linked); err != nil || linked.Valid {
		t.Fatalf("existing transaction batch = %v, %v", linked, err)
	}
	const foreignBatch = "00000000-0000-0000-0000-0000000000f2"
	if _, err := db.ExecContext(ctx, `INSERT INTO import_batches (id, user_id, account_id, kind, request_hash, created_at)
		VALUES ($1, $2, $3, 'transactions', 'hash', now())`, foreignBatch, foreignID, foreignAccount); err != nil {
		t.Fatalf("insert foreign batch: %v", err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE transactions SET import_batch_id = $1 WHERE id = $2`, foreignBatch, transactionID); err == nil {
		t.Fatal("a transaction was linked to another user's import batch")
	}
	if _, err := db.ExecContext(ctx, `UPDATE transactions SET cash_snapshot_minor = 1 WHERE id = $1`, transactionID); err == nil {
		t.Fatal("a deposit was accepted as a cash snapshot")
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO import_batches (id, user_id, account_id, kind, request_hash, created_at)
		VALUES (gen_random_uuid(), $1, $2, 'transactions', 'hash', now())`, ownerID, foreignAccount); err == nil {
		t.Fatal("an import batch was attached to another user's account")
	}

	if _, err := provider.DownTo(ctx, 8); err != nil {
		t.Fatalf("roll back: %v", err)
	}
	if err := MigrateUp(ctx, db); err != nil {
		t.Fatalf("re-apply after rollback: %v", err)
	}
}
