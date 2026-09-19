package service

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

type fakeGoalsReportsRepository struct {
	settings   GoalsReportsSettings
	goals      []GoalRecord
	milestones []MilestoneRecord
	dismissed  []uuid.UUID
	accounts   []CurrentAccountRecord
	goalCount  int64
	getGoalErr error
	lastUserID uuid.UUID
	lastGoalID uuid.UUID
}

func (repository *fakeGoalsReportsRepository) GetSettings(_ context.Context, userID uuid.UUID) (GoalsReportsSettings, error) {
	repository.lastUserID = userID
	return repository.settings, nil
}

func (repository *fakeGoalsReportsRepository) ListGoals(_ context.Context, userID uuid.UUID) ([]GoalRecord, error) {
	repository.lastUserID = userID
	return repository.goals, nil
}

func (repository *fakeGoalsReportsRepository) GetGoal(_ context.Context, userID, goalID uuid.UUID) (GoalRecord, error) {
	repository.lastUserID, repository.lastGoalID = userID, goalID
	if repository.getGoalErr != nil {
		return GoalRecord{}, repository.getGoalErr
	}
	return repository.goals[0], nil
}

func (repository *fakeGoalsReportsRepository) ListMilestones(_ context.Context, userID, goalID uuid.UUID) ([]MilestoneRecord, error) {
	repository.lastUserID, repository.lastGoalID = userID, goalID
	return repository.milestones, nil
}

func (repository *fakeGoalsReportsRepository) ListDismissedGoalIDs(_ context.Context, userID uuid.UUID, _ string) ([]uuid.UUID, error) {
	repository.lastUserID = userID
	return repository.dismissed, nil
}

func (repository *fakeGoalsReportsRepository) ListAccounts(_ context.Context, userID uuid.UUID) ([]CurrentAccountRecord, error) {
	repository.lastUserID = userID
	return repository.accounts, nil
}

func (repository *fakeGoalsReportsRepository) CountGoals(_ context.Context, userID uuid.UUID) (int64, error) {
	repository.lastUserID = userID
	return repository.goalCount, nil
}

func TestGoalReadUsesLinkedAccountAsCurrentAmountSource(t *testing.T) {
	userID, goalID, accountID := uuid.New(), uuid.New(), uuid.New()
	accountName, currency, accountValue := "Savings", "KES", int64(42500)
	repository := &fakeGoalsReportsRepository{
		settings: GoalsReportsSettings{BaseCurrency: "KES", Timezone: "UTC"},
		goals: []GoalRecord{{
			ID: goalID, Name: "Emergency fund", TargetAmountMinor: 100000,
			StoredCurrentAmountMinor: 999999, Currency: "KES", TargetDate: time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC),
			LinkedAccountID: &accountID, LinkedAccountName: &accountName,
			LinkedAccountCurrency: &currency, LinkedAccountValueMinor: &accountValue,
		}},
	}
	goal, err := NewGoalsReportsService(repository).GetGoal(context.Background(), userID, goalID)
	if err != nil {
		t.Fatalf("get goal: %v", err)
	}
	if goal.CurrentAmountMinor != "42500" || goal.ProgressPercent != "42.5" {
		t.Fatalf("linked account was not the source of truth: %+v", goal)
	}
	if repository.lastUserID != userID || repository.lastGoalID != goalID {
		t.Fatalf("owner-scoped identifiers = %s/%s", repository.lastUserID, repository.lastGoalID)
	}
}

func TestGoalReadDoesNotMislabelCrossCurrencyLinkedValue(t *testing.T) {
	accountID := uuid.New()
	name, currency, value := "USD savings", "USD", int64(5000)
	repository := &fakeGoalsReportsRepository{
		settings: GoalsReportsSettings{BaseCurrency: "KES"},
		goals: []GoalRecord{{
			ID: uuid.New(), Name: "Goal", TargetAmountMinor: 10000, Currency: "KES",
			TargetDate: time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC), LinkedAccountID: &accountID,
			LinkedAccountName: &name, LinkedAccountCurrency: &currency, LinkedAccountValueMinor: &value,
		}},
	}
	goals, err := NewGoalsReportsService(repository).ListGoals(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("list goals: %v", err)
	}
	if !goals[0].ValueIncomplete || goals[0].CurrentAmountCurrency != "USD" || goals[0].ProgressPercent != "0" {
		t.Fatalf("cross-currency goal was presented as comparable: %+v", goals[0])
	}
}

func TestGoalForeignResourceMapsToNotFound(t *testing.T) {
	repository := &fakeGoalsReportsRepository{settings: GoalsReportsSettings{BaseCurrency: "KES"}, getGoalErr: sql.ErrNoRows}
	_, err := NewGoalsReportsService(repository).GetGoal(context.Background(), uuid.New(), uuid.New())
	if !errors.Is(err, ErrGoalsReportsNotFound) {
		t.Fatalf("error = %v, want ErrGoalsReportsNotFound", err)
	}
}

func TestGoalAlertIgnoresNonPositiveTarget(t *testing.T) {
	goal := GoalRead{TargetAmountMinor: "0", CurrentAmountMinor: "0", TargetDate: "2027-01-01"}
	if goalBehind(goal, time.Date(2026, 9, 20, 0, 0, 0, 0, time.UTC)) {
		t.Fatal("goal with a non-positive target must not produce a behind alert")
	}
}

func TestDashboardAndAllocationReportIncompleteCurrencies(t *testing.T) {
	repository := &fakeGoalsReportsRepository{
		settings: GoalsReportsSettings{BaseCurrency: "KES"}, goalCount: 2,
		accounts: []CurrentAccountRecord{
			{Currency: "KES", CurrentValueMinor: 10000, IsIncludedInNetWorth: true, CategoryName: "Cash", InstitutionName: "Bank", IsLiquid: true},
			{Currency: "KES", CurrentValueMinor: 2500, IsIncludedInNetWorth: true, IsLiability: true, CategoryName: "Debt", InstitutionName: "Bank"},
			{Currency: "USD", CurrentValueMinor: 9000, IsIncludedInNetWorth: true, CategoryName: "Investments", InstitutionName: "Broker"},
		},
	}
	service := NewGoalsReportsService(repository)
	service.now = func() time.Time { return time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC) }
	dashboard, err := service.Dashboard(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("dashboard: %v", err)
	}
	if dashboard.Totals.NetWorth != "7500" || dashboard.CurrentComplete || dashboard.MissingCurrencies[0] != "USD" || dashboard.HistoricalAvailable {
		t.Fatalf("dashboard = %+v", dashboard)
	}
	allocation, err := service.ReportAllocation(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("allocation: %v", err)
	}
	if len(allocation.Categories) != 1 || allocation.Categories[0].ValueMinor != "10000" || allocation.Categories[0].SharePercent != "100" {
		t.Fatalf("allocation = %+v", allocation)
	}
}
