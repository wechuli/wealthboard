package service

import (
	"context"
	"database/sql"
	"errors"
	"math/big"
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

func TestChartPointUsesReplayAndEffectiveDatedRates(t *testing.T) {
	accountID := uuid.New()
	data := chartData{
		Accounts:     []chartAccount{{ID: accountID, Currency: "USD", TrackingMode: "balance", IsIncludedInNetWorth: true}},
		Transactions: []chartTransaction{{AccountID: accountID, Type: "opening_balance", Amount: 100, Currency: "USD", Date: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}},
		Valuations:   []chartValuation{{AccountID: accountID, Value: 150, Date: time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)}},
		Rates: []chartRate{
			{Base: "USD", Quote: "KES", Rate: "2", EffectiveDate: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)},
			{Base: "USD", Quote: "KES", Rate: "3", EffectiveDate: time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)},
		},
	}
	january, err := chartPointAt(data, "KES", time.Date(2026, 1, 15, 23, 59, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("January chart point: %v", err)
	}
	february, err := chartPointAt(data, "KES", time.Date(2026, 2, 15, 23, 59, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("February chart point: %v", err)
	}
	if january.NetWorthMinor != "200" || february.NetWorthMinor != "450" || !january.Complete || !february.Complete {
		t.Fatalf("effective-dated points = January %+v, February %+v", january, february)
	}
}

func TestGoalProjectionUsesExactMinorUnitsAndContributionWindow(t *testing.T) {
	goal := GoalRead{CurrentAmountMinor: "100", TargetAmountMinor: "1000", TargetDate: "2026-03-20", Plan: &GoalPlanRead{
		PlannedContributionMinor: "10", StartDate: "2026-01-20", Frequency: "monthly",
	}}
	points := goalProjection(goal, time.Date(2026, 1, 20, 0, 0, 0, 0, time.UTC))
	if len(points) != 3 || points[len(points)-1].ProjectedMinor != "120" || points[len(points)-1].ContributionsMinor != "120" {
		t.Fatalf("projection = %+v", points)
	}
}

func TestGoalScenariosUseMinorUnitsAndAttributeGrowth(t *testing.T) {
	now := time.Date(2026, 1, 20, 0, 0, 0, 0, time.UTC)
	goal := GoalRead{CurrentAmountMinor: "10000000", TargetAmountMinor: "23000000", TargetDate: "2026-11-20", AssumedAnnualReturnBPS: 1200, Plan: &GoalPlanRead{
		PlannedContributionMinor: "1000000", StartDate: "2026-01-20", Frequency: "monthly",
	}}
	scenarios := goalScenarios(goal, now)
	if scenarios == nil {
		t.Fatal("scenarios = nil")
	}
	if scenarios.RequiredPace.MonthlyContributionMinor == "13000000" {
		t.Fatalf("required pace used the total shortfall: %+v", scenarios.RequiredPace)
	}
	if scenarios.SavedPlan.NewContributionsMinor != "10000000" || scenarios.SavedPlan.EstimatedGrowthMinor == "0" {
		t.Fatalf("saved plan scenario = %+v", scenarios.SavedPlan)
	}
	projected, _ := new(big.Int).SetString(scenarios.SavedPlan.ProjectedAtTargetMinor, 10)
	growth, _ := new(big.Int).SetString(scenarios.SavedPlan.EstimatedGrowthMinor, 10)
	if projected.Cmp(new(big.Int).Add(big.NewInt(20000000), growth)) != 0 {
		t.Fatalf("projected total does not equal principal plus contributions plus growth: %+v", scenarios.SavedPlan)
	}
}

func TestGoalScenariosConvertSavedPlanToMonthlyPace(t *testing.T) {
	goal := GoalRead{CurrentAmountMinor: "0", TargetAmountMinor: "100000", TargetDate: "2027-01-20", Plan: &GoalPlanRead{
		PlannedContributionMinor: "120000", StartDate: "2026-01-20", Frequency: "annually",
	}}
	scenarios := goalScenarios(goal, time.Date(2026, 1, 20, 0, 0, 0, 0, time.UTC))
	if scenarios == nil || scenarios.SavedPlan.MonthlyContributionMinor != "10000" {
		t.Fatalf("annual plan monthly pace = %+v", scenarios)
	}
}

func TestChartFlowsReplayMultipleValuationsOnce(t *testing.T) {
	accountID := uuid.New()
	data := chartData{
		Accounts: []chartAccount{{ID: accountID, Currency: "KES", TrackingMode: "balance", IsIncludedInNetWorth: true}},
		Transactions: []chartTransaction{
			{AccountID: accountID, Type: "opening_balance", Amount: 100, Currency: "KES", Date: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)},
			{AccountID: accountID, Type: "deposit", Amount: 20, Currency: "KES", Date: time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)},
		},
		Valuations: []chartValuation{
			{AccountID: accountID, Value: 150, Date: time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC)},
			{AccountID: accountID, Value: 200, Date: time.Date(2026, 2, 15, 0, 0, 0, 0, time.UTC)},
		},
	}
	flows, complete, missing, err := chartFlows(data, "KES")
	if err != nil {
		t.Fatalf("chart flows: %v", err)
	}
	if !complete || len(missing) != 0 || flows.Contributions != "120" || flows.CapitalGrowth != "80" {
		t.Fatalf("chart flows = %+v, complete=%v, missing=%v", flows, complete, missing)
	}
}

func TestPositionMovementAttributionBridgesPriceChange(t *testing.T) {
	accountID, instrumentID := uuid.New(), uuid.New()
	data := chartData{
		Accounts: []chartAccount{{ID: accountID, Currency: "KES", TrackingMode: "positions", IsIncludedInNetWorth: true}},
		PositionEvents: []chartPositionEvent{{positionEventRow: positionEventRow{
			id: uuid.New(), accountID: accountID, instrumentID: instrumentID, eventType: "opening_position",
			quantity: "10", tradeDate: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), createdAt: time.Date(2026, 1, 1, 1, 0, 0, 0, time.UTC),
		}}},
		Prices: []chartPrice{
			{InstrumentID: instrumentID, Currency: "KES", Price: "100", EffectiveDate: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)},
			{InstrumentID: instrumentID, Currency: "KES", Price: "120", EffectiveDate: time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)},
		},
	}
	attribution, err := chartMovementAttribution(data, data.Accounts[0], endOfChartDay(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)), endOfChartDay(time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)))
	if err != nil {
		t.Fatalf("movement attribution: %v", err)
	}
	if !attribution.Complete || attribution.ChangeMinor != "20000" || attribution.PriceMovementMinor != "20000" || attribution.UnattributedMinor != "0" {
		t.Fatalf("movement attribution = %+v", attribution)
	}
}
