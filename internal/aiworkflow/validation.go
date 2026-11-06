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
	"unicode"
)

var (
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
	// draftFieldValues lists the only values each enumerated draft field
	// accepts. The imports match them exactly, so these must match their
	// validation sets in internal/service.
	draftFieldValues = map[string]map[string][]string{
		"transactions": {
			"type": {"deposit", "withdrawal", "interest", "dividend", "capital_gain", "capital_loss", "fee", "purchase", "sale", "manual_adjustment", "liability_payment", "liability_increase"},
		},
		"instruments": {
			"identifier_type": {"isin", "ticker_exchange", "custom"},
			"asset_type":      {"stock", "etf", "fund"},
		},
		"position_events": {
			"type": {"opening_position", "buy", "sell", "quantity_adjustment"},
		},
		"cash_transactions": {
			"type": {"deposit", "withdrawal", "interest", "dividend", "fee", "manual_adjustment"},
		},
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

// DraftFieldValues returns the values each enumerated import field accepts.
func DraftFieldValues() map[string]map[string][]string {
	values := make(map[string]map[string][]string, len(draftFieldValues))
	for collection, fields := range draftFieldValues {
		values[collection] = make(map[string][]string, len(fields))
		for field, allowed := range fields {
			values[collection][field] = slices.Clone(allowed)
		}
	}
	return values
}

// canonicalDraftValue maps a model's casing or word separators for an
// enumerated value, such as "INTEREST" or "Capital gain", onto the exact value
// the import accepts.
func canonicalDraftValue(allowed []string, value string) (string, bool) {
	canonical := strings.Join(strings.FieldsFunc(strings.ToLower(value), func(character rune) bool {
		return unicode.IsSpace(character) || character == '-' || character == '_'
	}), "_")
	if slices.Contains(allowed, canonical) {
		return canonical, true
	}
	return value, false
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
	unsupported := map[[3]string]int{}
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
			if allowed, ok := draftFieldValues[record.Collection][field.Name]; ok {
				canonical, found := canonicalDraftValue(allowed, value)
				if !found {
					unsupported[[3]string{record.Collection, field.Name, value}]++
				}
				value = canonical
			}
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
	unsupportedKeys := slices.Collect(maps.Keys(unsupported))
	slices.SortFunc(unsupportedKeys, func(a, b [3]string) int {
		return strings.Compare(strings.Join(a[:], "\x00"), strings.Join(b[:], "\x00"))
	})
	for _, key := range unsupportedKeys {
		issues = append(issues, fmt.Sprintf("Field %q has value %q in %d %s record(s), which the import does not accept. Change it to one of: %s.", key[1], key[2], unsupported[key], key[0], strings.Join(draftFieldValues[key[0]][key[1]], ", ")))
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

func conversionPrompt(trackingMode, currency string, units []SourceUnit) string {
	encoded, _ := json.Marshal(units)
	fields := []string{}
	values := []string{}
	for _, collection := range trackingModeCollections[trackingMode] {
		fields = append(fields, "- "+collection+": "+strings.Join(draftCollectionFields[collection], ", "))
		for _, field := range draftCollectionFields[collection] {
			if allowed, ok := draftFieldValues[collection][field]; ok {
				values = append(values, "- "+collection+"."+field+": "+strings.Join(allowed, ", "))
			}
		}
	}
	return fmt.Sprintf("Convert only supplied source activity to a Wealthboard %s import draft in %s. Do not invent values. Account for every source ID with a record or an exclusion. Use only these collections, and only the listed fields for each:\n%s\n\nThese fields accept only the listed values. Use the matching value exactly as written here, not the source wording; when none fits, leave the field empty and explain why in issues:\n%s\n\nSource sections:\n\n%s", trackingMode, currency, strings.Join(fields, "\n"), strings.Join(values, "\n"), encoded)
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
