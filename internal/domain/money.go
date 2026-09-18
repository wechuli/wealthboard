package domain

import (
	"encoding/json"
	"errors"
	"math/big"
	"regexp"
	"strconv"
	"strings"
)

const MaxSafeMinor int64 = 9007199254740991

var (
	ErrCurrency      = errors.New("choose a supported currency")
	ErrPrecision     = errors.New("amount has excess fractional precision")
	canonicalInteger = regexp.MustCompile(`^(?:0|-?[1-9][0-9]*)$`)
)

// Minor is the backend's signed int64 storage boundary. JSON MUST use decimal
// strings. ParseMoney intentionally retains the narrower existing form contract
// (JS safe integers); ParseMinor accepts the full int64 range for persisted/API
// minor-unit strings. Neither path accepts a floating-point number.
type Minor int64

func ParseMinor(value string) (Minor, error) {
	if len(value) > 20 || !canonicalInteger.MatchString(value) {
		return 0, ErrDecimal
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, ErrRange
	}
	return Minor(parsed), nil
}

func (value Minor) String() string { return strconv.FormatInt(int64(value), 10) }

func (value Minor) MarshalJSON() ([]byte, error) { return json.Marshal(value.String()) }

func (value *Minor) UnmarshalJSON(data []byte) error {
	if len(data) > 22 || len(data) < 3 || data[0] != '"' {
		return ErrDecimal
	}
	var text string
	if err := json.Unmarshal(data, &text); err != nil {
		return ErrDecimal
	}
	parsed, err := ParseMinor(text)
	if err != nil {
		return err
	}
	*value = parsed
	return nil
}

// Pinned to Node 22 / Intl's supported currency catalog. The parity suite detects
// ICU/catalog drift rather than silently assigning unknown currencies two digits.
var currencyGroups = map[int]string{
	0: "AFN ALL BIF CLP COP DJF GNF HUF IDR IQD IRR ISK JPY KMF KPW KRW LAK LBP MGA MMK PKR PYG RWF SLL SOS SYP UGX VND VUV XAF XOF XPF YER",
	2: "AED AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CNY CRC CUC CUP CVE CZK DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GTQ GYD HKD HNL HRK HTG ILS INR JMD KES KGS KHR KYD KZT LKR LRD LSL MAD MDL MKD MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD PAB PEN PGK PHP PLN QAR RON RSD RUB SAR SBD SCR SDG SEK SGD SHP SLE SRD SSP STN SVC SZL THB TJS TMT TOP TRY TTD TWD TZS UAH USD UYU UZS VES WST XCD XCG XDR XSU ZAR ZMW ZWG ZWL",
	3: "BHD JOD KWD LYD OMR TND",
}

func CurrencyDigits(currency string) (int, error) {
	code := strings.ToUpper(strings.TrimSpace(currency))
	for digits, codes := range currencyGroups {
		if len(code) == 3 && strings.Contains(" "+codes+" ", " "+code+" ") {
			return digits, nil
		}
	}
	return 0, ErrCurrency
}

func ParseMoney(value, currency string) (Minor, error) {
	digits, err := CurrencyDigits(currency)
	if err != nil {
		return 0, err
	}
	return ParseMoneyDigits(value, digits)
}

// ParseMoneyDigits supports explicit 0..4 digit scales (including ISO fund units
// absent from Intl.supportedValuesOf, e.g. CLF). It does not validate a currency.
// Commas and surrounding whitespace match the existing money form parser.
// Inputs are capped at 256 bytes; normalized decimals at 80 bytes.
func ParseMoneyDigits(input string, digits int) (Minor, error) {
	if digits < 0 || digits > 4 {
		return 0, ErrPrecision
	}
	if len(input) > 256 {
		return 0, ErrDecimal
	}
	value, err := decimalRat(strings.ReplaceAll(strings.TrimSpace(input), ",", ""))
	if err != nil {
		return 0, err
	}
	scaled := decimalContext(new(big.Rat).Mul(value, new(big.Rat).SetInt(pow10(digits))))
	if !scaled.IsInt() {
		return 0, ErrPrecision
	}
	if new(big.Int).Abs(scaled.Num()).Cmp(big.NewInt(MaxSafeMinor)) > 0 {
		return 0, ErrRange
	}
	return Minor(scaled.Num().Int64()), nil
}

func MinorToDecimalString(value Minor, currency string) (string, error) {
	digits, err := CurrencyDigits(currency)
	if err != nil {
		return "", err
	}
	return MinorToDecimalDigits(value, digits)
}

func MinorToDecimalDigits(value Minor, digits int) (string, error) {
	if digits < 0 || digits > 4 {
		return "", ErrPrecision
	}
	text := new(big.Int).Abs(big.NewInt(int64(value))).String()
	if digits > 0 {
		if len(text) <= digits {
			text = strings.Repeat("0", digits+1-len(text)) + text
		}
		text = text[:len(text)-digits] + "." + text[len(text)-digits:]
	}
	if value < 0 {
		text = "-" + text
	}
	return text, nil
}

func checkedMinor(value *big.Int) (Minor, error) {
	if !value.IsInt64() {
		return 0, ErrRange
	}
	return Minor(value.Int64()), nil
}
