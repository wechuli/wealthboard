package service

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/wechuli/wealthboard/internal/config"
	"github.com/wechuli/wealthboard/internal/database"
)

func TestDemoIDsAreStableAndNamespacedByUser(t *testing.T) {
	firstUser := uuid.MustParse("10000000-0000-0000-0000-000000000001")
	secondUser := uuid.MustParse("20000000-0000-0000-0000-000000000002")
	first := demoID(firstUser, "account", "KCB Car Fund")
	if first != demoID(firstUser, "account", "KCB Car Fund") {
		t.Fatal("demoID is not stable")
	}
	if first == demoID(secondUser, "account", "KCB Car Fund") {
		t.Fatal("demoID is not user scoped")
	}
	if first == demoID(firstUser, "goal", "KCB Car Fund") {
		t.Fatal("demoID is not record-type scoped")
	}
}

func TestDemoSeederRequiresOptInBeforeDatabaseAccess(t *testing.T) {
	err := NewDemoSeeder(nil).Seed(context.Background(), "demo-user", false)
	if err == nil || !strings.Contains(err.Error(), "DEMO_DATA=true") {
		t.Fatalf("Seed() error = %v", err)
	}
}

func TestDemoSeederIsGatedAndIdempotent(t *testing.T) {
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
	schema := fmt.Sprintf("wealthboard_demo_seed_%d", time.Now().UnixNano())
	if _, err := admin.ExecContext(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	defer admin.ExecContext(ctx, "DROP SCHEMA "+schema+" CASCADE")

	parsed, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse TEST_DATABASE_URL: %v", err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := database.Open(ctx, config.Database{
		URL: parsed.String(), MaxOpenConns: 2, MaxIdleConns: 1,
		ConnMaxLifetime: time.Minute, ConnMaxIdleTime: time.Minute, PingTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("open isolated database: %v", err)
	}
	defer db.Close()
	if err := database.MigrateUp(ctx, db); err != nil {
		t.Fatalf("migrate isolated database: %v", err)
	}
	userID := uuid.New()
	if _, err := db.ExecContext(ctx, `INSERT INTO users (id, username, created_at, updated_at) VALUES ($1,'demo-user',now(),now())`, userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}

	seeder := NewDemoSeeder(db)
	if err := seeder.Seed(ctx, "demo-user", false); err == nil || !strings.Contains(err.Error(), "DEMO_DATA=true") {
		t.Fatalf("disabled Seed() error = %v", err)
	}
	if err := seeder.Seed(ctx, "DEMO-USER", true); err != nil {
		t.Fatalf("first Seed() error = %v", err)
	}
	if err := seeder.Seed(ctx, "demo-user", true); err != nil {
		t.Fatalf("second Seed() error = %v", err)
	}

	for table, want := range map[string]int{
		"categories": 11, "accounts": 6, "transactions": 6, "exchange_rates": 1,
		"goals": 1, "goal_contribution_plans": 1,
	} {
		var count int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM "+table+" WHERE user_id = $1", userID).Scan(&count); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if count != want {
			t.Fatalf("%s count = %d, want %d", table, count, want)
		}
	}
}
