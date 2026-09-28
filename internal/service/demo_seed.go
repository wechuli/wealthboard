package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

type DemoSeeder struct {
	db  *sql.DB
	now func() time.Time
}

type demoCategory struct {
	name, slug, icon, assetOrLiability string
	isLiquid, isInvestible             bool
}

type demoAccount struct {
	name, categorySlug, currency     string
	valueMinor                       int64
	institutionName, institutionType string
}

var demoCategories = []demoCategory{
	{"Securities", "securities", "ChartCandlestick", "asset", false, true},
	{"Money Market Fund", "money-market-fund", "Landmark", "asset", true, true},
	{"Fixed Income", "fixed-income", "BadgeDollarSign", "asset", true, true},
	{"Savings", "savings", "PiggyBank", "asset", true, true},
	{"Cash", "cash", "WalletCards", "asset", true, true},
	{"Land and Real Estate", "land-real-estate", "House", "asset", false, false},
	{"Vehicle", "vehicle", "CarFront", "asset", false, false},
	{"Retirement", "retirement", "Umbrella", "asset", false, true},
	{"Business", "business", "BriefcaseBusiness", "asset", false, true},
	{"Other Asset", "other-asset", "Gem", "asset", false, false},
	{"Liability", "liability", "CreditCard", "liability", false, false},
}

var demoAccounts = []demoAccount{
	{"Zimele Fixed Income Fund", "fixed-income", "KES", 457691800, "Zimele", "asset_manager"},
	{"Madison Money Market Fund", "money-market-fund", "KES", 139600000, "Madison", "asset_manager"},
	{"KCB Car Fund", "money-market-fund", "KES", 11961700, "KCB", "bank"},
	{"Interactive Brokers VWRA", "securities", "USD", 411100, "Interactive Brokers", "brokerage"},
	{"Southern Bypass Land", "land-real-estate", "KES", 500000000, "", ""},
	{"Honda Fit", "vehicle", "KES", 75000000, "", ""},
}

func NewDemoSeeder(db *sql.DB) *DemoSeeder {
	return &DemoSeeder{db: db, now: time.Now}
}

