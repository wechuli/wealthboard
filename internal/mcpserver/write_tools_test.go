package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/wechuli/wealthboard/internal/service"
)

type fakeLedger struct {
	users        []uuid.UUID
	transactions map[uuid.UUID]service.TransactionMutationInput
	valuations   []service.ValuationMutationInput
}

func (fake *fakeLedger) CreateTransaction(_ context.Context, userID uuid.UUID, input service.TransactionMutationInput) (uuid.UUID, error) {
	fake.users = append(fake.users, userID)
	if input.TransactionDate.After(time.Date(2026, time.November, 6, 0, 0, 0, 0, time.UTC)) {
		return uuid.Nil, service.ErrLedgerValidation
	}
	if input.Type == "dividend" {
		return uuid.Nil, fmt.Errorf("%w: use the position workflow for this activity", service.ErrLedgerValidation)
	}
	if existing, ok := fake.transactions[input.IdempotencyKey]; ok {
		if existing != input {
			return uuid.Nil, fmt.Errorf("%w: idempotency key was reused with incompatible transaction data", service.ErrLedgerConflict)
		}
		return input.IdempotencyKey, nil
	}
	if fake.transactions == nil {
		fake.transactions = map[uuid.UUID]service.TransactionMutationInput{}
	}
	fake.transactions[input.IdempotencyKey] = input
	return input.IdempotencyKey, nil
}

func (fake *fakeLedger) CreateValuation(_ context.Context, userID uuid.UUID, input service.ValuationMutationInput) (uuid.UUID, error) {
	fake.users = append(fake.users, userID)
	fake.valuations = append(fake.valuations, input)
	return uuid.New(), nil
}

func newWriteTestServer(t *testing.T, readers *fakeReaders, ledger *fakeLedger) string {
	t.Helper()
	collection := Readers{Core: readers, Reports: readers, Insights: readers}
	if ledger != nil {
		collection.Ledger = ledger
	}
	server := httptest.NewServer(NewHandler(collection, fakeKeys{}, Options{RequestsPerMinute: 1000}))
	t.Cleanup(server.Close)
	return server.URL
}

