package service

import (
	"fmt"
	"math/big"
	"strings"
)

// derivedExternalIDs assigns deterministic identities to imported transactions that have no source ID.
// The identity is derived-<date>-<type>-<amount>, with the amount written at the currency's precision.
// Repeats of the same identity within one file take an occurrence suffix (-2, -3, ...) in file order,
// so identical same-day transactions import separately and an overlapping re-import still deduplicates.
type derivedExternalIDs map[string]int

type derivedExternalID struct {
	id string
	// legacy is the minor-unit identity stored by earlier imports, which had no occurrence suffix.
	// It is empty for repeated occurrences.
	legacy string
}

func (counter derivedExternalIDs) next(date, transactionType string, amountMinor int64, currency string) derivedExternalID {
	base := fmt.Sprintf("derived-%s-%s-%s", date, transactionType, formatDerivedAmount(amountMinor, currency))
	counter[base]++
	if occurrence := counter[base]; occurrence > 1 {
		return derivedExternalID{id: fmt.Sprintf("%s-%d", base, occurrence)}
	}
	return derivedExternalID{id: base, legacy: fmt.Sprintf("derived-%s-%s-%d", date, transactionType, amountMinor)}
}

func formatDerivedAmount(amountMinor int64, currency string) string {
	digits := investmentCurrencyDigits(currency)
	value := new(big.Int).SetInt64(amountMinor)
	negative := value.Sign() < 0
	text := value.Abs(value).String()
	if digits > 0 {
		if len(text) <= digits {
			text = strings.Repeat("0", digits-len(text)+1) + text
		}
		text = text[:len(text)-digits] + "." + text[len(text)-digits:]
	}
	if negative {
		return "-" + text
	}
	return text
}
