package service

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestAccountConversionPostgreSQLPreviewExecuteOwnershipAndIdempotency(t *testing.T) {
	db := openServiceTestDatabase(t)
	ctx := context.Background()
	ownerID, secondUserID := uuid.New(), uuid.New()
	ownerCategoryID, secondCategoryID := uuid.New(), uuid.New()
	sourceID, foreignSourceID, instrumentID := uuid.New(), uuid.New(), uuid.New()
	goalID, estatePlanID, directiveID := uuid.New(), uuid.New(), uuid.New()
	conversionDate := time.Date(2026, time.September, 20, 0, 0, 0, 0, time.UTC)

	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users (id,username,created_at,updated_at) VALUES ($1,$2,now(),now())`, []any{ownerID, "conversion-owner-" + ownerID.String()}},
		{`INSERT INTO users (id,username,created_at,updated_at) VALUES ($1,$2,now(),now())`, []any{secondUserID, "conversion-second-" + secondUserID.String()}},
		{`INSERT INTO user_settings (id,user_id,display_name,base_currency,supported_currencies,timezone,created_at,updated_at) VALUES ($1,$2,'Owner','KES','["KES"]','Africa/Nairobi',now(),now())`, []any{uuid.New(), ownerID}},
		{`INSERT INTO user_settings (id,user_id,display_name,base_currency,supported_currencies,timezone,created_at,updated_at) VALUES ($1,$2,'Second','KES','["KES"]','UTC',now(),now())`, []any{uuid.New(), secondUserID}},
		{`INSERT INTO categories (id,user_id,name,slug,asset_or_liability,is_investible,created_at,updated_at) VALUES ($1,$2,'Investments',$3,'asset',true,now(),now())`, []any{ownerCategoryID, ownerID, "investments-" + ownerCategoryID.String()}},
		{`INSERT INTO categories (id,user_id,name,slug,asset_or_liability,is_investible,created_at,updated_at) VALUES ($1,$2,'Private',$3,'asset',true,now(),now())`, []any{secondCategoryID, secondUserID, "private-" + secondCategoryID.String()}},
		{`INSERT INTO accounts (id,user_id,name,category_id,currency,tracking_mode,current_value_minor,created_at,updated_at) VALUES ($1,$2,'Legacy brokerage',$3,'KES','balance',1000,now(),now())`, []any{sourceID, ownerID, ownerCategoryID}},
		{`INSERT INTO accounts (id,user_id,name,category_id,currency,tracking_mode,current_value_minor,created_at,updated_at) VALUES ($1,$2,'Foreign brokerage',$3,'KES','balance',1000,now(),now())`, []any{foreignSourceID, secondUserID, secondCategoryID}},
		{`INSERT INTO transactions (id,user_id,account_id,type,amount_minor,currency,transaction_date,description,created_at,updated_at) VALUES ($1,$2,$3,'opening_balance',1000,'KES','2026-09-01','Opening',now(),now())`, []any{uuid.New(), ownerID, sourceID}},
		{`INSERT INTO investment_instruments (id,user_id,external_id,name,symbol,identifier_type,asset_type,quote_currency,created_at,updated_at) VALUES ($1,$2,$3,'Exact Fund','EXACT','custom','fund','KES',now(),now())`, []any{instrumentID, ownerID, "manual:" + instrumentID.String()}},
		{`INSERT INTO goals (id,user_id,name,target_amount_minor,current_amount_minor,currency,target_date,linked_account_id,created_at,updated_at) VALUES ($1,$2,'Investing',100000,0,'KES','2027-12-31',$3,now(),now())`, []any{goalID, ownerID, sourceID}},
		{`UPDATE accounts SET goal_id=$3 WHERE user_id=$1 AND id=$2`, []any{ownerID, sourceID, goalID}},
		{`INSERT INTO estate_plans (id,user_id,title,created_at,updated_at) VALUES ($1,$2,'Plan',now(),now())`, []any{estatePlanID, ownerID}},
		{`INSERT INTO estate_account_directives (id,user_id,estate_plan_id,account_id,created_at,updated_at) VALUES ($1,$2,$3,$4,now(),now())`, []any{directiveID, ownerID, estatePlanID, sourceID}},
	} {
		if _, err := db.ExecContext(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed account conversion integration test: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = ANY($1)`, []uuid.UUID{ownerID, secondUserID})
	})

	conversions := NewAccountConversionService(db)
	conversions.now = func() time.Time { return time.Date(2026, time.September, 20, 15, 0, 0, 0, time.UTC) }
	key := uuid.New()
	input := AccountConversionInput{
		SourceAccountID: sourceID, TargetName: "Brokerage Positions", ConversionDate: conversionDate,
		OpeningCash: "1.00", IdempotencyKey: key,
		Holdings: []AccountConversionHoldingInput{{InstrumentID: instrumentID, Quantity: "3.125000000000000000", Price: "3.2", OpeningCostBasis: "9.50"}},
	}

	preview, err := conversions.Preview(ctx, ownerID, input)
	if err != nil {
		t.Fatalf("preview account conversion: %v", err)
	}
	if preview.SourceBalanceMinor != "1000" || preview.OpeningCashMinor != "100" || preview.PositionsMinor != "1000" || preview.DifferenceMinor != "100" || preview.Holdings[0].Quantity != "3.125" {
		t.Fatalf("preview = %+v", preview)
	}
	if _, err := conversions.Preview(ctx, secondUserID, input); !errors.Is(err, ErrAccountConversionNotFound) {
		t.Fatalf("second-user preview error=%v, want not found", err)
	}

	if _, err := conversions.Execute(ctx, ownerID, input); !errors.Is(err, ErrAccountConversionValidation) {
		t.Fatalf("unconfirmed difference error=%v, want validation", err)
	}
	var conversionCount int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM account_conversions WHERE user_id=$1 AND source_account_id=$2`, ownerID, sourceID).Scan(&conversionCount); err != nil || conversionCount != 0 {
		t.Fatalf("unconfirmed conversion count=%d err=%v", conversionCount, err)
	}
	input.ConfirmDifference = true
	result, err := conversions.Execute(ctx, ownerID, input)
	if err != nil {
		t.Fatalf("execute account conversion: %v", err)
	}
	var trackingMode, quantity string
	var currentValue int64
	var sourceArchived sql.NullTime
	var sourceGoal uuid.NullUUID
	if err := db.QueryRowContext(ctx, `SELECT tracking_mode,current_value_minor FROM accounts WHERE user_id=$1 AND id=$2`, ownerID, result.TargetAccountID).Scan(&trackingMode, &currentValue); err != nil {
		t.Fatalf("read conversion target: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT archived_at,goal_id FROM accounts WHERE user_id=$1 AND id=$2`, ownerID, sourceID).Scan(&sourceArchived, &sourceGoal); err != nil {
		t.Fatalf("read conversion source: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT quantity::TEXT FROM position_events WHERE user_id=$1 AND account_id=$2`, ownerID, result.TargetAccountID).Scan(&quantity); err != nil {
		t.Fatalf("read opening position: %v", err)
	}
	var linkedGoalAccount, directiveAccount uuid.UUID
	if err := db.QueryRowContext(ctx, `SELECT linked_account_id FROM goals WHERE user_id=$1 AND id=$2`, ownerID, goalID).Scan(&linkedGoalAccount); err != nil {
		t.Fatalf("read relinked goal: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT account_id FROM estate_account_directives WHERE user_id=$1 AND id=$2`, ownerID, directiveID).Scan(&directiveAccount); err != nil {
		t.Fatalf("read relinked estate directive: %v", err)
	}
	if trackingMode != "positions" || currentValue != 1100 || !sourceArchived.Valid || sourceArchived.Time.UTC().Hour() != 12 || sourceGoal.Valid || quantity != "3.125" || linkedGoalAccount != result.TargetAccountID || directiveAccount != result.TargetAccountID {
		t.Fatalf("stored conversion target=%s/%d source=%v/%v quantity=%s goal=%s directive=%s", trackingMode, currentValue, sourceArchived, sourceGoal, quantity, linkedGoalAccount, directiveAccount)
	}

	replayed, err := conversions.Execute(ctx, ownerID, input)
	if err != nil || !replayed.Replayed || replayed.TargetAccountID != result.TargetAccountID {
		t.Fatalf("idempotent replay=%+v err=%v", replayed, err)
	}
	incompatible := input
	incompatible.TargetName = "Different replacement"
	if _, err := conversions.Execute(ctx, ownerID, incompatible); !errors.Is(err, ErrAccountConversionConflict) {
		t.Fatalf("incompatible replay error=%v, want conflict", err)
	}
}
