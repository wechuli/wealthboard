package service

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/wechuli/wealthboard/internal/database/generated"
)

func TestOverviewQueriesAreOwnerScoped(t *testing.T) {
	db := openServiceTestDatabase(t)
	ctx := context.Background()
	userOne, userTwo := uuid.New(), uuid.New()
	categoryOne, categoryTwo := uuid.New(), uuid.New()
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users (id, username, created_at, updated_at) VALUES ($1,$2,now(),now())`, []any{userOne, "overview-a-" + userOne.String()}},
		{`INSERT INTO users (id, username, created_at, updated_at) VALUES ($1,$2,now(),now())`, []any{userTwo, "overview-b-" + userTwo.String()}},
		{`INSERT INTO user_settings (id,user_id,display_name,created_at,updated_at) VALUES ($1,$2,'A',now(),now())`, []any{uuid.New(), userOne}},
		{`INSERT INTO user_settings (id,user_id,display_name,created_at,updated_at) VALUES ($1,$2,'B',now(),now())`, []any{uuid.New(), userTwo}},
		{`INSERT INTO categories (id,user_id,name,slug,created_at,updated_at) VALUES ($1,$2,'Cash','cash',now(),now())`, []any{categoryOne, userOne}},
		{`INSERT INTO categories (id,user_id,name,slug,created_at,updated_at) VALUES ($1,$2,'Cash','cash',now(),now())`, []any{categoryTwo, userTwo}},
		{`INSERT INTO accounts (id,user_id,name,category_id,currency,current_value_minor,created_at,updated_at) VALUES ($1,$2,'A account',$3,'KES',100,now(),now())`, []any{uuid.New(), userOne, categoryOne}},
		{`INSERT INTO accounts (id,user_id,name,category_id,currency,current_value_minor,created_at,updated_at) VALUES ($1,$2,'B account',$3,'KES',999,now(),now())`, []any{uuid.New(), userTwo, categoryTwo}},
	} {
		if _, err := db.ExecContext(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed overview: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = ANY($1)`, []uuid.UUID{userOne, userTwo})
	})

	overview, err := NewOverviewService(generated.New(db)).Get(ctx, userOne)
	if err != nil {
		t.Fatalf("get owner overview: %v", err)
	}
	if overview.AccountCount != 1 || overview.Accounts[0].Name != "A account" || overview.Totals.NetWorth != "100" {
		t.Fatalf("owner overview leaked data: %+v", overview)
	}
}
