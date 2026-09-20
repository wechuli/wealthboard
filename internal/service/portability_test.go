package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
)

func TestDecodeAndUpgradeArchiveVersionsDeterministically(t *testing.T) {
	for version := 2; version <= CurrentUserArchiveVersion; version++ {
		t.Run(fmt.Sprintf("v%d", version), func(t *testing.T) {
			data := representativeArchiveJSON(t, version)
			first, err := decodeAndUpgradeArchive(data)
			if err != nil {
				t.Fatalf("upgrade v%d archive: %v", version, err)
			}
			second, err := decodeAndUpgradeArchive(data)
			if err != nil {
				t.Fatalf("upgrade v%d archive again: %v", version, err)
			}
			firstJSON, _ := json.Marshal(first)
			secondJSON, _ := json.Marshal(second)
			if string(firstJSON) != string(secondJSON) {
				t.Fatalf("v%d upgrade is not deterministic\nfirst=%s\nsecond=%s", version, firstJSON, secondJSON)
			}
			assertRepresentativeUpgrade(t, version, first)

			oldCategoryID := requiredString(first.Categories[0], "id")
			oldBalanceAccountID := requiredString(first.Accounts[0], "id")
			if _, err := validateAndRemapArchive(&first); err != nil {
				t.Fatalf("validate upgraded v%d archive: %v", version, err)
			}
			if requiredString(first.Categories[0], "id") == oldCategoryID || requiredString(first.Accounts[0], "id") == oldBalanceAccountID {
				t.Fatal("restore IDs were not remapped")
			}
			if first.Accounts[0]["categoryId"] != first.Categories[0]["id"] || first.Transactions[0]["accountId"] != first.Accounts[0]["id"] || first.Valuations[0]["accountId"] != first.Accounts[0]["id"] {
				t.Fatalf("core relationships were not remapped: %+v", first)
			}
			if version >= 6 && first.EstateAccountDirectives[0]["estatePlanId"] != first.EstatePlans[0]["id"] {
				t.Fatalf("estate relationship was not remapped: %+v", first.EstateAccountDirectives[0])
			}
			if version >= 7 && first.PositionEvents[0]["instrumentId"] != first.InvestmentInstruments[0]["id"] {
				t.Fatalf("investment relationship was not remapped: %+v", first.PositionEvents[0])
			}
		})
	}
}

func assertRepresentativeUpgrade(t *testing.T, sourceVersion int, archive UserArchive) {
	t.Helper()
	if archive.Version != CurrentUserArchiveVersion {
		t.Fatalf("upgraded version=%d", archive.Version)
	}
	wantMilestones := 0
	if sourceVersion >= 3 {
		wantMilestones = 1
	}
	if len(archive.GoalMilestones) != wantMilestones {
		t.Fatalf("milestones=%d want=%d", len(archive.GoalMilestones), wantMilestones)
	}
	wantInstitutionID := "institution-1"
	if sourceVersion < 4 {
		wantInstitutionID = "legacy-institution-1"
	}
	if len(archive.Institutions) != 1 || archive.Institutions[0]["name"] != "Example Bank" || archive.Accounts[0]["institutionId"] != wantInstitutionID {
		t.Fatalf("institution upgrade mismatch: institutions=%+v account=%+v", archive.Institutions, archive.Accounts[0])
	}
	wantExternalID := ""
	if sourceVersion >= 5 {
		wantExternalID = "cash-opening"
	}
	if stringValue(archive.Transactions[0]["externalId"]) != wantExternalID {
		t.Fatalf("externalId=%q want=%q", stringValue(archive.Transactions[0]["externalId"]), wantExternalID)
	}
	wantEstate := 0
	if sourceVersion >= 6 {
		wantEstate = 1
	}
	if len(archive.EstatePlans) != wantEstate || len(archive.Beneficiaries) != wantEstate {
		t.Fatalf("estate additions plans=%d beneficiaries=%d want=%d", len(archive.EstatePlans), len(archive.Beneficiaries), wantEstate)
	}
	wantInvestments := 0
	if sourceVersion >= 7 {
		wantInvestments = 1
	}
	if len(archive.InvestmentInstruments) != wantInvestments || len(archive.PositionEvents) != wantInvestments {
		t.Fatalf("investment additions instruments=%d events=%d want=%d", len(archive.InvestmentInstruments), len(archive.PositionEvents), wantInvestments)
	}
	for _, account := range archive.Accounts {
		wantMode := "balance"
		if sourceVersion >= 7 && requiredString(account, "id") == "position-account" {
			wantMode = "positions"
		}
		if stringValue(account["trackingMode"]) != wantMode {
			t.Fatalf("account %s mode=%q want=%q", requiredString(account, "id"), stringValue(account["trackingMode"]), wantMode)
		}
	}
	wantStockDays, wantFundDays := "7", "31"
	if sourceVersion == 8 {
		wantStockDays, wantFundDays = "14", "45"
	}
	if stringValue(archive.Settings["positionStaleDaysStock"]) != wantStockDays || stringValue(archive.Settings["positionStaleDaysFund"]) != wantFundDays {
		t.Fatalf("stale-price defaults=%+v", archive.Settings)
	}
	if sourceVersion == 7 && stringValue(archive.PositionEvents[0]["eventSequence"]) != "1" {
		t.Fatalf("v7 event sequence=%v", archive.PositionEvents[0]["eventSequence"])
	}
	wantConversions := 0
	if sourceVersion == 8 {
		wantConversions = 1
	}
	if len(archive.AccountConversions) != wantConversions {
		t.Fatalf("account conversions=%d want=%d", len(archive.AccountConversions), wantConversions)
	}
}

