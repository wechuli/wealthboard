package domain

import "strings"

const DefaultCurrency = "KES"

var supportedCurrencies = map[string]struct{}{
	"AED": {}, "AUD": {}, "BHD": {}, "BIF": {}, "CAD": {}, "CDF": {},
	"CHF": {}, "CNY": {}, "ETB": {}, "EUR": {}, "GBP": {}, "GHS": {},
	"HKD": {}, "INR": {}, "JPY": {}, "KES": {}, "KWD": {}, "NGN": {},
	"NZD": {}, "OMR": {}, "QAR": {}, "RWF": {}, "SAR": {}, "SGD": {},
	"SOS": {}, "SSP": {}, "TZS": {}, "UGX": {}, "USD": {}, "ZAR": {},
}

func NormalizeCurrency(value string) string {
	return strings.ToUpper(strings.TrimSpace(value))
}

func IsSupportedCurrency(value string) bool {
	_, ok := supportedCurrencies[NormalizeCurrency(value)]
	return ok
}
