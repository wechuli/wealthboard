package auth

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/wechuli/wealthboard/internal/config"
	wealthdb "github.com/wechuli/wealthboard/internal/database"
)

func openAuthTestDatabase(t *testing.T) *sql.DB {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}

	ctx := context.Background()
	admin, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open admin database: %v", err)
	}

	schema := fmt.Sprintf("wealthboard_auth_test_%d", time.Now().UnixNano())
	if _, err := admin.ExecContext(ctx, "CREATE SCHEMA "+schema); err != nil {
		admin.Close()
		t.Fatalf("create test schema: %v", err)
	}

	schemaURL, err := url.Parse(databaseURL)
	if err != nil {
		admin.Close()
		t.Fatalf("parse TEST_DATABASE_URL: %v", err)
	}
	query := schemaURL.Query()
	query.Set("search_path", schema)
	schemaURL.RawQuery = query.Encode()

	db, err := wealthdb.Open(ctx, config.Database{
		URL:             schemaURL.String(),
		MaxOpenConns:    2,
		MaxIdleConns:    1,
		ConnMaxLifetime: time.Minute,
		ConnMaxIdleTime: time.Minute,
		PingTimeout:     5 * time.Second,
	})
	if err != nil {
		admin.Close()
		t.Fatalf("open test database: %v", err)
	}
	if err := wealthdb.MigrateUp(ctx, db); err != nil {
		db.Close()
		admin.Close()
		t.Fatalf("apply migrations: %v", err)
	}

	t.Cleanup(func() {
		db.Close()
		if _, err := admin.ExecContext(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Errorf("drop test schema: %v", err)
		}
		admin.Close()
	})
	return db
}
