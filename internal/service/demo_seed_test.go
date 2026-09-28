package service

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
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
	db := openServiceTestDatabase(t)
	ctx := context.Background()
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
