package service

import (
	"fmt"
	"strconv"

	"github.com/wechuli/wealthboard/internal/domain"
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
	// A formatted int64 is always valid minor units.
	text, _ := domain.FormatMinorUnits(strconv.FormatInt(amountMinor, 10), currency)
	return text
}
