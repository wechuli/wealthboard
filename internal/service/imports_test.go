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

func TestVerifyImportHashRequiresExactContent(t *testing.T) {
	content := []byte("same bytes")
	if err := verifyImportHash(content, importHash(content)); err != nil {
		t.Fatalf("matching hash rejected: %v", err)
	}
	if err := verifyImportHash(append(content, '\n'), importHash(content)); !errors.Is(err, ErrImportConflict) {
		t.Fatalf("changed content error = %v, want conflict", err)
	}
}