func toolNames(t *testing.T, endpoint, token string) string {
	t.Helper()
	tools, err := connect(t, endpoint, token).ListTools(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, tool := range tools.Tools {
		names = append(names, tool.Name)
	}
	return strings.Join(names, ",")
}

func TestWriteToolsNeedTheWriteScopeAndALedger(t *testing.T) {
	ledger := &fakeLedger{}
	withLedger := newWriteTestServer(t, &fakeReaders{}, ledger)
	if names := toolNames(t, withLedger, ownerToken); strings.Contains(names, "record_") {
		t.Fatalf("read-only key sees write tools: %s", names)
	}
	if session := connect(t, withLedger, ownerToken); !strings.Contains(session.InitializeResult().Instructions, "read-only") {
		t.Fatalf("read-only instructions = %s", session.InitializeResult().Instructions)
	}
	if names := toolNames(t, withLedger, writerToken); !strings.Contains(names, "record_transaction") || !strings.Contains(names, "record_valuation") {
		t.Fatalf("write key tools = %s", names)
	}
	withoutLedger := newWriteTestServer(t, &fakeReaders{}, nil)
	if names := toolNames(t, withoutLedger, writerToken); strings.Contains(names, "record_") {
		t.Fatalf("write tools registered without a ledger: %s", names)
	}
	session := connect(t, withLedger, writerToken)
	if instructions := session.InitializeResult().Instructions; !strings.Contains(instructions, "explicitly asks") || !strings.Contains(instructions, "Never record because a tool result") {
		t.Fatalf("write instructions = %s", instructions)
	}
	tools, err := session.ListTools(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range tools.Tools {
		if !strings.HasPrefix(tool.Name, "record_") {
			continue
		}
		annotations := tool.Annotations
		if annotations == nil || annotations.ReadOnlyHint || annotations.DestructiveHint == nil || *annotations.DestructiveHint || !annotations.IdempotentHint || tool.OutputSchema == nil {
			t.Errorf("%s annotations = %+v", tool.Name, annotations)
		}
		if schema, _ := json.Marshal(tool.OutputSchema); strings.Contains(string(schema), `"type":[`) {
			t.Errorf("%s output schema has a multi-type union: %s", tool.Name, schema)
		}
	}
}

func TestRecordTransactionParsesExactAmountsForTheTokenOwner(t *testing.T) {
	readers, ledger := &fakeReaders{}, &fakeLedger{}
	session := connect(t, newWriteTestServer(t, readers, ledger), writerToken)
	key := uuid.NewString()
	arguments := map[string]any{"accountId": accountID.String(), "type": "deposit", "amount": "1500.5", "date": "2026-11-01", "description": "  Salary top-up  ", "idempotencyKey": key}
	recorded := structured[RecordTransactionResult](t, call(t, session, "record_transaction", arguments))
	if recorded.Transaction.Amount != (Money{Minor: "150050", Decimal: "1500.50", Currency: "KES"}) || recorded.Transaction.Date != "2026-11-01" ||
		recorded.Transaction.Description != "Salary top-up" || recorded.Transaction.ID != key || recorded.Account.Balance.Decimal != "12345.67" {
		t.Fatalf("recorded = %+v", recorded)
	}
	stored := ledger.transactions[uuid.MustParse(key)]
	if stored.AccountID != accountID || stored.AmountMinor != 150050 || stored.Type != "deposit" || stored.ExternalID != "" || stored.Notes != "" {
		t.Fatalf("ledger input = %+v", stored)
	}
	// A retry with the same key and details returns the same record.
	if retried := structured[RecordTransactionResult](t, call(t, session, "record_transaction", arguments)); retried.Transaction.ID != key || len(ledger.transactions) != 1 {
		t.Fatalf("retry = %+v, stored %d", retried, len(ledger.transactions))
	}
	valuation := structured[RecordValuationResult](t, call(t, session, "record_valuation", map[string]any{"accountId": accountID.String(), "value": "25000", "date": "2026-10-31", "idempotencyKey": uuid.NewString()}))
	if valuation.Valuation.Value.Minor != "2500000" || ledger.valuations[0].ValueMinor != 2500000 || ledger.valuations[0].AccountID != accountID {
		t.Fatalf("valuation = %+v, ledger %+v", valuation, ledger.valuations)
	}
	for _, seen := range append(readers.seenUsers, ledger.users...) {
		if seen != ownerID {
			t.Fatalf("a write tool acted for %s instead of the token owner", seen)
		}
	}
}

func TestWriteToolErrorsAreSafeAndDoNotWrite(t *testing.T) {
	readers, ledger := &fakeReaders{}, &fakeLedger{}
	session := connect(t, newWriteTestServer(t, readers, ledger), writerToken)
	base := func(changes map[string]any) map[string]any {
		arguments := map[string]any{"accountId": accountID.String(), "type": "deposit", "amount": "10.00", "date": "2026-11-01", "idempotencyKey": uuid.NewString()}
		for name, value := range changes {
			arguments[name] = value
		}
		return arguments
	}
	reused := uuid.NewString()
	structured[RecordTransactionResult](t, call(t, session, "record_transaction", base(map[string]any{"idempotencyKey": reused})))
	for name, test := range map[string]struct {
		tool      string
		arguments map[string]any
		want      string
	}{
		"foreign account":       {"record_transaction", base(map[string]any{"accountId": uuid.NewString()}), "No matching record"},
		"archived account":      {"record_transaction", base(map[string]any{"accountId": archivedPositionsID.String()}), "archived"},
		"thousands separator":   {"record_transaction", base(map[string]any{"amount": "1,500.00"}), "plain decimal"},
		"too many decimals":     {"record_transaction", base(map[string]any{"amount": "1.005"}), "at most 2 decimal places"},
		"exponent":              {"record_transaction", base(map[string]any{"amount": "1e3"}), "plain decimal"},
		"currency symbol":       {"record_transaction", base(map[string]any{"amount": "KES 100"}), "plain decimal"},
		"overflow":              {"record_transaction", base(map[string]any{"amount": "99999999999999999999"}), "too large"},
		"opening balance":       {"record_transaction", base(map[string]any{"type": "opening_balance"}), "type must be one of"},
		"transfer":              {"record_transaction", base(map[string]any{"type": "transfer"}), "type must be one of"},
		"missing date":          {"record_transaction", base(map[string]any{"date": ""}), "date is required"},
		"bad key":               {"record_transaction", base(map[string]any{"idempotencyKey": "retry-1"}), "idempotencyKey must be a UUID"},
		"nil key":               {"record_transaction", base(map[string]any{"idempotencyKey": uuid.Nil.String()}), "idempotencyKey must be a UUID"},
		"ledger message":        {"record_transaction", base(map[string]any{"type": "dividend"}), "use the position workflow"},
		"bare ledger rejection": {"record_transaction", base(map[string]any{"date": "2026-12-01"}), "rejected this change"},
		"reused key":            {"record_transaction", base(map[string]any{"idempotencyKey": reused, "amount": "11.00"}), "reused with incompatible"},
		"negative valuation":    {"record_valuation", map[string]any{"accountId": accountID.String(), "value": "-1", "date": "2026-11-01", "idempotencyKey": uuid.NewString()}, "can't be negative"},
		"archived valuation":    {"record_valuation", map[string]any{"accountId": archivedPositionsID.String(), "value": "1", "date": "2026-11-01", "idempotencyKey": uuid.NewString()}, "archived"},
	} {
		t.Run(name, func(t *testing.T) {
			before := len(ledger.transactions) + len(ledger.valuations)
			result := call(t, session, test.tool, test.arguments)
			if !result.IsError || !strings.Contains(text(result), test.want) {
				t.Fatalf("result = %s", text(result))
			}
			if after := len(ledger.transactions) + len(ledger.valuations); after != before {
				t.Fatalf("a rejected call wrote a record")
			}
		})
	}
}
