package service

import (
	"context"
	"database/sql"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/wechuli/wealthboard/internal/config"
	"github.com/wechuli/wealthboard/internal/database"
)

func openServiceTestDatabase(t *testing.T) *sql.DB {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	schemaURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse TEST_DATABASE_URL: %v", err)
	}
	admin, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open test database administrator connection: %v", err)
	}
	t.Cleanup(func() {
		if err := admin.Close(); err != nil {
			t.Errorf("close test database administrator connection: %v", err)
		}
	})

	ctx := context.Background()
	schema := "wealthboard_service_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := admin.ExecContext(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatalf("create service test schema: %v", err)
	}
	t.Cleanup(func() {
		if _, err := admin.ExecContext(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Errorf("drop service test schema: %v", err)
		}
	})

	query := schemaURL.Query()
	query.Set("search_path", schema)
	schemaURL.RawQuery = query.Encode()
	db, err := database.Open(ctx, config.Database{
		URL:             schemaURL.String(),
		MaxOpenConns:    10,
		MaxIdleConns:    2,
		ConnMaxLifetime: time.Minute,
		ConnMaxIdleTime: time.Minute,
		PingTimeout:     5 * time.Second,
	})
	if err != nil {
		t.Fatalf("open isolated service test database: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Errorf("close service test database: %v", err)
		}
	})
	if err := database.MigrateUp(ctx, db); err != nil {
		t.Fatalf("migrate service test schema: %v", err)
	}
	return db
}

func TestServiceTestDatabaseMigratesIsolatesAndCleansUp(t *testing.T) {
	observer := openServiceTestDatabase(t)
	ctx := context.Background()
	var schema string
	userID := uuid.New()

	t.Run("isolated schema", func(t *testing.T) {
		db := openServiceTestDatabase(t)
		if err := database.CheckReady(ctx, db); err != nil {
			t.Fatalf("fresh service test schema is not ready: %v", err)
		}
		if err := db.QueryRowContext(ctx, "SELECT current_schema()").Scan(&schema); err != nil {
			t.Fatalf("read service test schema: %v", err)
		}
		if _, err := db.ExecContext(ctx, `
			INSERT INTO users (id, username, created_at, updated_at)
			VALUES ($1, 'isolated-fixture-user', now(), now())
		`, userID); err != nil {
			t.Fatalf("insert isolated fixture user: %v", err)
		}

		for index := 0; index < 2; index++ {
			connection, err := db.Conn(ctx)
			if err != nil {
				t.Fatalf("acquire fixture connection: %v", err)
			}
			defer connection.Close()
			var connectionSchema string
			var count int
			if err := connection.QueryRowContext(ctx, "SELECT current_schema(), count(*) FROM users WHERE id=$1", userID).Scan(&connectionSchema, &count); err != nil {
				t.Fatalf("read isolated fixture connection: %v", err)
			}
			if connectionSchema != schema || count != 1 {
				t.Fatalf("fixture connection schema=%q users=%d, want schema=%q users=1", connectionSchema, count, schema)
			}
		}
		var count int
		if err := observer.QueryRowContext(ctx, "SELECT count(*) FROM users WHERE id=$1", userID).Scan(&count); err != nil {
			t.Fatalf("check fixture isolation: %v", err)
		}
		if count != 0 {
			t.Fatalf("another fixture contains %d private users, want none", count)
		}
	})

	var exists bool
	if err := observer.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname=$1)", schema).Scan(&exists); err != nil {
		t.Fatalf("check fixture cleanup: %v", err)
	}
	if exists {
		t.Fatal("service test schema remains after cleanup")
	}
}
