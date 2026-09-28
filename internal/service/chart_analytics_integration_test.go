package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestChartAnalyticsQueriesAreOwnerScoped(t *testing.T) {
	db := openServiceTestDatabase(t)
	ctx := context.Background()
	ownerID, foreignID := uuid.New(), uuid.New()
	ownerCategory, foreignCategory := uuid.New(), uuid.New()
	ownerAccount, foreignAccount := uuid.New(), uuid.New()
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users (id,username,created_at,updated_at) VALUES ($1,$2,now(),now())`, []any{ownerID, "charts-owner-" + ownerID.String()}},
		{`INSERT INTO users (id,username,created_at,updated_at) VALUES ($1,$2,now(),now())`, []any{foreignID, "charts-foreign-" + foreignID.String()}},
		{`INSERT INTO user_settings (id,user_id,display_name,base_currency,timezone,created_at,updated_at) VALUES ($1,$2,'Owner','KES','UTC',now(),now())`, []any{uuid.New(), ownerID}},
		{`INSERT INTO user_settings (id,user_id,display_name,base_currency,timezone,created_at,updated_at) VALUES ($1,$2,'Foreign','KES','UTC',now(),now())`, []any{uuid.New(), foreignID}},
		{`INSERT INTO categories (id,user_id,name,slug,is_liquid,created_at,updated_at) VALUES ($1,$2,'Cash','cash',true,now(),now())`, []any{ownerCategory, ownerID}},
		{`INSERT INTO categories (id,user_id,name,slug,is_liquid,created_at,updated_at) VALUES ($1,$2,'Cash','cash',true,now(),now())`, []any{foreignCategory, foreignID}},
		{`INSERT INTO accounts (id,user_id,name,category_id,currency,current_value_minor,created_at,updated_at) VALUES ($1,$2,'Owner account',$3,'KES',100,now(),now())`, []any{ownerAccount, ownerID, ownerCategory}},
		{`INSERT INTO accounts (id,user_id,name,category_id,currency,current_value_minor,created_at,updated_at) VALUES ($1,$2,'Foreign account',$3,'KES',999,now(),now())`, []any{foreignAccount, foreignID, foreignCategory}},
		{`INSERT INTO transactions (id,user_id,account_id,type,amount_minor,currency,transaction_date,created_at,updated_at) VALUES ($1,$2,$3,'opening_balance',100,'KES','2026-01-01',now(),now())`, []any{uuid.New(), ownerID, ownerAccount}},
		{`INSERT INTO transactions (id,user_id,account_id,type,amount_minor,currency,transaction_date,created_at,updated_at) VALUES ($1,$2,$3,'opening_balance',999,'KES','2026-01-01',now(),now())`, []any{uuid.New(), foreignID, foreignAccount}},
	} {
		if _, err := db.ExecContext(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed chart analytics: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = ANY($1)`, []uuid.UUID{ownerID, foreignID})
	})

	service := NewGoalsReportsService(NewSQLGoalsReportsRepository(db))
	service.now = func() time.Time { return time.Date(2026, 2, 1, 12, 0, 0, 0, time.UTC) }
	dashboard, err := service.Dashboard(ctx, ownerID, "all")
	if err != nil {
		t.Fatalf("owner dashboard: %v", err)
	}
	if dashboard.Totals.NetWorth != "100" || len(dashboard.History) < 2 {
		t.Fatalf("owner dashboard leaked or omitted history: %+v", dashboard)
	}
	if dashboard.PeriodChanges.OneMonth == nil || *dashboard.PeriodChanges.OneMonth != "0" ||
		dashboard.PeriodChanges.ThreeMonths == nil || *dashboard.PeriodChanges.ThreeMonths != "100" ||
		dashboard.PeriodChanges.OneYear == nil || *dashboard.PeriodChanges.OneYear != "100" ||
		dashboard.PeriodChanges.AllTime == nil || *dashboard.PeriodChanges.AllTime != "100" {
		t.Fatalf("dashboard period changes = %+v", dashboard.PeriodChanges)
	}
	analytics, err := service.AccountAnalytics(ctx, ownerID, ownerAccount)
	if err != nil {
		t.Fatalf("owner account analytics: %v", err)
	}
	if analytics.Metrics.ContributionsMinor != "100" || analytics.Metrics.IncomeMinor != "0" || analytics.Metrics.EstimatedGainMinor != "0" {
		t.Fatalf("owner account metrics = %+v", analytics.Metrics)
	}
	coreReads := NewCoreReadService(NewSQLCoreReadRepository(db))
	coreReads.now = service.now
	accounts, err := coreReads.Accounts(ctx, ownerID, "active")
	if err != nil {
		t.Fatalf("owner account list: %v", err)
	}
	if len(accounts) != 1 || accounts[0].ID != ownerAccount || accounts[0].ConvertedValueMinor == nil || *accounts[0].ConvertedValueMinor != "100" || accounts[0].MonthlyChangeMinor == nil || *accounts[0].MonthlyChangeMinor != "0" {
		t.Fatalf("owner account-list analytics = %+v", accounts)
	}
	account, err := coreReads.Account(ctx, ownerID, ownerAccount)
	if err != nil || account.ConvertedValueMinor == nil || *account.ConvertedValueMinor != "100" || account.MonthlyChangeMinor == nil || *account.MonthlyChangeMinor != "0" {
		t.Fatalf("owner account-detail analytics = %+v, err=%v", account, err)
	}
	if _, err := coreReads.Account(ctx, ownerID, foreignAccount); !errors.Is(err, ErrCoreReadNotFound) {
		t.Fatalf("foreign account detail error = %v, want not found", err)
	}
	if _, err := service.AccountAnalytics(ctx, ownerID, foreignAccount); !errors.Is(err, ErrGoalsReportsNotFound) {
		t.Fatalf("foreign account analytics error = %v, want not found", err)
	}

	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`UPDATE accounts SET currency='USD' WHERE user_id=$1 AND id=$2`, []any{ownerID, ownerAccount}},
		{`UPDATE transactions SET currency='USD' WHERE user_id=$1 AND account_id=$2`, []any{ownerID, ownerAccount}},
		{`INSERT INTO exchange_rates (id,user_id,base_currency,quote_currency,rate,effective_date,source,created_at) VALUES ($1,$2,'USD','KES',9,'2026-01-01','test',now())`, []any{uuid.New(), foreignID}},
		{`INSERT INTO exchange_rates (id,user_id,base_currency,quote_currency,rate,effective_date,source,created_at) VALUES ($1,$2,'USD','KES',4,'2026-02-02','test',now())`, []any{uuid.New(), ownerID}},
	} {
		if _, err := db.ExecContext(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed account-detail currency coverage: %v", err)
		}
	}
	account, err = coreReads.Account(ctx, ownerID, ownerAccount)
	if err != nil || account.ConvertedValueMinor != nil || account.MonthlyChangeMinor != nil {
		t.Fatalf("foreign or future rate valued account detail: account=%+v err=%v", account, err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO exchange_rates (id,user_id,base_currency,quote_currency,rate,effective_date,source,created_at)
		VALUES ($1,$2,'USD','KES',2,'2026-01-01','test',now())
	`, uuid.New(), ownerID); err != nil {
		t.Fatalf("seed applicable owner rate: %v", err)
	}
	account, err = coreReads.Account(ctx, ownerID, ownerAccount)
	if err != nil || account.ConvertedValueMinor == nil || *account.ConvertedValueMinor != "200" || account.MonthlyChangeMinor == nil || *account.MonthlyChangeMinor != "0" {
		t.Fatalf("dated owner account-detail conversion = %+v, err=%v", account, err)
	}
}
