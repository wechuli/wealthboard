package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

type fakeGoalMutationRepository struct {
	goalInput      ValidatedGoalInput
	milestoneInput ValidatedMilestoneInput
	status         string
	timezone       string
	alertKey       string
	lastUserID     uuid.UUID
	lastGoalID     uuid.UUID
}

func (repository *fakeGoalMutationRepository) CreateGoal(_ context.Context, userID uuid.UUID, input ValidatedGoalInput) (GoalMutationResult, error) {
	repository.lastUserID, repository.goalInput = userID, input
	return GoalMutationResult{ID: uuid.New()}, nil
}

func (repository *fakeGoalMutationRepository) UpdateGoal(_ context.Context, userID, goalID uuid.UUID, input ValidatedGoalInput) error {
	repository.lastUserID, repository.lastGoalID, repository.goalInput = userID, goalID, input
	return nil
}

func (repository *fakeGoalMutationRepository) SetGoalStatus(_ context.Context, userID, goalID uuid.UUID, status string, _ time.Time) error {
	repository.lastUserID, repository.lastGoalID, repository.status = userID, goalID, status
	return nil
}

func (repository *fakeGoalMutationRepository) DeleteGoal(_ context.Context, userID, goalID uuid.UUID, _ time.Time) error {
	repository.lastUserID, repository.lastGoalID = userID, goalID
	return nil
}

func (repository *fakeGoalMutationRepository) CreateMilestone(_ context.Context, userID, goalID uuid.UUID, input ValidatedMilestoneInput) (uuid.UUID, error) {
	repository.lastUserID, repository.lastGoalID, repository.milestoneInput = userID, goalID, input
	return uuid.New(), nil
}

func (repository *fakeGoalMutationRepository) DeleteMilestone(_ context.Context, userID, goalID, _ uuid.UUID) error {
	repository.lastUserID, repository.lastGoalID = userID, goalID
	return nil
}

func (repository *fakeGoalMutationRepository) GetTimezone(_ context.Context, userID uuid.UUID) (string, error) {
	repository.lastUserID = userID
	return repository.timezone, nil
}

func (repository *fakeGoalMutationRepository) DismissAlert(_ context.Context, userID, goalID uuid.UUID, alertKey string, _ time.Time) error {
	repository.lastUserID, repository.lastGoalID, repository.alertKey = userID, goalID, alertKey
	return nil
}

func validGoalMutationInput() GoalMutationInput {
	return GoalMutationInput{
		Name: "Emergency fund", TargetAmount: "10,000.00", CurrentAmount: "250.25", Currency: "kes",
		TargetDate: "2027-12-31", Icon: "Target", Status: "active", Priority: 2,
		AssumedAnnualReturn: "8.125", PlannedContribution: "500.00", Frequency: "monthly", PlanStartDate: "2026-09-20",
	}
}

func TestGoalMutationCreateValidatesExactMoneyAndLinkedSource(t *testing.T) {
	userID, accountID := uuid.New(), uuid.New()
	repository := &fakeGoalMutationRepository{}
	service := NewGoalMutationService(repository)
	input := validGoalMutationInput()
	input.LinkedAccountID = &accountID

	if _, err := service.CreateGoal(context.Background(), userID, input); err != nil {
		t.Fatalf("create goal: %v", err)
	}
	if repository.lastUserID != userID || repository.goalInput.TargetAmountMinor != 1_000_000 || repository.goalInput.PlannedContributionMinor != 50_000 {
		t.Fatalf("validated goal input = %+v", repository.goalInput)
	}
	if repository.goalInput.CurrentAmountMinor != 0 {
		t.Fatalf("linked goal stored current amount = %d, want 0", repository.goalInput.CurrentAmountMinor)
	}
	if repository.goalInput.AssumedAnnualReturnBPS != 813 || repository.goalInput.Currency != "KES" {
		t.Fatalf("return/currency = %d/%s", repository.goalInput.AssumedAnnualReturnBPS, repository.goalInput.Currency)
	}
}

func TestGoalMutationRejectsInvalidMoneyDatesStatusAndFrequency(t *testing.T) {
	tests := []struct {
		name   string
		change func(*GoalMutationInput)
	}{
		{name: "excess currency precision", change: func(input *GoalMutationInput) { input.TargetAmount = "1.001" }},
		{name: "non-positive target", change: func(input *GoalMutationInput) { input.TargetAmount = "0" }},
		{name: "negative current", change: func(input *GoalMutationInput) { input.CurrentAmount = "-1" }},
		{name: "target before plan", change: func(input *GoalMutationInput) { input.TargetDate = input.PlanStartDate }},
		{name: "end before start", change: func(input *GoalMutationInput) { input.PlanEndDate = "2026-09-19" }},
		{name: "invalid status", change: func(input *GoalMutationInput) { input.Status = "done" }},
		{name: "invalid frequency", change: func(input *GoalMutationInput) { input.Frequency = "daily" }},
		{name: "return too high", change: func(input *GoalMutationInput) { input.AssumedAnnualReturn = "100.01" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := validGoalMutationInput()
			test.change(&input)
			_, err := NewGoalMutationService(&fakeGoalMutationRepository{}).CreateGoal(context.Background(), uuid.New(), input)
			if !errors.Is(err, ErrGoalMutationValidation) {
				t.Fatalf("error = %v, want validation", err)
			}
		})
	}
}

func TestGoalMutationMilestoneAndDismissalPreserveOwnerContext(t *testing.T) {
	userID, goalID := uuid.New(), uuid.New()
	repository := &fakeGoalMutationRepository{timezone: "Pacific/Kiritimati"}
	service := NewGoalMutationService(repository)
	service.now = func() time.Time { return time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC) }

	if _, err := service.CreateMilestone(context.Background(), userID, goalID, GoalMilestoneInput{Name: " Halfway ", TargetAmount: "5,000.00", TargetDate: "2027-06-30"}); err != nil {
		t.Fatalf("create milestone: %v", err)
	}
	if repository.milestoneInput.Name != "Halfway" || repository.milestoneInput.TargetAmount != "5,000.00" {
		t.Fatalf("milestone input = %+v", repository.milestoneInput)
	}
	if err := service.DismissAlert(context.Background(), userID, goalID); err != nil {
		t.Fatalf("dismiss alert: %v", err)
	}
	if repository.lastUserID != userID || repository.lastGoalID != goalID || repository.alertKey != "behind:2026-10" {
		t.Fatalf("dismissal context = %s/%s/%s", repository.lastUserID, repository.lastGoalID, repository.alertKey)
	}
}