func TestValidateAndRemapArchiveV8SnapshotHashAndRelationships(t *testing.T) {
	content := `{"format":"wealthboard-estate-summary","version":1,"assets":[],"beneficiaries":[],"reviewItems":[]}`
	hash := sha256.Sum256([]byte(content))
	archive := minimalV8Archive()
	archive.EstatePlans = []map[string]any{{"id": "plan-1"}}
	archive.EstatePlanSnapshots = []map[string]any{{"id": "snapshot-1", "estatePlanId": "plan-1", "content": content, "contentHash": hex.EncodeToString(hash[:])}}
	oldCategoryID, oldAccountID := archive.Categories[0]["id"], archive.Accounts[0]["id"]
	if _, err := validateAndRemapArchive(&archive); err != nil {
		t.Fatalf("validate v8 archive: %v", err)
	}
	if archive.Categories[0]["id"] == oldCategoryID || archive.Accounts[0]["id"] == oldAccountID {
		t.Fatal("restore IDs were not remapped")
	}
	if archive.Accounts[0]["categoryId"] != archive.Categories[0]["id"] || archive.EstatePlanSnapshots[0]["estatePlanId"] != archive.EstatePlans[0]["id"] {
		t.Fatalf("relationships not remapped: %+v", archive)
	}

	invalid := minimalV8Archive()
	invalid.Accounts[0]["categoryId"] = "missing"
	if _, err := validateAndRemapArchive(&invalid); !errors.Is(err, ErrPortabilityValidation) {
		t.Fatalf("invalid relationship error=%v", err)
	}
}

func TestDecodeArchiveRejectsCredentials(t *testing.T) {
	data := []byte(`{"format":"wealthboard-user-json","version":8,"settings":{},"categories":[],"aiCredentials":[{"encryptedApiKey":"secret"}]}`)
	if _, err := decodeAndUpgradeArchive(data); !errors.Is(err, ErrPortabilityValidation) {
		t.Fatalf("credential archive error=%v", err)
	}
}

func minimalV8Archive() UserArchive {
	return UserArchive{
		Format: "wealthboard-user-json", Version: 8, ExportedAt: "2026-09-20T10:00:00Z",
		Settings: map[string]any{"displayName": "Owner", "baseCurrency": "KES", "supportedCurrencies": "[\"KES\"]", "timezone": "UTC",
			"preferredDateFormat": "dd MMM yyyy", "appName": "Wealthboard", "defaultDashboardPeriod": "1y", "sessionTimeoutMinutes": json.Number("10080"),
			"defaultGoalReturnBps": json.Number("800"), "positionStaleDaysStock": json.Number("7"), "positionStaleDaysEtf": json.Number("7"), "positionStaleDaysFund": json.Number("31")},
		Categories: []map[string]any{{"id": "category-1"}},
		Accounts:   []map[string]any{{"id": "account-1", "categoryId": "category-1", "institutionId": nil, "goalId": nil, "trackingMode": "balance"}},
	}
}

