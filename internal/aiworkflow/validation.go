package aiworkflow

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"regexp"
	"slices"
	"strings"
)

var (
	periods         = map[string]bool{"1m": true, "3m": true, "6m": true, "1y": true, "all": true}
	focuses         = map[string]bool{"overall": true, "allocation": true, "goals": true, "cash-flow": true, "data-quality": true}
	categories      = map[string]bool{"data-quality": true, "allocation": true, "liquidity": true, "cash-flow": true, "goals": true, "general": true}
	severities      = map[string]bool{"info": true, "attention": true, "high": true}
	confidences     = map[string]bool{"low": true, "medium": true, "high": true}
	sourceIDPattern = regexp.MustCompile(`^source-[0-9]+$`)
	hashPattern     = regexp.MustCompile(`^[a-f0-9]{64}$`)
	currencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)
	modelPattern    = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]*$`)

	// draftCollectionFields lists the fields each import collection accepts. The
	// account and investment history imports decode drafts strictly, so these
	// must match their JSON envelopes in internal/service.
	draftCollectionFields = map[string][]string{
		"transactions":      {"external_id", "type", "amount", "date", "description", "notes"},
		"instruments":       {"external_id", "name", "symbol", "identifier_type", "identifier", "exchange_mic", "asset_type", "quote_currency"},
		"position_events":   {"external_id", "instrument_external_id", "type", "quantity", "unit_price", "trade_currency", "fee_amount", "fee_currency", "cash_effect", "applied_exchange_rate", "opening_cost_basis", "event_group_id", "trade_date", "settlement_date", "description", "notes"},
		"cash_transactions": {"external_id", "type", "amount", "date", "event_group_id", "description", "notes"},
		"prices":            {"external_id", "instrument_external_id", "price", "effective_date", "source", "provenance"},
	}
	trackingModeCollections = map[string][]string{
		"balance":   {"transactions"},
		"positions": {"instruments", "position_events", "cash_transactions", "prices"},
	}
	allowedCollections = map[string]bool{}
	allowedFields      = map[string]bool{}
)

func init() {
	for collection, fields := range draftCollectionFields {
		allowedCollections[collection] = true
		for _, field := range fields {
			allowedFields[field] = true
		}
	}
}

// DraftCollectionFields returns the fields each import collection accepts.
func DraftCollectionFields() map[string][]string {
	fields := make(map[string][]string, len(draftCollectionFields))
	for collection, names := range draftCollectionFields {
		fields[collection] = slices.Clone(names)
	}
	return fields
}

func validateReviewRequest(request ReviewRequest) error {
	if !periods[request.Period] || !focuses[request.Focus] || len(request.Snapshot) == 0 || len(request.Snapshot) > 25_000 {
		return fmt.Errorf("%w: invalid portfolio review request", ErrInvalidInput)
	}
	var snapshot struct {
		SchemaVersion int             `json:"schemaVersion"`
		AsOf          string          `json:"asOf"`
		Period        string          `json:"period"`
		Focus         string          `json:"focus"`
		BaseCurrency  string          `json:"baseCurrency"`
		Sharing       json.RawMessage `json:"sharing"`
		Completeness  json.RawMessage `json:"completeness"`
		Portfolio     json.RawMessage `json:"portfolio"`
		Allocations   json.RawMessage `json:"allocations"`
		TopAccounts   json.RawMessage `json:"topAccounts"`
		CashFlow      json.RawMessage `json:"cashFlow"`
		Goals         json.RawMessage `json:"goals"`
		DataQuality   json.RawMessage `json:"dataQuality"`
		Methodology   json.RawMessage `json:"methodology"`
	}
	if strictDecode(request.Snapshot, &snapshot) != nil || snapshot.SchemaVersion != 1 || snapshot.AsOf == "" || snapshot.Period != request.Period || snapshot.Focus != request.Focus || !currencyPattern.MatchString(snapshot.BaseCurrency) {
		return fmt.Errorf("%w: invalid portfolio review snapshot", ErrInvalidInput)
	}
	for _, required := range []json.RawMessage{snapshot.Sharing, snapshot.Completeness, snapshot.Portfolio, snapshot.Allocations, snapshot.TopAccounts, snapshot.CashFlow, snapshot.Goals, snapshot.DataQuality, snapshot.Methodology} {
		if len(required) == 0 || string(required) == "null" {
			return fmt.Errorf("%w: incomplete portfolio review snapshot", ErrInvalidInput)
		}
	}
	return nil
}

func validateReview(review ReviewContent, snapshot json.RawMessage) error {
	if !bounded(review.Headline, 1, 160) || !bounded(review.ExecutiveSummary, 1, 1400) || len(review.Limitations) < 1 || len(review.Limitations) > 8 {
		return errorsInvalidReview()
	}
	allowed := reviewEvidenceIDs(snapshot)
	groups := [][]ReviewFinding{review.DataQuality, review.Strengths, review.AttentionItems, review.GoalObservations}
	limits := []int{6, 6, 8, 6}
	for index, findings := range groups {
		if len(findings) > limits[index] {
			return errorsInvalidReview()
		}
		for _, finding := range findings {
			if !bounded(finding.ID, 1, 80) || !categories[finding.Category] || !severities[finding.Severity] || !confidences[finding.Confidence] || !bounded(finding.Title, 1, 140) || !bounded(finding.Explanation, 1, 700) || len(finding.EvidenceRefs) < 1 || len(finding.EvidenceRefs) > 6 {
				return errorsInvalidReview()
			}
			for _, reference := range finding.EvidenceRefs {
				if !allowed[reference] {
					return errorsInvalidReview()
				}
			}
		}
	}
	if !stringList(review.Questions, 6, 300, false) || !stringList(review.PossibleNextChecks, 6, 300, false) || !stringList(review.Limitations, 8, 300, true) {
		return errorsInvalidReview()
	}
	return nil
}

func validateConversionRequest(request ConversionRequest) error {
	if !request.Consent || !hashPattern.MatchString(request.ConfigurationHash) || (request.TrackingMode != "balance" && request.TrackingMode != "positions") || !currencyPattern.MatchString(request.Currency) {
		return fmt.Errorf("%w: invalid import conversion request", ErrInvalidInput)
	}
	return validateSource(request.Source)
}

func validateSource(source Source) error {
	if len(source.Units) < 1 || len(source.Units) > MaxSourceUnits || len(source.Warnings) > 100 {
		return fmt.Errorf("%w: invalid extracted source", ErrInvalidInput)
	}
	seen := make(map[string]bool, len(source.Units))
	for _, unit := range source.Units {
		if !sourceIDPattern.MatchString(unit.ID) || seen[unit.ID] || !bounded(unit.Location, 1, 200) || !bounded(unit.Text, 1, MaxTextBytes) {
			return fmt.Errorf("%w: invalid extracted source", ErrInvalidInput)
		}
		seen[unit.ID] = true
	}
	encoded, _ := json.Marshal(source)
	if len(encoded) > MaxTextBytes {
		return fmt.Errorf("%w: extracted source exceeds 64 KB", ErrInvalidInput)
	}
	return nil
}

func validateExtraction(extraction Extraction) error {
	if len(extraction.Records) > 1000 || len(extraction.Exclusions) > 1000 || len(extraction.Issues) > 100 {
		return fmt.Errorf("%w: provider returned an invalid conversion", ErrInvalidInput)
	}
	for _, record := range extraction.Records {
		if !allowedCollections[record.Collection] || len(record.SourceIDs) < 1 || len(record.SourceIDs) > 100 || len(record.Fields) < 1 || len(record.Fields) > 30 {
			return fmt.Errorf("%w: provider returned an invalid conversion", ErrInvalidInput)
		}
		seen := map[string]bool{}
		for _, field := range record.Fields {
			if !allowedFields[field.Name] || seen[field.Name] || len(field.Value) > 2000 {
				return fmt.Errorf("%w: provider returned an invalid conversion", ErrInvalidInput)
			}
			seen[field.Name] = true
		}
	}
	return nil
}

func buildDraft(extraction Extraction, source Source, trackingMode string) (ConversionDraft, error) {
	units := make(map[string]SourceUnit, len(source.Units))
	for _, unit := range source.Units {
		units[unit.ID] = unit
	}
	collections := map[string][]map[string]*string{}
	for _, collection := range trackingModeCollections[trackingMode] {
		collections[collection] = []map[string]*string{}
	}
	covered := map[string]bool{}
	references := []DraftReference{}
	dropped := map[[2]string]int{}
	for _, record := range extraction.Records {
		if _, ok := collections[record.Collection]; !ok {
			return ConversionDraft{}, fmt.Errorf("%w: conversion used the wrong account format", ErrInvalidInput)
		}
		for _, sourceID := range record.SourceIDs {
			if _, ok := units[sourceID]; !ok {
				return ConversionDraft{}, fmt.Errorf("%w: conversion cited an unknown source section", ErrInvalidInput)
			}
			covered[sourceID] = true
		}
		fields := make(map[string]*string, len(record.Fields))
		for _, field := range record.Fields {
			if !slices.Contains(draftCollectionFields[record.Collection], field.Name) {
				dropped[[2]string{record.Collection, field.Name}]++
				continue
			}
			if field.Value == "" {
				fields[field.Name] = nil
				continue
			}
			value := field.Value
			fields[field.Name] = &value
		}
		collections[record.Collection] = append(collections[record.Collection], fields)
		references = append(references, DraftReference{Collection: record.Collection, Row: len(collections[record.Collection]), SourceIDs: record.SourceIDs})
	}
	exclusions := extraction.Exclusions
	if exclusions == nil {
		exclusions = []Exclusion{}
	}
	for _, exclusion := range exclusions {
		if _, ok := units[exclusion.SourceID]; !ok || !bounded(exclusion.Reason, 1, 500) {
			return ConversionDraft{}, fmt.Errorf("%w: conversion excluded an unknown source section", ErrInvalidInput)
		}
		covered[exclusion.SourceID] = true
	}
	issues := append([]string{}, extraction.Issues...)
	droppedKeys := slices.Collect(maps.Keys(dropped))
	slices.SortFunc(droppedKeys, func(a, b [2]string) int {
		return strings.Compare(a[0]+"\x00"+a[1], b[0]+"\x00"+b[1])
	})
	for _, key := range droppedKeys {
		issues = append(issues, fmt.Sprintf("Removed field %q from %d %s record(s) because that import collection does not accept it. Check the source for any value it carried.", key[1], dropped[key], key[0]))
	}
	for _, unit := range source.Units {
		if !covered[unit.ID] {
			issues = append(issues, "Source section "+unit.ID+" was not accounted for. Resolve it before preview.")
		}
	}
	if len(extraction.Records) == 0 {
		return ConversionDraft{}, fmt.Errorf("%w: no candidate records were extracted", ErrInvalidInput)
	}
	format := "wealthboard-account-history"
	if trackingMode == "positions" {
		format = "wealthboard-investment-history"
	}
	payload := map[string]any{"format": format, "version": 1}
	for key, records := range collections {
		payload[key] = records
	}
	content, _ := json.MarshalIndent(payload, "", "  ")
	return ConversionDraft{Content: string(content), References: references, Exclusions: exclusions, Issues: issues}, nil
}

func reviewPrompt(snapshot string) string {
	return strings.Join([]string{
		"Review the supplied Wealthboard portfolio snapshot. Use only supplied facts and cite exact evidence IDs from its evidenceId values.",
		"Never invent balances, returns, causes, products, trades, taxes, or forecasts. Possible next checks must be questions, not financial instructions.",
		"Snapshot:",
		snapshot,
	}, "\n\n")
}

func conversionPrompt(trackingMode, currency string, units []SourceUnit) string {
	encoded, _ := json.Marshal(units)
	fields := []string{}
	for _, collection := range trackingModeCollections[trackingMode] {
		fields = append(fields, "- "+collection+": "+strings.Join(draftCollectionFields[collection], ", "))
	}
	return fmt.Sprintf("Convert only supplied source activity to a Wealthboard %s import draft in %s. Do not invent values. Account for every source ID with a record or an exclusion. Use only these collections, and only the listed fields for each:\n%s\n\nSource sections:\n\n%s", trackingMode, currency, strings.Join(fields, "\n"), encoded)
}

func strictDecode(data []byte, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("request must contain one JSON value")
	}
	return nil
}

func reviewEvidenceIDs(snapshot json.RawMessage) map[string]bool {
	var value any
	_ = json.Unmarshal(snapshot, &value)
	result := map[string]bool{}
	var visit func(any)
	visit = func(current any) {
		switch typed := current.(type) {
		case map[string]any:
			if evidenceID, ok := typed["evidenceId"].(string); ok {
				result[evidenceID] = true
			}
			for _, child := range typed {
				visit(child)
			}
		case []any:
			for _, child := range typed {
				visit(child)
			}
		}
	}
	visit(value)
	return result
}

func bounded(value string, minimum, maximum int) bool {
	length := len(strings.TrimSpace(value))
	return length >= minimum && length <= maximum
}

func stringList(values []string, maximum, itemMaximum int, requireOne bool) bool {
	if len(values) > maximum || (requireOne && len(values) == 0) {
		return false
	}
	for _, value := range values {
		if !bounded(value, 1, itemMaximum) {
			return false
		}
	}
	return true
}

func errorsInvalidReview() error {
	return fmt.Errorf("%w: provider returned an invalid portfolio review", ErrInvalidInput)
}
