package service

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"
)

// PublicError wraps an expected mutation failure (validation or conflict) with a user-safe
// explanation. The detail must never contain stored values, identifiers, or other private data:
// handlers return it verbatim in problem responses.
type PublicError struct {
	Kind   error
	Detail string
}

func (err *PublicError) Error() string { return err.Kind.Error() + ": " + err.Detail }

func (err *PublicError) Unwrap() error { return err.Kind }

func publicError(kind error, detail string) error {
	return &PublicError{Kind: kind, Detail: detail}
}

// PublicDetail returns the user-safe explanation carried by err as a sentence, if any.
func PublicDetail(err error) (string, bool) {
	var public *PublicError
	if !errors.As(err, &public) {
		return "", false
	}
	detail := strings.TrimSpace(public.Detail)
	if detail == "" {
		return "", false
	}
	first, size := utf8.DecodeRuneInString(detail)
	detail = string(unicode.ToUpper(first)) + detail[size:]
	if !strings.HasSuffix(detail, ".") {
		detail += "."
	}
	return detail, true
}
