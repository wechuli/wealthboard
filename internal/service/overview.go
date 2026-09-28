package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"

	"github.com/google/uuid"

	"github.com/wechuli/wealthboard/internal/database/generated"
)

type OverviewRepository interface {
	CountOverviewGoals(context.Context, uuid.UUID) (int64, error)
	GetOverviewSettings(context.Context, uuid.UUID) (generated.GetOverviewSettingsRow, error)
	ListOverviewAccounts(context.Context, uuid.UUID) ([]generated.ListOverviewAccountsRow, error)
}

type OverviewService struct {
	repository OverviewRepository
}

type Overview struct {
	Settings          OverviewSettings  `json:"settings"`
	Totals            OverviewTotals    `json:"totals"`
	Accounts          []OverviewAccount `json:"accounts"`
	AccountCount      int               `json:"accountCount"`
	GoalCount         int64             `json:"goalCount"`
	CurrentComplete   bool              `json:"currentComplete"`
	MissingCurrencies []string          `json:"missingCurrencies"`
}

type OverviewSettings struct {
	DisplayName            string `json:"displayName"`
	AppName                string `json:"appName"`
	BaseCurrency           string `json:"baseCurrency"`
	Timezone               string `json:"timezone"`
	PreferredDateFormat    string `json:"preferredDateFormat"`
	DefaultDashboardPeriod string `json:"defaultDashboardPeriod"`
}

type OverviewTotals struct {
	Assets      string `json:"assets"`
	Liabilities string `json:"liabilities"`
	NetWorth    string `json:"netWorth"`
	Liquid      string `json:"liquid"`
	Investible  string `json:"investible"`
}

type OverviewAccount struct {
	ID                   uuid.UUID `json:"id"`
	Name                 string    `json:"name"`
	Currency             string    `json:"currency"`
	CurrentValueMinor    string    `json:"currentValueMinor"`
	IsLiability          bool      `json:"isLiability"`
	IsIncludedInNetWorth bool      `json:"isIncludedInNetWorth"`
	CategoryName         string    `json:"categoryName"`
	InstitutionName      string    `json:"institutionName,omitempty"`
}

func NewOverviewService(repository OverviewRepository) *OverviewService {
	return &OverviewService{repository: repository}
}

func (service *OverviewService) Get(ctx context.Context, userID uuid.UUID) (Overview, error) {
	settings, err := service.repository.GetOverviewSettings(ctx, userID)
	if err != nil {
		return Overview{}, fmt.Errorf("load overview settings: %w", err)
	}
	accounts, err := service.repository.ListOverviewAccounts(ctx, userID)
	if err != nil {
		return Overview{}, fmt.Errorf("load overview accounts: %w", err)
	}
	goalCount, err := service.repository.CountOverviewGoals(ctx, userID)
	if err != nil {
		return Overview{}, fmt.Errorf("count overview goals: %w", err)
	}

	result := Overview{
		Settings: OverviewSettings{
			DisplayName: settings.DisplayName, AppName: settings.AppName,
			BaseCurrency: settings.BaseCurrency, Timezone: settings.Timezone,
			PreferredDateFormat:    settings.PreferredDateFormat,
			DefaultDashboardPeriod: settings.DefaultDashboardPeriod,
		},
		Accounts:        make([]OverviewAccount, 0, len(accounts)),
		AccountCount:    len(accounts),
		GoalCount:       goalCount,
		CurrentComplete: true,
	}
	missing := map[string]bool{}
	var assets, liabilities, liquid, investible int64
	for _, account := range accounts {
		result.Accounts = append(result.Accounts, OverviewAccount{
			ID: account.ID, Name: account.Name, Currency: account.Currency,
			CurrentValueMinor: strconv.FormatInt(account.CurrentValueMinor, 10),
			IsLiability:       account.IsLiability, IsIncludedInNetWorth: account.IsIncludedInNetWorth,
			CategoryName: account.CategoryName, InstitutionName: account.InstitutionName,
		})
		if !account.IsIncludedInNetWorth {
			continue
		}
		if account.Currency != settings.BaseCurrency {
			missing[account.Currency] = true
			result.CurrentComplete = false
			continue
		}
		value := account.CurrentValueMinor
		if account.IsLiability {
			liabilities, err = checkedAdd(liabilities, value)
		} else {
			assets, err = checkedAdd(assets, value)
			if err == nil && account.IsLiquid {
				liquid, err = checkedAdd(liquid, value)
			}
			if err == nil && account.IsInvestible {
				investible, err = checkedAdd(investible, value)
			}
		}
		if err != nil {
			return Overview{}, err
		}
	}
	netWorth, err := checkedAdd(assets, -liabilities)
	if err != nil {
		return Overview{}, err
	}
	result.Totals = OverviewTotals{
		Assets: strconv.FormatInt(assets, 10), Liabilities: strconv.FormatInt(liabilities, 10),
		NetWorth: strconv.FormatInt(netWorth, 10), Liquid: strconv.FormatInt(liquid, 10),
		Investible: strconv.FormatInt(investible, 10),
	}
	for currency := range missing {
		result.MissingCurrencies = append(result.MissingCurrencies, currency)
	}
	sort.Strings(result.MissingCurrencies)
	return result, nil
}

func checkedAdd(left, right int64) (int64, error) {
	if (right > 0 && left > math.MaxInt64-right) || (right < 0 && left < math.MinInt64-right) {
		return 0, errors.New("overview total exceeds supported integer range")
	}
	return left + right, nil
}
