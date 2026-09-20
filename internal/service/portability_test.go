package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"testing"
)

func TestDecodeAndUpgradeArchiveV2Deterministically(t *testing.T) {
	data := []byte(`{
"format":"wealthboard-user-json","version":2,"exportedAt":"2026-09-20T10:00:00Z",
"settings":{"displayName":"Owner","baseCurrency":"KES","supportedCurrencies":"[\"KES\"]","timezone":"UTC","preferredDateFormat":"dd MMM yyyy","appName":"Wealthboard","defaultDashboardPeriod":"1y","sessionTimeoutMinutes":10080,"defaultGoalReturnBps":800},
"categories":[{"id":"category-1","name":"Cash","slug":"cash","icon":"Wallet","displayOrder":0,"assetOrLiability":"asset","description":null,"isLiquid":true,"isInvestible":false,"isArchived":false,"isSystem":false,"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}],
"accounts":[{"id":"account-1","name":"Wallet","description":null,"categoryId":"category-1","institution":"  Example   Bank ","accountReference":null,"currency":"KES","currentValueMinor":100,"costBasisMinor":null,"isLiability":false,"isIncludedInNetWorth":true,"goalId":null,"notes":null,"openedAt":null,"archivedAt":null,"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}],
"transactions":[],"valuations":[],"exchangeRates":[],"goals":[],"goalContributionPlans":[]}`)

	first, err := decodeAndUpgradeArchive(data)
	if err != nil {
		t.Fatalf("upgrade v2 archive: %v", err)
	}
	second, err := decodeAndUpgradeArchive(data)
	if err != nil {
		t.Fatalf("upgrade v2 archive again: %v", err)
	}
	firstJSON, _ := json.Marshal(first)
	secondJSON, _ := json.Marshal(second)
	if string(firstJSON) != string(secondJSON) {
		t.Fatalf("v2 upgrade is not deterministic\nfirst=%s\nsecond=%s", firstJSON, secondJSON)
	}
	if first.Version != 8 || len(first.Institutions) != 1 || first.Institutions[0]["name"] != "Example Bank" || first.Accounts[0]["institutionId"] != "legacy-institution-1" {
		t.Fatalf("upgraded archive = %+v", first)
	}
	if first.Accounts[0]["trackingMode"] != "balance" || first.Settings["positionStaleDaysFund"].(json.Number).String() != "31" {
		t.Fatalf("v8 defaults missing: account=%+v settings=%+v", first.Accounts[0], first.Settings)
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
