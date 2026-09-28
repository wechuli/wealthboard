package service

import (
	"errors"
	"testing"
)

func TestMetadataValidationNormalizesInputs(t *testing.T) {
	settings := SettingsInput{
		DisplayName: " Owner ", AppName: " Wealthboard ", BaseCurrency: " kes ",
		SupportedCurrencies: []string{" usd ", "KES", "USD"}, Timezone: "Africa/Nairobi",
		PreferredDateFormat: "yyyy-MM-dd", DefaultDashboardPeriod: "1y",
		SessionTimeoutMinutes: 15, DefaultGoalReturnBPS: 800,
		PositionStaleDaysStock: 7, PositionStaleDaysETF: 7, PositionStaleDaysFund: 31,
	}
	if err := validateSettings(&settings); err != nil {
		t.Fatalf("validateSettings() error = %v", err)
	}
	if settings.DisplayName != "Owner" || settings.BaseCurrency != "KES" || len(settings.SupportedCurrencies) != 2 {
		t.Fatalf("normalized settings = %+v", settings)
	}

	institution := InstitutionInput{Name: "  Acme\t Bank\n", Type: "bank", WebsiteURL: "https://example.com", CountryCode: "ke"}
	if err := validateInstitutionInput(&institution); err != nil {
		t.Fatalf("validateInstitutionInput() error = %v", err)
	}
	if institution.Name != "Acme Bank" || institution.CountryCode != "KE" || normalizeInstitutionName(institution.Name) != "acme bank" {
		t.Fatalf("normalized institution = %+v", institution)
	}
}

func TestMetadataValidationRejectsInvalidValues(t *testing.T) {
	tests := []struct {
		name string
		run  func() error
	}{
		{name: "invalid timezone", run: func() error {
			input := SettingsInput{DisplayName: "Owner", AppName: "Wealthboard", BaseCurrency: "KES", Timezone: "Mars/Olympus", PreferredDateFormat: "yyyy-MM-dd", DefaultDashboardPeriod: "1y", SessionTimeoutMinutes: 15, PositionStaleDaysStock: 1, PositionStaleDaysETF: 1, PositionStaleDaysFund: 1}
			return validateSettings(&input)
		}},
		{name: "invalid institution URL", run: func() error {
			input := InstitutionInput{Name: "Bank", Type: "bank", WebsiteURL: "ftp://example.com"}
			return validateInstitutionInput(&input)
		}},
		{name: "zero exchange rate", run: func() error {
			input := ExchangeRateInput{BaseCurrency: "KES", QuoteCurrency: "USD", Rate: "0.00", EffectiveDate: "2026-09-20"}
			_, err := validateExchangeRate(&input)
			return err
		}},
		{name: "invalid date", run: func() error {
			input := ExchangeRateInput{BaseCurrency: "KES", QuoteCurrency: "USD", Rate: "0.01", EffectiveDate: "2026-02-30"}
			_, err := validateExchangeRate(&input)
			return err
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var metadataErr *MetadataError
			if err := test.run(); !errors.As(err, &metadataErr) || metadataErr.Kind != MetadataValidation {
				t.Fatalf("error = %v, want metadata validation error", err)
			}
		})
	}
}

func TestSlugifyCategory(t *testing.T) {
	if got := slugifyCategory("  Café & Savings  "); got != "cafe-savings" {
		t.Fatalf("slugifyCategory() = %q", got)
	}
}
