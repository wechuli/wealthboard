package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestGoalMutationsPostgreSQLPreserveOwnershipAndLinkage(t *testing.T) {
	db := openServiceTestDatabase(t)
	ctx := context.Background()
	ownerID, secondUserID := uuid.New(), uuid.New()
	assetCategoryID, liabilityCategoryID, secondCategoryID := uuid.New(), uuid.New(), uuid.New()
	linkedAccountID, positionAccountID, liabilityAccountID, archivedAccountID, foreignAccountID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users (id,username,created_at,updated_at) VALUES ($1,$2,now(),now())`, []any{ownerID, "goal-owner-" + ownerID.String()}},
		{`INSERT INTO users (id,username,created_at,updated_at) VALUES ($1,$2,now(),now())`, []any{secondUserID, "goal-second-" + secondUserID.String()}},
		{`INSERT INTO user_settings (id,user_id,display_name,base_currency,supported_currencies,timezone,created_at,updated_at) VALUES ($1,$2,'Owner','KES','["KES"]','Pacific/Kiritimati',now(),now())`, []any{uuid.New(), ownerID}},
		{`INSERT INTO user_settings (id,user_id,display_name,base_currency,supported_currencies,timezone,created_at,updated_at) VALUES ($1,$2,'Second','KES','["KES"]','UTC',now(),now())`, []any{uuid.New(), secondUserID}},
		{`INSERT INTO categories (id,user_id,name,slug,asset_or_liability,created_at,updated_at) VALUES ($1,$2,'Savings',$3,'asset',now(),now())`, []any{assetCategoryID, ownerID, "savings-" + assetCategoryID.String()}},
		{`INSERT INTO categories (id,user_id,name,slug,asset_or_liability,created_at,updated_at) VALUES ($1,$2,'Debt',$3,'liability',now(),now())`, []any{liabilityCategoryID, ownerID, "debt-" + liabilityCategoryID.String()}},
		{`INSERT INTO categories (id,user_id,name,slug,asset_or_liability,created_at,updated_at) VALUES ($1,$2,'Savings',$3,'asset',now(),now())`, []any{secondCategoryID, secondUserID, "savings-" + secondCategoryID.String()}},
		{`INSERT INTO accounts (id,user_id,name,category_id,currency,tracking_mode,current_value_minor,created_at,updated_at) VALUES ($1,$2,'Linked savings',$3,'KES','balance',250000,now(),now())`, []any{linkedAccountID, ownerID, assetCategoryID}},
		{`INSERT INTO accounts (id,user_id,name,category_id,currency,tracking_mode,current_value_minor,created_at,updated_at) VALUES ($1,$2,'Position account',$3,'KES','positions',300000,now(),now())`, []any{positionAccountID, ownerID, assetCategoryID}},
		{`INSERT INTO accounts (id,user_id,name,category_id,currency,tracking_mode,current_value_minor,is_liability,created_at,updated_at) VALUES ($1,$2,'Loan',$3,'KES','balance',100000,true,now(),now())`, []any{liabilityAccountID, ownerID, liabilityCategoryID}},
		{`INSERT INTO accounts (id,user_id,name,category_id,currency,tracking_mode,current_value_minor,archived_at,created_at,updated_at) VALUES ($1,$2,'Archived',$3,'KES','balance',100000,now(),now(),now())`, []any{archivedAccountID, ownerID, assetCategoryID}},
		{`INSERT INTO accounts (id,user_id,name,category_id,currency,tracking_mode,current_value_minor,created_at,updated_at) VALUES ($1,$2,'Foreign',$3,'KES','balance',900000,now(),now())`, []any{foreignAccountID, secondUserID, secondCategoryID}},
	} {
		if _, err := db.ExecContext(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed goal mutation integration test: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = ANY($1)`, []uuid.UUID{ownerID, secondUserID})
	})

	repository := NewSQLGoalMutationRepository(db)
	mutations := NewGoalMutationService(repository)
	mutations.now = func() time.Time { return time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC) }
	idempotencyKey := uuid.New()
	input := validGoalMutationInput()
	input.IdempotencyKey = &idempotencyKey
	input.LinkedAccountID = &linkedAccountID
	input.CurrentAmount = "999999.99"

	created, err := mutations.CreateGoal(ctx, ownerID, input)
	if err != nil {
		t.Fatalf("create linked goal: %v", err)
	}
	var storedCurrent int64
	var accountGoal uuid.NullUUID
	var planCount int
	if err := db.QueryRowContext(ctx, `SELECT current_amount_minor FROM goals WHERE user_id=$1 AND id=$2`, ownerID, created.ID).Scan(&storedCurrent); err != nil {
		t.Fatalf("read created goal: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT goal_id FROM accounts WHERE user_id=$1 AND id=$2`, ownerID, linkedAccountID).Scan(&accountGoal); err != nil {
		t.Fatalf("read linked account: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM goal_contribution_plans WHERE user_id=$1 AND goal_id=$2`, ownerID, created.ID).Scan(&planCount); err != nil {
		t.Fatalf("read contribution plan: %v", err)
	}
	if storedCurrent != 0 || !accountGoal.Valid || accountGoal.UUID != created.ID || planCount != 1 {
		t.Fatalf("stored current/account goal/plan = %d/%v/%d", storedCurrent, accountGoal, planCount)
	}

	replayed, err := mutations.CreateGoal(ctx, ownerID, input)
	if err != nil || !replayed.Replayed || replayed.ID != created.ID {
		t.Fatalf("idempotent replay = %+v, err=%v", replayed, err)
	}
	if err := mutations.UpdateGoal(ctx, secondUserID, created.ID, validGoalMutationInput()); !errors.Is(err, ErrGoalMutationNotFound) {
		t.Fatalf("second-user update error=%v, want not found", err)
	}

	for _, accountID := range []uuid.UUID{liabilityAccountID, archivedAccountID} {
		invalid := validGoalMutationInput()
		invalid.LinkedAccountID = &accountID
		if _, err := mutations.CreateGoal(ctx, ownerID, invalid); !errors.Is(err, ErrGoalMutationValidation) {
			t.Fatalf("invalid linked account %s error=%v, want validation", accountID, err)
		}
	}
	foreign := validGoalMutationInput()
	foreign.LinkedAccountID = &foreignAccountID
	if _, err := mutations.CreateGoal(ctx, ownerID, foreign); !errors.Is(err, ErrGoalMutationNotFound) {
		t.Fatalf("foreign linked account error=%v, want not found", err)
	}
	disabledCurrency := validGoalMutationInput()
	disabledCurrency.Currency = "USD"
	if _, err := mutations.CreateGoal(ctx, ownerID, disabledCurrency); !errors.Is(err, ErrGoalMutationValidation) {
		t.Fatalf("disabled currency error=%v, want validation", err)
	}

	positionInput := validGoalMutationInput()
	positionInput.Name = "Position goal"
	positionInput.LinkedAccountID = &positionAccountID
	positionGoal, err := mutations.CreateGoal(ctx, ownerID, positionInput)
	if err != nil {
		t.Fatalf("create position-linked goal: %v", err)
	}
	if _, err := mutations.CreateMilestone(ctx, ownerID, positionGoal.ID, GoalMilestoneInput{Name: "Too large", TargetAmount: "10001.00"}); !errors.Is(err, ErrGoalMutationValidation) {
		t.Fatalf("oversized milestone error=%v, want validation", err)
	}
	milestoneID, err := mutations.CreateMilestone(ctx, ownerID, positionGoal.ID, GoalMilestoneInput{Name: "Halfway", TargetAmount: "5000.00", TargetDate: "2027-06-30"})
	if err != nil {
		t.Fatalf("create milestone: %v", err)
	}
	if err := mutations.DeleteMilestone(ctx, secondUserID, positionGoal.ID, milestoneID); !errors.Is(err, ErrGoalMutationNotFound) {
		t.Fatalf("second-user milestone delete error=%v, want not found", err)
	}
	if err := mutations.DismissAlert(ctx, ownerID, positionGoal.ID); err != nil {
		t.Fatalf("dismiss goal alert: %v", err)
	}
	var alertKey string
	if err := db.QueryRowContext(ctx, `SELECT alert_key FROM goal_alert_dismissals WHERE user_id=$1 AND goal_id=$2`, ownerID, positionGoal.ID).Scan(&alertKey); err != nil || alertKey != "behind:2026-10" {
		t.Fatalf("alert key=%q err=%v", alertKey, err)
	}
	if err := mutations.DeleteGoal(ctx, ownerID, positionGoal.ID); err != nil {
		t.Fatalf("delete goal: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT goal_id FROM accounts WHERE user_id=$1 AND id=$2`, ownerID, positionAccountID).Scan(&accountGoal); err != nil || accountGoal.Valid {
		t.Fatalf("deleted goal account link=%v err=%v", accountGoal, err)
	}
}