func (seeder *DemoSeeder) Seed(ctx context.Context, username string, enabled bool) error {
	if !enabled {
		return errors.New("demo seeding is disabled; set DEMO_DATA=true to opt in")
	}
	username = strings.ToLower(strings.TrimSpace(username))
	if username == "" {
		return errors.New("an existing username is required")
	}

	tx, err := seeder.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin demo seed: %w", err)
	}
	defer tx.Rollback()

	var userID uuid.UUID
	if err := tx.QueryRowContext(ctx, `SELECT id FROM users WHERE username = $1`, username).Scan(&userID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return errors.New("the target user was not found")
		}
		return fmt.Errorf("find target user: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, userID.String()+":demo-seed"); err != nil {
		return fmt.Errorf("lock demo seed: %w", err)
	}

	now := seeder.now().UTC()
	for index, category := range demoCategories {
		_, err := tx.ExecContext(ctx, `
INSERT INTO categories (
    id, user_id, name, slug, icon, display_order, asset_or_liability,
    is_liquid, is_investible, is_archived, is_system, created_at, updated_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE,TRUE,$10,$10)
ON CONFLICT (user_id, slug) DO NOTHING`, demoID(userID, "category", category.slug), userID,
			category.name, category.slug, category.icon, index, category.assetOrLiability,
			category.isLiquid, category.isInvestible, now)
		if err != nil {
			return fmt.Errorf("seed category %s: %w", category.slug, err)
		}
	}

	if _, err := tx.ExecContext(ctx, `
INSERT INTO exchange_rates (id, user_id, base_currency, quote_currency, rate, effective_date, source, created_at)
VALUES ($1,$2,'USD','KES',130,'2025-01-01','demo',$3)
ON CONFLICT (user_id, base_currency, quote_currency, effective_date) DO NOTHING`,
		demoID(userID, "exchange-rate", "USD-KES-2025-01-01"), userID, now); err != nil {
		return fmt.Errorf("seed exchange rate: %w", err)
	}

	accountIDs := make(map[string]uuid.UUID, len(demoAccounts))
	for _, account := range demoAccounts {
		accountID, inserted, err := seedDemoAccount(ctx, tx, userID, account, now)
		if err != nil {
			return err
		}
		accountIDs[account.name] = accountID
		if inserted {
			_, err = tx.ExecContext(ctx, `
INSERT INTO transactions (
    id, user_id, account_id, type, amount_minor, currency, transaction_date,
    description, external_id, created_at, updated_at
) VALUES ($1,$2,$3,'opening_balance',$4,$5,'2025-01-01',
          'Fictional demo opening balance',$6,$7,$7)
ON CONFLICT (user_id, account_id, external_id) DO NOTHING`,
				demoID(userID, "transaction", account.name), userID, accountID, account.valueMinor,
				account.currency, "demo-opening-balance", now)
			if err != nil {
				return fmt.Errorf("seed opening balance for %s: %w", account.name, err)
			}
		}
	}

	carFundID := accountIDs["KCB Car Fund"]
	goalID := demoID(userID, "goal", "2028-family-car")
	result, err := tx.ExecContext(ctx, `
INSERT INTO goals (
    id, user_id, name, description, target_amount_minor, current_amount_minor,
    currency, target_date, linked_account_id, icon, status, priority,
    assumed_annual_return_bps, created_at, updated_at
)
SELECT $1,$2,'2028 Family Car','Fictional demonstration goal',325000000,0,
       'KES','2028-07-01',$3,'Target','active',1,800,$4,$4
WHERE NOT EXISTS (SELECT 1 FROM goals WHERE user_id = $2 AND name = '2028 Family Car')
ON CONFLICT DO NOTHING`, goalID, userID, carFundID, now)
	if err != nil {
		return fmt.Errorf("seed demo goal: %w", err)
	}
	if inserted, err := result.RowsAffected(); err != nil {
		return fmt.Errorf("inspect demo goal: %w", err)
	} else if inserted == 1 {
		if _, err := tx.ExecContext(ctx, `
INSERT INTO goal_contribution_plans (
    id, user_id, goal_id, planned_contribution_minor, frequency, start_date, end_date, created_at, updated_at
) VALUES ($1,$2,$3,12000000,'monthly','2026-01-01','2028-07-01',$4,$4)
ON CONFLICT (id) DO NOTHING`, demoID(userID, "goal-plan", "2028-family-car"), userID, goalID, now); err != nil {
			return fmt.Errorf("seed demo goal contribution plan: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE accounts SET goal_id = $1, updated_at = $3 WHERE user_id = $2 AND id = $4`, goalID, userID, now, carFundID); err != nil {
			return fmt.Errorf("link demo goal account: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit demo seed: %w", err)
	}
	return nil
}

func seedDemoAccount(ctx context.Context, tx *sql.Tx, userID uuid.UUID, account demoAccount, now time.Time) (uuid.UUID, bool, error) {
	var existingID uuid.UUID
	if err := tx.QueryRowContext(ctx, `SELECT id FROM accounts WHERE user_id = $1 AND name = $2 ORDER BY created_at LIMIT 1`, userID, account.name).Scan(&existingID); err == nil {
		return existingID, false, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, false, fmt.Errorf("find demo account %s: %w", account.name, err)
	}

	var categoryID uuid.UUID
	if err := tx.QueryRowContext(ctx, `SELECT id FROM categories WHERE user_id = $1 AND slug = $2`, userID, account.categorySlug).Scan(&categoryID); err != nil {
		return uuid.Nil, false, fmt.Errorf("find demo category %s: %w", account.categorySlug, err)
	}
	var institutionID *uuid.UUID
	if account.institutionName != "" {
		id := demoID(userID, "institution", strings.ToLower(account.institutionName))
		var archivedAt sql.NullTime
		err := tx.QueryRowContext(ctx, `SELECT id, archived_at FROM institutions WHERE user_id = $1 AND normalized_name = $2`, userID, strings.ToLower(account.institutionName)).Scan(&id, &archivedAt)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return uuid.Nil, false, fmt.Errorf("find demo institution %s: %w", account.institutionName, err)
		}
		if archivedAt.Valid {
			return uuid.Nil, false, fmt.Errorf("restore demo institution %s before seeding accounts", account.institutionName)
		}
		if errors.Is(err, sql.ErrNoRows) {
			if _, err := tx.ExecContext(ctx, `
INSERT INTO institutions (id, user_id, name, normalized_name, type, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$6)
ON CONFLICT (user_id, normalized_name) DO NOTHING`, id, userID, account.institutionName,
				strings.ToLower(account.institutionName), account.institutionType, now); err != nil {
				return uuid.Nil, false, fmt.Errorf("seed institution %s: %w", account.institutionName, err)
			}
		}
		institutionID = &id
	}

	accountID := demoID(userID, "account", account.name)
	if _, err := tx.ExecContext(ctx, `
INSERT INTO accounts (
    id, user_id, name, category_id, institution_id, currency, tracking_mode,
    current_value_minor, is_liability, is_included_in_net_worth, opened_at, created_at, updated_at
) VALUES ($1,$2,$3,$4,$5,$6,'balance',$7,FALSE,TRUE,'2025-01-01',$8,$8)`,
		accountID, userID, account.name, categoryID, institutionID, account.currency, account.valueMinor, now); err != nil {
		return uuid.Nil, false, fmt.Errorf("seed account %s: %w", account.name, err)
	}
	return accountID, true, nil
}

func demoID(userID uuid.UUID, kind, key string) uuid.UUID {
	return uuid.NewSHA1(userID, []byte(kind+":"+key))
}
