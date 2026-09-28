package service

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/wechuli/wealthboard/internal/database/generated"
)

type fakeOverviewRepository struct {
	settings generated.GetOverviewSettingsRow
	accounts []generated.ListOverviewAccountsRow
	goals    int64
}

func (repository fakeOverviewRepository) GetOverviewSettings(context.Context, uuid.UUID) (generated.GetOverviewSettingsRow, error) {
	return repository.settings, nil
}

func (repository fakeOverviewRepository) ListOverviewAccounts(context.Context, uuid.UUID) ([]generated.ListOverviewAccountsRow, error) {
	return repository.accounts, nil
}

func (repository fakeOverviewRepository) CountOverviewGoals(context.Context, uuid.UUID) (int64, error) {
	return repository.goals, nil
}

func TestOverviewReportsUnconvertedCurrenciesAsIncomplete(t *testing.T) {
	service := NewOverviewService(fakeOverviewRepository{
		settings: generated.GetOverviewSettingsRow{BaseCurrency: "KES", DisplayName: "Alice", AppName: "Wealthboard"},
		accounts: []generated.ListOverviewAccountsRow{
			{Name: "Cash", Currency: "KES", CurrentValueMinor: 10000, IsIncludedInNetWorth: true, IsLiquid: true},
			{Name: "Loan", Currency: "KES", CurrentValueMinor: 2500, IsIncludedInNetWorth: true, IsLiability: true},
			{Name: "USD account", Currency: "USD", CurrentValueMinor: 9000, IsIncludedInNetWorth: true},
		},
		goals: 2,
	})
	overview, err := service.Get(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("get overview: %v", err)
	}
	if overview.Totals.NetWorth != "7500" || overview.Totals.Liquid != "10000" {
		t.Fatalf("totals = %+v", overview.Totals)
	}
	if overview.CurrentComplete || len(overview.MissingCurrencies) != 1 || overview.MissingCurrencies[0] != "USD" {
		t.Fatalf("completeness = %t, missing = %v", overview.CurrentComplete, overview.MissingCurrencies)
	}
	if overview.Accounts[0].CurrentValueMinor != "10000" {
		t.Fatalf("money was not serialized as a decimal string: %+v", overview.Accounts[0])
	}
}
