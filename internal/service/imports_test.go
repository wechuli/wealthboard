package service

import (
	"bytes"
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestParseAccountHistoryCSVAndJSON(t *testing.T) {
	csvContent := []byte("notes,date,amount,type,external_id,description\nMemo,2026-09-19,12.34,deposit,row-1,Deposit\n")
	rows, firstRow, err := parseAccountHistory(csvContent, ImportFormatCSV)
	if err != nil || firstRow != 2 || len(rows) != 1 || rows[0].Amount != "12.34" || rows[0].ExternalID == nil || *rows[0].ExternalID != "row-1" {
		t.Fatalf("parsed CSV = %#v, first row %d, error %v", rows, firstRow, err)
	}

	jsonContent := []byte(`{"format":"wealthboard-account-history","version":1,"transactions":[{"external_id":"row-2","type":"fee","amount":"1.00","date":"2026-09-19","description":null,"notes":null}]}`)
	rows, firstRow, err = parseAccountHistory(jsonContent, ImportFormatJSON)
	if err != nil || firstRow != 1 || len(rows) != 1 || rows[0].Type != "fee" {
		t.Fatalf("parsed JSON = %#v, first row %d, error %v", rows, firstRow, err)
	}

	unknown := []byte(`{"format":"wealthboard-account-history","version":1,"transactions":[],"extra":true}`)
	if _, _, err := parseAccountHistory(unknown, ImportFormatJSON); !errors.Is(err, ErrImportValidation) {
		t.Fatalf("unknown-field error = %v, want validation", err)
	}
}

func TestParseInvestmentHistoryTemplatesAndLimits(t *testing.T) {
	holdings := []byte(strings.Join(investmentHoldingsHeaders, ",") + "\ninst-1,event-1,price-1,Example,EX,custom,EX,,stock,KES,2,10.00,2026-09-19,,\n")
	envelope, err := parseInvestmentHistory(holdings, ImportFormatCSV)
	if err != nil || len(envelope.Instruments) != 1 || len(envelope.PositionEvents) != 1 || len(envelope.Prices) != 1 {
		t.Fatalf("holdings envelope = %#v, error %v", envelope, err)
	}

	badHeaders := bytes.Replace(holdings, []byte("notes"), []byte("unknown"), 1)
	if _, err := parseInvestmentHistory(badHeaders, ImportFormatCSV); !errors.Is(err, ErrImportValidation) {
		t.Fatalf("bad header error = %v, want validation", err)
	}

	transactions := strings.Repeat(`{"external_id":"x","type":"deposit","amount":"1","date":"2026-09-19"},`, ImportMaxRecords+1)
	transactions = strings.TrimSuffix(transactions, ",")
	tooMany := fmt.Appendf(nil, `{"format":"wealthboard-investment-history","version":1,"cash_transactions":[%s]}`, transactions)
	if _, err := parseInvestmentHistory(tooMany, ImportFormatJSON); !errors.Is(err, ErrImportValidation) {
		t.Fatalf("record limit error = %v, want validation", err)
	}

	if err := validateImportContent(make([]byte, ImportMaxBytes+1), ImportFormatCSV); !errors.Is(err, ErrImportValidation) {
		t.Fatalf("byte limit error = %v, want validation", err)
	}
}

func TestDerivedExternalIDsUseCurrencyPrecisionAndOccurrenceSuffixes(t *testing.T) {
	derived := derivedExternalIDs{}
	cases := []struct {
		date, transactionType string
		amount                int64
		currency, want        string
		legacy                string
	}{
		{"2026-09-01", "deposit", 1050, "KES", "derived-2026-09-01-deposit-10.50", "derived-2026-09-01-deposit-1050"},
		{"2026-09-01", "deposit", 1050, "KES", "derived-2026-09-01-deposit-10.50-2", ""},
		{"2026-09-01", "deposit", 1050, "KES", "derived-2026-09-01-deposit-10.50-3", ""},
		{"2026-09-01", "fee", 5, "USD", "derived-2026-09-01-fee-0.05", "derived-2026-09-01-fee-5"},
		{"2026-09-01", "deposit", 1500, "JPY", "derived-2026-09-01-deposit-1500", "derived-2026-09-01-deposit-1500"},
		{"2026-09-01", "deposit", 1234, "KWD", "derived-2026-09-01-deposit-1.234", "derived-2026-09-01-deposit-1234"},
		{"2026-09-01", "manual_adjustment", -250, "KES", "derived-2026-09-01-manual_adjustment--2.50", "derived-2026-09-01-manual_adjustment--250"},
	}
	for _, test := range cases {
		got := derived.next(test.date, test.transactionType, test.amount, test.currency)
		if got.id != test.want || got.legacy != test.legacy {
			t.Errorf("next(%s, %s, %d, %s) = %#v, want id %q legacy %q", test.date, test.transactionType, test.amount, test.currency, got, test.want, test.legacy)
		}
	}
}

func TestVerifyImportHashRequiresExactContent(t *testing.T) {
	content := []byte("same bytes")
	if err := verifyImportHash(content, importHash(content)); err != nil {
		t.Fatalf("matching hash rejected: %v", err)
	}
	if err := verifyImportHash(append(content, '\n'), importHash(content)); !errors.Is(err, ErrImportConflict) {
		t.Fatalf("changed content error = %v, want conflict", err)
	}
}
