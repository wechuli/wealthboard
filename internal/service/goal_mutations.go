package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/wechuli/wealthboard/internal/domain"
)

var (
	ErrGoalMutationNotFound   = errors.New("goal mutation resource not found")
	ErrGoalMutationConflict   = errors.New("goal mutation conflict")
	ErrGoalMutationValidation = errors.New("goal mutation validation failed")
)

const maxSafeMinor = int64(9_007_199_254_740_991)

var goalMoneyPattern = regexp.MustCompile(`^-?\d+(?:\.\d+)?$`)

type GoalMutationDB interface {
	BeginTx(context.Context, *sql.TxOptions) (*sql.Tx, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type GoalMutationRepository interface {
	CreateGoal(context.Context, uuid.UUID, ValidatedGoalInput) (GoalMutationResult, error)
	UpdateGoal(context.Context, uuid.UUID, uuid.UUID, ValidatedGoalInput) error
	SetGoalStatus(context.Context, uuid.UUID, uuid.UUID, string, time.Time) error
	DeleteGoal(context.Context, uuid.UUID, uuid.UUID, time.Time) error
	CreateMilestone(context.Context, uuid.UUID, uuid.UUID, ValidatedMilestoneInput) (uuid.UUID, error)
	DeleteMilestone(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error
	GetTimezone(context.Context, uuid.UUID) (string, error)
	DismissAlert(context.Context, uuid.UUID, uuid.UUID, string, time.Time) error
}

type SQLGoalMutationRepository struct {
	db GoalMutationDB
}

type GoalMutationService struct {
	repository GoalMutationRepository
	now        func() time.Time
}

type GoalMutationInput struct {
	IdempotencyKey      *uuid.UUID
	Name                string
	Description         *string
	TargetAmount        string
	CurrentAmount       string
	Currency            string
	TargetDate          string
	LinkedAccountID     *uuid.UUID
	Icon                string
	Status              string
	Priority            int
	AssumedAnnualReturn string
	PlannedContribution string
	Frequency           string
	PlanStartDate       string
	PlanEndDate         string
}

type ValidatedGoalInput struct {
	GoalMutationInput
	TargetAmountMinor        int64
	CurrentAmountMinor       int64
	PlannedContributionMinor int64
	AssumedAnnualReturnBPS   int
	TargetDateValue          time.Time
	PlanStartDateValue       time.Time
	PlanEndDateValue         *time.Time
	Now                      time.Time
}

type GoalMilestoneInput struct {
	Name         string
	TargetAmount string
	TargetDate   string
}

type ValidatedMilestoneInput struct {
	Name         string
	TargetAmount string
	TargetDate   *time.Time
	Now          time.Time
}

type GoalMutationResult struct {
	ID       uuid.UUID `json:"id"`
	Replayed bool      `json:"replayed"`
}

func NewSQLGoalMutationRepository(db GoalMutationDB) *SQLGoalMutationRepository {
	return &SQLGoalMutationRepository{db: db}
}

func NewGoalMutationService(repository GoalMutationRepository) *GoalMutationService {
	return &GoalMutationService{repository: repository, now: time.Now}
}

func (service *GoalMutationService) CreateGoal(ctx context.Context, userID uuid.UUID, input GoalMutationInput) (GoalMutationResult, error) {
	validated, err := validateGoalMutationInput(input, service.now())
	if err != nil {
		return GoalMutationResult{}, err
	}
	return service.repository.CreateGoal(ctx, userID, validated)
}

func (service *GoalMutationService) UpdateGoal(ctx context.Context, userID, goalID uuid.UUID, input GoalMutationInput) error {
	validated, err := validateGoalMutationInput(input, service.now())
	if err != nil {
		return err
	}
	return service.repository.UpdateGoal(ctx, userID, goalID, validated)
}

func (service *GoalMutationService) SetGoalStatus(ctx context.Context, userID, goalID uuid.UUID, status string) error {
	if !validGoalStatus(status) {
		return goalValidationError("status must be active, paused, completed, or cancelled")
	}
	return service.repository.SetGoalStatus(ctx, userID, goalID, status, service.now().UTC())
}

func (service *GoalMutationService) DeleteGoal(ctx context.Context, userID, goalID uuid.UUID) error {
	return service.repository.DeleteGoal(ctx, userID, goalID, service.now().UTC())
}

func (service *GoalMutationService) CreateMilestone(ctx context.Context, userID, goalID uuid.UUID, input GoalMilestoneInput) (uuid.UUID, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" || len(name) > 100 {
		return uuid.Nil, goalValidationError("milestone name must contain between 1 and 100 characters")
	}
	var targetDate *time.Time
	if strings.TrimSpace(input.TargetDate) != "" {
		parsed, err := parseDate(input.TargetDate)
		if err != nil {
			return uuid.Nil, err
		}
		targetDate = &parsed
	}
	return service.repository.CreateMilestone(ctx, userID, goalID, ValidatedMilestoneInput{
		Name: name, TargetDate: targetDate, Now: service.now().UTC(),
		TargetAmount: input.TargetAmount,
	})
}

func (service *GoalMutationService) DeleteMilestone(ctx context.Context, userID, goalID, milestoneID uuid.UUID) error {
	return service.repository.DeleteMilestone(ctx, userID, goalID, milestoneID)
}

func (service *GoalMutationService) DismissAlert(ctx context.Context, userID, goalID uuid.UUID) error {
	timezone, err := service.repository.GetTimezone(ctx, userID)
	if err != nil {
		return fmt.Errorf("load user timezone: %w", err)
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return fmt.Errorf("load user timezone %q: %w", timezone, err)
	}
	now := service.now().UTC()
	alertKey := "behind:" + now.In(location).Format("2006-01")
	return service.repository.DismissAlert(ctx, userID, goalID, alertKey, now)
}

func validateGoalMutationInput(input GoalMutationInput, now time.Time) (ValidatedGoalInput, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Currency = domain.NormalizeCurrency(input.Currency)
	input.Icon = strings.TrimSpace(input.Icon)
	if input.Description != nil {
		trimmed := strings.TrimSpace(*input.Description)
		if trimmed == "" {
			input.Description = nil
		} else {
			input.Description = &trimmed
		}
	}
	if input.Name == "" || len(input.Name) > 100 {
		return ValidatedGoalInput{}, goalValidationError("goal name must contain between 1 and 100 characters")
	}
	if input.Description != nil && len(*input.Description) > 500 {
		return ValidatedGoalInput{}, goalValidationError("goal description cannot exceed 500 characters")
	}
	if !domain.IsSupportedCurrency(input.Currency) {
		return ValidatedGoalInput{}, goalValidationError("currency is not supported")
	}
	if input.Icon == "" {
		input.Icon = "Target"
	}
	if len(input.Icon) > 50 || !validGoalStatus(input.Status) || input.Priority < 0 || input.Priority > 100 || !validFrequency(input.Frequency) {
		return ValidatedGoalInput{}, goalValidationError("goal status, priority, icon, or contribution frequency is invalid")
	}
	targetAmount, err := parseGoalMoneyMinor(input.TargetAmount, input.Currency)
	if err != nil || targetAmount <= 0 {
		return ValidatedGoalInput{}, goalValidationError("target amount must be a valid value greater than zero")
	}
	currentAmount := int64(0)
	if strings.TrimSpace(input.CurrentAmount) != "" {
		currentAmount, err = parseGoalMoneyMinor(input.CurrentAmount, input.Currency)
		if err != nil || currentAmount < 0 {
			return ValidatedGoalInput{}, goalValidationError("current amount must be a valid non-negative value")
		}
	}
	plannedContribution, err := parseGoalMoneyMinor(input.PlannedContribution, input.Currency)
	if err != nil || plannedContribution < 0 {
		return ValidatedGoalInput{}, goalValidationError("planned contribution must be a valid non-negative value")
	}
	if input.LinkedAccountID != nil {
		currentAmount = 0
	}
	targetDate, err := parseDate(input.TargetDate)
	if err != nil {
		return ValidatedGoalInput{}, err
	}
	planStartDate, err := parseDate(input.PlanStartDate)
	if err != nil {
		return ValidatedGoalInput{}, err
	}
	if !targetDate.After(planStartDate) {
		return ValidatedGoalInput{}, goalValidationError("target date must be after the contribution start date")
	}
	var planEndDate *time.Time
	if strings.TrimSpace(input.PlanEndDate) != "" {
		parsed, parseErr := parseDate(input.PlanEndDate)
		if parseErr != nil {
			return ValidatedGoalInput{}, parseErr
		}
		if parsed.Before(planStartDate) {
			return ValidatedGoalInput{}, goalValidationError("contribution plan end date cannot be before its start date")
		}
		planEndDate = &parsed
	}
	returnBPS, err := percentageToBPS(input.AssumedAnnualReturn)
	if err != nil || returnBPS < 0 || returnBPS > 10_000 {
		return ValidatedGoalInput{}, goalValidationError("assumed annual return must be between 0 and 100")
	}
	return ValidatedGoalInput{
		GoalMutationInput: input, TargetAmountMinor: targetAmount, CurrentAmountMinor: currentAmount,
		PlannedContributionMinor: plannedContribution, AssumedAnnualReturnBPS: returnBPS,
		TargetDateValue: targetDate, PlanStartDateValue: planStartDate, PlanEndDateValue: planEndDate, Now: now.UTC(),
	}, nil
}

func (repository *SQLGoalMutationRepository) CreateGoal(ctx context.Context, userID uuid.UUID, input ValidatedGoalInput) (GoalMutationResult, error) {
	tx, err := repository.db.BeginTx(ctx, nil)
	if err != nil {
		return GoalMutationResult{}, fmt.Errorf("begin create goal: %w", err)
	}
	defer tx.Rollback()
	if input.IdempotencyKey != nil {
		result, err := tx.ExecContext(ctx, `INSERT INTO idempotency_keys (user_id, key, operation, created_at) VALUES ($1, $2, 'create-goal', $3) ON CONFLICT (user_id, key) DO NOTHING`, userID, *input.IdempotencyKey, input.Now)
		if err != nil {
			return GoalMutationResult{}, fmt.Errorf("reserve goal request key: %w", err)
		}
		inserted, _ := result.RowsAffected()
		if inserted == 0 {
			var operation string
			var resultID uuid.NullUUID
			if err := tx.QueryRowContext(ctx, `SELECT operation, result_id FROM idempotency_keys WHERE user_id = $1 AND key = $2`, userID, *input.IdempotencyKey).Scan(&operation, &resultID); err != nil {
				return GoalMutationResult{}, fmt.Errorf("read goal request key: %w", err)
			}
			if operation == "create-goal" && resultID.Valid {
				return GoalMutationResult{ID: resultID.UUID, Replayed: true}, nil
			}
			return GoalMutationResult{}, goalConflictError("the idempotency key was already used")
		}
	}
	if err := validateGoalCurrency(ctx, tx, userID, input.Currency); err != nil {
		return GoalMutationResult{}, err
	}
	if err := validateLinkedAccount(ctx, tx, userID, input.LinkedAccountID, uuid.Nil); err != nil {
		return GoalMutationResult{}, err
	}
	goalID := uuid.New()
	_, err = tx.ExecContext(ctx, `INSERT INTO goals (id, user_id, name, description, target_amount_minor, current_amount_minor, currency, target_date, linked_account_id, icon, status, priority, assumed_annual_return_bps, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`, goalID, userID, input.Name, input.Description, input.TargetAmountMinor, input.CurrentAmountMinor, input.Currency, input.TargetDateValue, input.LinkedAccountID, input.Icon, input.Status, input.Priority, input.AssumedAnnualReturnBPS, input.Now)
	if err != nil {
		return GoalMutationResult{}, fmt.Errorf("insert goal: %w", err)
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO goal_contribution_plans (id, user_id, goal_id, planned_contribution_minor, frequency, start_date, end_date, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`, uuid.New(), userID, goalID, input.PlannedContributionMinor, input.Frequency, input.PlanStartDateValue, input.PlanEndDateValue, input.Now)
	if err != nil {
		return GoalMutationResult{}, fmt.Errorf("insert goal contribution plan: %w", err)
	}
	if input.LinkedAccountID != nil {
		if _, err := tx.ExecContext(ctx, `UPDATE accounts SET goal_id = $1, updated_at = $2 WHERE user_id = $3 AND id = $4`, goalID, input.Now, userID, *input.LinkedAccountID); err != nil {
			return GoalMutationResult{}, fmt.Errorf("link goal account: %w", err)
		}
	}
	if input.IdempotencyKey != nil {
		if _, err := tx.ExecContext(ctx, `UPDATE idempotency_keys SET result_id = $1 WHERE user_id = $2 AND key = $3`, goalID, userID, *input.IdempotencyKey); err != nil {
			return GoalMutationResult{}, fmt.Errorf("complete goal request key: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return GoalMutationResult{}, fmt.Errorf("commit create goal: %w", err)
	}
	return GoalMutationResult{ID: goalID}, nil
}

func (repository *SQLGoalMutationRepository) UpdateGoal(ctx context.Context, userID, goalID uuid.UUID, input ValidatedGoalInput) error {
	tx, err := repository.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin update goal: %w", err)
	}
	defer tx.Rollback()
	if err := requireGoal(ctx, tx, userID, goalID); err != nil {
		return err
	}
	if err := validateGoalCurrency(ctx, tx, userID, input.Currency); err != nil {
		return err
	}
	if err := validateLinkedAccount(ctx, tx, userID, input.LinkedAccountID, goalID); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE goals SET name=$1, description=$2, target_amount_minor=$3, current_amount_minor=$4, currency=$5, target_date=$6, linked_account_id=$7, icon=$8, status=$9, priority=$10, assumed_annual_return_bps=$11, updated_at=$12 WHERE user_id=$13 AND id=$14`, input.Name, input.Description, input.TargetAmountMinor, input.CurrentAmountMinor, input.Currency, input.TargetDateValue, input.LinkedAccountID, input.Icon, input.Status, input.Priority, input.AssumedAnnualReturnBPS, input.Now, userID, goalID)
	if err != nil {
		return fmt.Errorf("update goal: %w", err)
	}
	result, err := tx.ExecContext(ctx, `UPDATE goal_contribution_plans SET planned_contribution_minor=$1, frequency=$2, start_date=$3, end_date=$4, updated_at=$5 WHERE user_id=$6 AND goal_id=$7`, input.PlannedContributionMinor, input.Frequency, input.PlanStartDateValue, input.PlanEndDateValue, input.Now, userID, goalID)
	if err != nil {
		return fmt.Errorf("update goal contribution plan: %w", err)
	}
	if changed, _ := result.RowsAffected(); changed == 0 {
		return ErrGoalMutationNotFound
	}
	if _, err := tx.ExecContext(ctx, `UPDATE accounts SET goal_id=NULL, updated_at=$1 WHERE user_id=$2 AND goal_id=$3`, input.Now, userID, goalID); err != nil {
		return fmt.Errorf("unlink previous goal account: %w", err)
	}
	if input.LinkedAccountID != nil {
		if _, err := tx.ExecContext(ctx, `UPDATE accounts SET goal_id=$1, updated_at=$2 WHERE user_id=$3 AND id=$4`, goalID, input.Now, userID, *input.LinkedAccountID); err != nil {
			return fmt.Errorf("link updated goal account: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit update goal: %w", err)
	}
	return nil
}

func (repository *SQLGoalMutationRepository) SetGoalStatus(ctx context.Context, userID, goalID uuid.UUID, status string, now time.Time) error {
	result, err := repository.goalExec(ctx, `UPDATE goals SET status=$1, updated_at=$2 WHERE user_id=$3 AND id=$4`, status, now, userID, goalID)
	return goalRequireAffected(result, err)
}

func (repository *SQLGoalMutationRepository) DeleteGoal(ctx context.Context, userID, goalID uuid.UUID, now time.Time) error {
	tx, err := repository.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin delete goal: %w", err)
	}
	defer tx.Rollback()
	if err := requireGoal(ctx, tx, userID, goalID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE accounts SET goal_id=NULL, updated_at=$1 WHERE user_id=$2 AND goal_id=$3`, now, userID, goalID); err != nil {
		return fmt.Errorf("unlink deleted goal account: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM goals WHERE user_id=$1 AND id=$2`, userID, goalID); err != nil {
		return fmt.Errorf("delete goal: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit delete goal: %w", err)
	}
	return nil
}

func (repository *SQLGoalMutationRepository) CreateMilestone(ctx context.Context, userID, goalID uuid.UUID, input ValidatedMilestoneInput) (uuid.UUID, error) {
	tx, err := repository.db.BeginTx(ctx, nil)
	if err != nil {
		return uuid.Nil, fmt.Errorf("begin create milestone: %w", err)
	}
	defer tx.Rollback()
	var currency string
	var targetAmount int64
	var goalDate time.Time
	if err := tx.QueryRowContext(ctx, `SELECT currency, target_amount_minor, target_date FROM goals WHERE user_id=$1 AND id=$2 FOR UPDATE`, userID, goalID).Scan(&currency, &targetAmount, &goalDate); errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, ErrGoalMutationNotFound
	} else if err != nil {
		return uuid.Nil, fmt.Errorf("load milestone goal: %w", err)
	}
	amount, err := parseGoalMoneyMinor(input.TargetAmount, currency)
	if err != nil || amount <= 0 || amount > targetAmount {
		return uuid.Nil, goalValidationError("milestone amount must be greater than zero and no more than the goal target")
	}
	if input.TargetDate != nil && input.TargetDate.After(goalDate) {
		return uuid.Nil, goalValidationError("milestone date cannot be after the goal target date")
	}
	milestoneID := uuid.New()
	_, err = tx.ExecContext(ctx, `INSERT INTO goal_milestones (id,user_id,goal_id,name,target_amount_minor,target_date,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`, milestoneID, userID, goalID, input.Name, amount, input.TargetDate, input.Now)
	if err != nil {
		return uuid.Nil, fmt.Errorf("insert goal milestone: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return uuid.Nil, fmt.Errorf("commit create milestone: %w", err)
	}
	return milestoneID, nil
}

func (repository *SQLGoalMutationRepository) DeleteMilestone(ctx context.Context, userID, goalID, milestoneID uuid.UUID) error {
	result, err := repository.goalExec(ctx, `DELETE FROM goal_milestones WHERE user_id=$1 AND goal_id=$2 AND id=$3`, userID, goalID, milestoneID)
	return goalRequireAffected(result, err)
}

func (repository *SQLGoalMutationRepository) GetTimezone(ctx context.Context, userID uuid.UUID) (string, error) {
	var timezone string
	err := repository.db.QueryRowContext(ctx, `SELECT timezone FROM user_settings WHERE user_id=$1`, userID).Scan(&timezone)
	return timezone, err
}

func (repository *SQLGoalMutationRepository) DismissAlert(ctx context.Context, userID, goalID uuid.UUID, alertKey string, now time.Time) error {
	tx, err := repository.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin dismiss goal alert: %w", err)
	}
	defer tx.Rollback()
	if err := requireGoal(ctx, tx, userID, goalID); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO goal_alert_dismissals (user_id,goal_id,alert_key,dismissed_at) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id,goal_id,alert_key) DO NOTHING`, userID, goalID, alertKey, now)
	if err != nil {
		return fmt.Errorf("dismiss goal alert: %w", err)
	}
	return tx.Commit()
}

func validateLinkedAccount(ctx context.Context, tx *sql.Tx, userID uuid.UUID, accountID *uuid.UUID, goalID uuid.UUID) error {
	if accountID == nil {
		return nil
	}
	var archived bool
	var liability bool
	var categoryArchived bool
	var categoryType string
	var trackingMode string
	err := tx.QueryRowContext(ctx, `SELECT a.archived_at IS NOT NULL, a.is_liability, c.is_archived, c.asset_or_liability, a.tracking_mode FROM accounts a JOIN categories c ON c.user_id=a.user_id AND c.id=a.category_id WHERE a.user_id=$1 AND a.id=$2 FOR UPDATE OF a`, userID, *accountID).Scan(&archived, &liability, &categoryArchived, &categoryType, &trackingMode)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrGoalMutationNotFound
	}
	if err != nil {
		return fmt.Errorf("load linked account: %w", err)
	}
	if archived || liability || categoryArchived || categoryType != "asset" || (trackingMode != "balance" && trackingMode != "positions") {
		return goalValidationError("linked account must be an active asset account with a valid tracking mode")
	}
	var linkedGoalID uuid.UUID
	var linkedGoalName string
	err = tx.QueryRowContext(ctx, `SELECT id, name FROM goals WHERE user_id=$1 AND linked_account_id=$2 AND ($3::uuid = '00000000-0000-0000-0000-000000000000' OR id<>$3)`, userID, *accountID, goalID).Scan(&linkedGoalID, &linkedGoalName)
	if err == nil {
		return goalConflictError("linked account is already assigned to " + linkedGoalName)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("check linked account goal: %w", err)
	}
	return nil
}

func validateGoalCurrency(ctx context.Context, tx *sql.Tx, userID uuid.UUID, currency string) error {
	var baseCurrency string
	var supportedJSON string
	if err := tx.QueryRowContext(ctx, `SELECT base_currency, supported_currencies FROM user_settings WHERE user_id=$1`, userID).Scan(&baseCurrency, &supportedJSON); errors.Is(err, sql.ErrNoRows) {
		return ErrGoalMutationNotFound
	} else if err != nil {
		return fmt.Errorf("load goal currencies: %w", err)
	}
	var supported []string
	if err := json.Unmarshal([]byte(supportedJSON), &supported); err != nil {
		return fmt.Errorf("decode goal currencies: %w", err)
	}
	if currency == domain.NormalizeCurrency(baseCurrency) {
		return nil
	}
	for _, enabled := range supported {
		if currency == domain.NormalizeCurrency(enabled) {
			return nil
		}
	}
	return goalValidationError("currency is not enabled for this user")
}

func requireGoal(ctx context.Context, tx *sql.Tx, userID, goalID uuid.UUID) error {
	var found uuid.UUID
	if err := tx.QueryRowContext(ctx, `SELECT id FROM goals WHERE user_id=$1 AND id=$2 FOR UPDATE`, userID, goalID).Scan(&found); errors.Is(err, sql.ErrNoRows) {
		return ErrGoalMutationNotFound
	} else if err != nil {
		return fmt.Errorf("load goal: %w", err)
	}
	return nil
}

func (repository *SQLGoalMutationRepository) goalExec(ctx context.Context, query string, args ...any) (sql.Result, error) {
	tx, err := repository.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func goalRequireAffected(result sql.Result, err error) error {
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed == 0 {
		return ErrGoalMutationNotFound
	}
	return nil
}

func validGoalStatus(value string) bool {
	return value == "active" || value == "paused" || value == "completed" || value == "cancelled"
}

func validFrequency(value string) bool {
	return value == "weekly" || value == "monthly" || value == "quarterly" || value == "annually" || value == "custom"
}

func parseDate(value string) (time.Time, error) {
	parsed, err := time.Parse(time.DateOnly, strings.TrimSpace(value))
	if err != nil {
		return time.Time{}, goalValidationError("dates must use YYYY-MM-DD")
	}
	return parsed, nil
}

func parseGoalMoneyMinor(value, currency string) (int64, error) {
	normalized := strings.ReplaceAll(strings.TrimSpace(value), ",", "")
	if !goalMoneyPattern.MatchString(normalized) {
		return 0, goalValidationError("monetary amount is invalid")
	}
	digits := goalCurrencyDigits(currency)
	parts := strings.SplitN(normalized, ".", 2)
	fraction := ""
	if len(parts) == 2 {
		fraction = parts[1]
	}
	if len(fraction) > digits {
		return 0, goalValidationError(fmt.Sprintf("%s supports at most %d decimal places", currency, digits))
	}
	fraction += strings.Repeat("0", digits-len(fraction))
	whole := new(big.Int)
	if _, ok := whole.SetString(parts[0], 10); !ok {
		return 0, goalValidationError("monetary amount is invalid")
	}
	negative := strings.HasPrefix(parts[0], "-")
	whole.Abs(whole)
	minor := whole.Mul(whole, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(digits)), nil))
	if fraction != "" {
		fractionValue := new(big.Int)
		fractionValue.SetString(fraction, 10)
		minor.Add(minor, fractionValue)
	}
	if negative {
		minor.Neg(minor)
	}
	if !minor.IsInt64() || minor.Cmp(big.NewInt(maxSafeMinor)) > 0 || minor.Cmp(big.NewInt(-maxSafeMinor)) < 0 {
		return 0, goalValidationError("monetary amount is outside the supported range")
	}
	return minor.Int64(), nil
}

func goalCurrencyDigits(currency string) int {
	switch currency {
	case "BHD", "KWD", "OMR":
		return 3
	case "BIF", "JPY", "RWF", "UGX":
		return 0
	default:
		return 2
	}
}

func percentageToBPS(value string) (int, error) {
	rational := new(big.Rat)
	if _, ok := rational.SetString(strings.TrimSpace(value)); !ok {
		return 0, goalValidationError("percentage is invalid")
	}
	rational.Mul(rational, big.NewRat(100, 1))
	quotient, remainder := new(big.Int).QuoRem(rational.Num(), rational.Denom(), new(big.Int))
	if new(big.Int).Mul(new(big.Int).Abs(remainder), big.NewInt(2)).Cmp(rational.Denom()) >= 0 {
		if rational.Sign() >= 0 {
			quotient.Add(quotient, big.NewInt(1))
		} else {
			quotient.Sub(quotient, big.NewInt(1))
		}
	}
	if !quotient.IsInt64() {
		return 0, goalValidationError("percentage is outside the supported range")
	}
	return int(quotient.Int64()), nil
}

func goalValidationError(detail string) error {
	return fmt.Errorf("%w: %s", ErrGoalMutationValidation, detail)
}

func goalConflictError(detail string) error {
	return fmt.Errorf("%w: %s", ErrGoalMutationConflict, detail)
}
