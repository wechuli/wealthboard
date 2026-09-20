package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestPhase6ParityEvidence(t *testing.T) {
	db := openPhase5TestDatabase(t)
	ctx := context.Background()
	userID := uuid.New()
	if _, err := db.ExecContext(ctx, `
INSERT INTO users (id,username,created_at,updated_at)
VALUES ($1,$2,$3,$3)`, userID, "phase-six-go-"+userID.String(), time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("create parity user: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO user_settings (id,user_id,display_name,base_currency,supported_currencies,timezone,created_at,updated_at)
VALUES ($1,$2,'Phase Six Go','KES','["KES"]','UTC',$3,$3)`, uuid.New(), userID, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("create parity settings: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id=$1`, userID)
	})

	fixture, err := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", "phase6-parity-v8.json"))
	if err != nil {
		t.Fatalf("read parity fixture: %v", err)
	}
	portability := NewPortabilityService(db)
	portability.now = func() time.Time { return time.Date(2026, 1, 2, 23, 59, 59, 0, time.UTC) }
	if _, err := portability.RestoreJSON(ctx, userID, fixture); err != nil {
		t.Fatalf("restore parity fixture: %v", err)
	}
	archive, err := portability.Export(ctx, userID)
	if err != nil {
		t.Fatalf("export parity fixture: %v", err)
	}

	accountNames := map[string]string{}
	instrumentNames := map[string]string{}
	for _, row := range archive.Accounts {
		accountNames[stringValue(row["id"])] = stringValue(row["name"])
	}
	for _, row := range archive.InvestmentInstruments {
		instrumentNames[stringValue(row["id"])] = stringValue(row["name"])
	}

	repository := NewSQLGoalsReportsRepository(db)
	goalsReports := NewGoalsReportsService(repository)
	goalsReports.now = portability.now
	goals, err := goalsReports.ListGoals(ctx, userID)
	if err != nil {
		t.Fatalf("read parity goals: %v", err)
	}
	goalsReports.now = func() time.Time { return time.Date(2026, 1, 4, 12, 0, 0, 0, time.UTC) }
	report, err := goalsReports.Dashboard(ctx, userID, "all")
	if err != nil {
		t.Fatalf("read parity report: %v", err)
	}
	chart, err := repository.LoadChartData(ctx, userID)
	if err != nil {
		t.Fatalf("load parity positions: %v", err)
	}
	var brokerage chartAccount
	for _, account := range chart.Accounts {
		if account.Name == "Brokerage" {
			brokerage = account
		}
	}
	position, err := buildChartPositionSnapshot(chart, brokerage, portability.now())
	if err != nil {
		t.Fatalf("calculate parity positions: %v", err)
	}
	holdings := make([]map[string]any, 0, len(position.Positions))
	positionsMinor := int64(0)
	for _, holding := range position.Positions {
		name, price := "", any(nil)
		if holding.Price != nil {
			name, price = holding.Price.InstrumentName, holding.Price.Price
		}
		positionsMinor += holding.Value
		holdings = append(holdings, map[string]any{
			"instrument": name, "quantity": canonicalRat(holding.Quantity), "price": price,
			"valueMinor": fmt.Sprint(holding.Value),
		})
	}
	sort.Slice(holdings, func(left, right int) bool {
		return fmt.Sprint(holdings[left]["instrument"]) < fmt.Sprint(holdings[right]["instrument"])
	})

	featureReads := NewFeatureReads(db)
	snapshotID, err := uuid.Parse(stringValue(archive.EstatePlanSnapshots[0]["id"]))
	if err != nil {
		t.Fatalf("parse parity snapshot ID: %v", err)
	}
	snapshot, err := featureReads.EstateSnapshot(ctx, userID, snapshotID)
	if err != nil {
		t.Fatalf("read parity snapshot: %v", err)
	}
	var snapshotContent any
	if err := json.Unmarshal(snapshot.Content, &snapshotContent); err != nil {
		t.Fatalf("decode parity snapshot: %v", err)
	}

	outcome := map[string]any{
		"export":   phase6ExportProjection(archive, accountNames, instrumentNames),
		"balances": phase6Balances(archive.Accounts),
		"positions": map[string]any{
			"account": "Brokerage", "cashMinor": fmt.Sprint(position.Total - positionsMinor),
			"positionsMinor": fmt.Sprint(positionsMinor), "totalMinor": fmt.Sprint(position.Total),
			"complete": position.Complete, "holdings": holdings,
		},
		"goals": phase6Goals(goals),
		"reports": map[string]any{
			"baseCurrency": report.BaseCurrency, "totals": report.Totals,
			"allocation":            phase6Allocations(report.Allocation),
			"institutionAllocation": phase6Allocations(report.InstitutionAllocation),
			"instrumentAllocation":  phase6Allocations(report.InstrumentAllocation),
		},
		"estateSnapshots": []map[string]any{{
			"title": snapshot.Title, "valueAsOfDate": snapshot.ValueAsOfDate.Format(time.DateOnly),
			"baseCurrency": snapshot.BaseCurrency, "content": snapshotContent, "contentHash": snapshot.ContentHash,
		}},
	}
	data, err := json.MarshalIndent(outcome, "", "  ")
	if err != nil {
		t.Fatalf("encode parity outcome: %v", err)
	}
	expected, err := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", "phase6-parity-expected.json"))
	if err != nil {
		t.Fatalf("read parity expectation: %v", err)
	}
	var expectedOutcome any
	if err := json.Unmarshal(expected, &expectedOutcome); err != nil {
		t.Fatalf("decode parity expectation: %v", err)
	}
	var actualOutcome any
	if err := json.Unmarshal(data, &actualOutcome); err != nil {
		t.Fatalf("decode parity outcome: %v", err)
	}
	if !reflect.DeepEqual(actualOutcome, expectedOutcome) {
		t.Fatalf("PostgreSQL outcome differs from frozen Phase 6 parity evidence\nactual: %s\nexpected: %s", data, expected)
	}
}