func representativeArchiveJSON(t *testing.T, version int) []byte {
	t.Helper()
	raw := representativeV8ArchiveMap()
	raw["version"] = version
	settings := raw["settings"].(map[string]any)
	accounts := raw["accounts"].([]any)
	transactions := raw["transactions"].([]any)
	positionEvents := raw["positionEvents"].([]any)

	if version < 8 {
		delete(raw, "accountConversions")
		delete(settings, "positionStaleDaysStock")
		delete(settings, "positionStaleDaysEtf")
		delete(settings, "positionStaleDaysFund")
		for _, value := range transactions {
			delete(value.(map[string]any), "eventGroupId")
		}
		for _, value := range positionEvents {
			row := value.(map[string]any)
			delete(row, "relatedInstrumentId")
			delete(row, "actionRatioNumerator")
			delete(row, "actionRatioDenominator")
			delete(row, "eventSequence")
		}
	}
	if version < 7 {
		for _, value := range accounts {
			delete(value.(map[string]any), "trackingMode")
		}
		for _, key := range []string{"investmentInstruments", "positionEvents", "securityPrices", "positionReconciliations"} {
			delete(raw, key)
		}
	}
	if version < 6 {
		for _, key := range []string{"beneficiaries", "estatePlans", "estateAccountDirectives", "estateAllocations", "estateResiduaryAllocations", "estatePlanSnapshots"} {
			delete(raw, key)
		}
	}
	if version < 5 {
		for _, value := range transactions {
			delete(value.(map[string]any), "externalId")
		}
	}
	if version < 4 {
		delete(raw, "institutions")
		for _, value := range accounts {
			row := value.(map[string]any)
			delete(row, "institutionId")
			row["institution"] = "  Example   Bank "
		}
	}
	if version < 3 {
		delete(raw, "goalMilestones")
		delete(raw, "goalAlertDismissals")
	}
	data, err := json.Marshal(raw)
	if err != nil {
		t.Fatalf("marshal representative v%d archive: %v", version, err)
	}
	return data
}

func representativeV8ArchiveMap() map[string]any {
	const createdAt = "2026-01-01T00:00:00Z"
	const updatedAt = "2026-01-02T00:00:00Z"
	snapshotContent := `{"format":"wealthboard-estate-summary","version":1,"assets":[],"beneficiaries":[],"reviewItems":[]}`
	snapshotHash := sha256.Sum256([]byte(snapshotContent))
	return map[string]any{
		"format":     "wealthboard-user-json",
		"version":    8,
		"exportedAt": "2026-09-20T10:00:00Z",
		"settings": map[string]any{
			"displayName": "Portable Owner", "baseCurrency": "KES", "supportedCurrencies": `["KES","USD"]`, "timezone": "UTC",
			"preferredDateFormat": "dd MMM yyyy", "appName": "Wealthboard", "defaultDashboardPeriod": "1y",
			"sessionTimeoutMinutes": 10080, "defaultGoalReturnBps": 800, "positionStaleDaysStock": 14,
			"positionStaleDaysEtf": 14, "positionStaleDaysFund": 45,
		},
		"categories": []any{map[string]any{
			"id": "category-1", "name": "Assets", "slug": "portable-assets", "icon": "Wallet", "displayOrder": 1,
			"assetOrLiability": "asset", "description": nil, "isLiquid": true, "isInvestible": true,
			"isArchived": false, "isSystem": false, "createdAt": createdAt, "updatedAt": updatedAt,
		}},
		"institutions": []any{map[string]any{
			"id": "institution-1", "name": "Example Bank", "type": "bank", "websiteUrl": nil, "countryCode": "KE",
			"address": nil, "notes": nil, "archivedAt": nil, "createdAt": createdAt, "updatedAt": updatedAt,
		}},
		"accounts": []any{
			map[string]any{
				"id": "balance-account", "name": "Everyday Cash", "description": nil, "categoryId": "category-1", "institutionId": "institution-1",
				"accountReference": nil, "currency": "KES", "trackingMode": "balance", "currentValueMinor": 999999, "costBasisMinor": nil,
				"isLiability": false, "isIncludedInNetWorth": true, "goalId": "goal-1", "notes": nil, "openedAt": "2026-01-01T12:00:00Z",
				"archivedAt": nil, "createdAt": createdAt, "updatedAt": updatedAt,
			},
			map[string]any{
				"id": "position-account", "name": "Brokerage", "description": nil, "categoryId": "category-1", "institutionId": "institution-1",
				"accountReference": nil, "currency": "KES", "trackingMode": "positions", "currentValueMinor": 999999, "costBasisMinor": nil,
				"isLiability": false, "isIncludedInNetWorth": true, "goalId": nil, "notes": nil, "openedAt": "2026-01-01T12:00:00Z",
				"archivedAt": nil, "createdAt": createdAt, "updatedAt": updatedAt,
			},
			map[string]any{
				"id": "converted-source", "name": "Legacy Brokerage", "description": nil, "categoryId": "category-1", "institutionId": "institution-1",
				"accountReference": nil, "currency": "KES", "trackingMode": "balance", "currentValueMinor": 0, "costBasisMinor": nil,
				"isLiability": false, "isIncludedInNetWorth": false, "goalId": nil, "notes": nil, "openedAt": "2025-01-01T12:00:00Z",
				"archivedAt": "2026-01-01T00:00:00Z", "createdAt": createdAt, "updatedAt": updatedAt,
			},
		},
		"transactions": []any{
			map[string]any{"id": "transaction-opening", "accountId": "balance-account", "type": "opening_balance", "amountMinor": 1000, "currency": "KES", "transactionDate": "2026-01-01T12:00:00Z", "description": "Opening", "notes": nil, "externalId": "cash-opening", "transferGroupId": nil, "eventGroupId": nil, "idempotencyKey": nil, "createdAt": createdAt, "updatedAt": updatedAt},
			map[string]any{"id": "transaction-deposit", "accountId": "balance-account", "type": "deposit", "amountMinor": 50, "currency": "KES", "transactionDate": "2026-01-03T12:00:00Z", "description": "Deposit", "notes": nil, "externalId": "cash-deposit", "transferGroupId": nil, "eventGroupId": nil, "idempotencyKey": nil, "createdAt": createdAt, "updatedAt": updatedAt},
		},
		"valuations":                 []any{map[string]any{"id": "valuation-1", "accountId": "balance-account", "valueMinor": 1200, "currency": "KES", "valuationDate": "2026-01-02T12:00:00Z", "notes": nil, "createdAt": createdAt}},
		"exchangeRates":              []any{map[string]any{"id": "rate-1", "baseCurrency": "USD", "quoteCurrency": "KES", "rate": "130", "effectiveDate": "2026-01-01T12:00:00Z", "source": "fixture", "createdAt": createdAt}},
		"goals":                      []any{map[string]any{"id": "goal-1", "name": "Reserve", "description": nil, "targetAmountMinor": 10000, "currentAmountMinor": 0, "currency": "KES", "targetDate": "2027-01-01T12:00:00Z", "linkedAccountId": "balance-account", "icon": "Target", "status": "active", "priority": 1, "assumedAnnualReturnBps": 800, "createdAt": createdAt, "updatedAt": updatedAt}},
		"goalContributionPlans":      []any{map[string]any{"id": "plan-contribution-1", "goalId": "goal-1", "plannedContributionMinor": 100, "frequency": "monthly", "startDate": "2026-01-01T12:00:00Z", "endDate": nil, "createdAt": createdAt, "updatedAt": updatedAt}},
		"goalMilestones":             []any{map[string]any{"id": "milestone-1", "goalId": "goal-1", "name": "First step", "targetAmountMinor": 1000, "targetDate": nil, "createdAt": createdAt, "updatedAt": updatedAt}},
		"goalAlertDismissals":        []any{map[string]any{"goalId": "goal-1", "alertKey": "behind", "dismissedAt": updatedAt}},
		"beneficiaries":              []any{map[string]any{"id": "beneficiary-1", "kind": "person", "name": "Amina Example", "relationship": "Child", "contactSummary": nil, "notes": nil, "archivedAt": nil, "createdAt": createdAt, "updatedAt": updatedAt}},
		"estatePlans":                []any{map[string]any{"id": "estate-plan-1", "title": "Family plan", "jurisdiction": "Kenya", "lastReviewedDate": nil, "reviewReminderDate": nil, "createdAt": createdAt, "updatedAt": updatedAt}},
		"estateAccountDirectives":    []any{map[string]any{"id": "directive-1", "estatePlanId": "estate-plan-1", "accountId": "balance-account", "isIncluded": true, "ownershipShareBps": 10000, "transferContext": "estate", "distributionMethod": "sell_and_divide", "documentReference": nil, "notes": nil, "reviewedAt": nil, "createdAt": createdAt, "updatedAt": updatedAt}},
		"estateAllocations":          []any{map[string]any{"id": "allocation-1", "estatePlanId": "estate-plan-1", "directiveId": "directive-1", "beneficiaryId": "beneficiary-1", "tier": "primary", "allocationBps": 10000, "notes": nil, "createdAt": createdAt, "updatedAt": updatedAt}},
		"estateResiduaryAllocations": []any{map[string]any{"id": "residuary-1", "estatePlanId": "estate-plan-1", "beneficiaryId": "beneficiary-1", "tier": "primary", "allocationBps": 10000, "notes": nil, "createdAt": createdAt, "updatedAt": updatedAt}},
		"estatePlanSnapshots":        []any{map[string]any{"id": "snapshot-1", "estatePlanId": "estate-plan-1", "version": 1, "title": "Family plan", "valueAsOfDate": "2026-01-02", "baseCurrency": "KES", "content": snapshotContent, "contentHash": hex.EncodeToString(snapshotHash[:]), "generatedAt": updatedAt}},
		"investmentInstruments":      []any{map[string]any{"id": "instrument-1", "externalId": "instrument-external", "name": "Example Equity", "symbol": "EXM", "identifierType": "ticker_exchange", "identifier": "EXM", "exchangeMic": "XNAI", "assetType": "stock", "quoteCurrency": "KES", "archivedAt": nil, "createdAt": createdAt, "updatedAt": updatedAt}},
		"positionEvents":             []any{map[string]any{"id": "position-event-1", "accountId": "position-account", "instrumentId": "instrument-1", "relatedInstrumentId": nil, "type": "opening_position", "quantity": "2", "unitPrice": "100", "tradeCurrency": "KES", "grossAmountMinor": 20000, "feeAmountMinor": nil, "feeCurrency": nil, "cashEffectMinor": 0, "appliedExchangeRate": nil, "openingCostBasisMinor": 20000, "actionRatioNumerator": nil, "actionRatioDenominator": nil, "tradeDate": "2026-01-01T12:00:00Z", "eventSequence": 1, "settlementDate": nil, "externalId": "position-external", "eventGroupId": nil, "idempotencyKey": nil, "description": "Opening position", "notes": nil, "createdAt": createdAt, "updatedAt": updatedAt}},
		"securityPrices":             []any{map[string]any{"id": "price-1", "instrumentId": "instrument-1", "externalId": "price-external", "price": "125", "currency": "KES", "effectiveDate": "2026-01-02T12:00:00Z", "source": "fixture", "provenance": nil, "createdAt": createdAt, "updatedAt": updatedAt}},
		"positionReconciliations":    []any{map[string]any{"id": "reconciliation-1", "accountId": "position-account", "observationDate": "2026-01-02T12:00:00Z", "reportedCashMinor": 0, "reportedTotalMinor": 25000, "notes": nil, "createdAt": createdAt, "updatedAt": updatedAt}},
		"accountConversions":         []any{map[string]any{"id": "conversion-1", "sourceAccountId": "converted-source", "targetAccountId": "position-account", "conversionDate": "2026-01-01T12:00:00Z", "sourceBalanceMinor": 0, "idempotencyKey": "conversion-fixture", "createdAt": createdAt}},
	}
}