func phase6ExportProjection(archive UserArchive, accountNames, instrumentNames map[string]string) map[string]any {
	accounts := make([]map[string]any, 0, len(archive.Accounts))
	for _, row := range archive.Accounts {
		accounts = append(accounts, map[string]any{"name": stringValue(row["name"]), "currency": stringValue(row["currency"]), "trackingMode": stringValue(row["trackingMode"]), "currentValueMinor": stringValue(row["currentValueMinor"])})
	}
	sort.Slice(accounts, func(left, right int) bool {
		return stringValue(accounts[left]["name"]) < stringValue(accounts[right]["name"])
	})
	transactions := make([]map[string]any, 0, len(archive.Transactions))
	for _, row := range archive.Transactions {
		transactions = append(transactions, map[string]any{"account": accountNames[stringValue(row["accountId"])], "type": stringValue(row["type"]), "amountMinor": stringValue(row["amountMinor"]), "date": datePrefix(row["transactionDate"]), "externalId": row["externalId"]})
	}
	sort.Slice(transactions, func(left, right int) bool {
		leftKey := fmt.Sprintf("%s:%s:%s", transactions[left]["account"], transactions[left]["date"], transactions[left]["type"])
		rightKey := fmt.Sprintf("%s:%s:%s", transactions[right]["account"], transactions[right]["date"], transactions[right]["type"])
		return leftKey < rightKey
	})
	events := make([]map[string]any, 0, len(archive.PositionEvents))
	for _, row := range archive.PositionEvents {
		events = append(events, map[string]any{"account": accountNames[stringValue(row["accountId"])], "instrument": instrumentNames[stringValue(row["instrumentId"])], "type": stringValue(row["type"]), "quantity": stringValue(row["quantity"]), "cashEffectMinor": stringValue(row["cashEffectMinor"]), "date": datePrefix(row["tradeDate"])})
	}
	snapshots := make([]map[string]any, 0, len(archive.EstatePlanSnapshots))
	for _, row := range archive.EstatePlanSnapshots {
		var content any
		_ = json.Unmarshal([]byte(stringValue(row["content"])), &content)
		snapshots = append(snapshots, map[string]any{"title": stringValue(row["title"]), "valueAsOfDate": datePrefix(row["valueAsOfDate"]), "baseCurrency": stringValue(row["baseCurrency"]), "content": content, "contentHash": stringValue(row["contentHash"])})
	}
	return map[string]any{
		"format": archive.Format, "version": archive.Version, "settings": archive.Settings,
		"counts":   map[string]any{"accounts": len(archive.Accounts), "transactions": len(archive.Transactions), "valuations": len(archive.Valuations), "goals": len(archive.Goals), "positionEvents": len(archive.PositionEvents), "snapshots": len(archive.EstatePlanSnapshots)},
		"accounts": accounts, "transactions": transactions, "positionEvents": events, "snapshots": snapshots,
	}
}

func phase6Balances(rows []map[string]any) []map[string]any {
	result := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		result = append(result, map[string]any{"name": stringValue(row["name"]), "currentValueMinor": stringValue(row["currentValueMinor"])})
	}
	sort.Slice(result, func(left, right int) bool {
		return stringValue(result[left]["name"]) < stringValue(result[right]["name"])
	})
	return result
}

func phase6Goals(rows []GoalRead) []map[string]any {
	result := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		linked := any(nil)
		if row.LinkedAccount != nil {
			linked = row.LinkedAccount.Name
		}
		result = append(result, map[string]any{"name": row.Name, "targetAmountMinor": row.TargetAmountMinor, "currentAmountMinor": row.CurrentAmountMinor, "currency": row.Currency, "targetDate": row.TargetDate, "linkedAccount": linked, "progressPercent": row.ProgressPercent})
	}
	return result
}

func phase6Allocations(rows []AllocationItemRead) []map[string]any {
	result := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		result = append(result, map[string]any{"name": row.Name, "valueMinor": row.ValueMinor})
	}
	return result
}

func datePrefix(value any) string {
	text := stringValue(value)
	if len(text) >= len(time.DateOnly) {
		return text[:len(time.DateOnly)]
	}
	return text
}
