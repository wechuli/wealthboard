package service

import (
	"bytes"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

const (
	ImportMaxBytes   = 5 * 1024 * 1024
	ImportMaxRecords = 10_000
)

var (
	ErrImportNotFound   = errors.New("import account not found")
	ErrImportValidation = errors.New("import validation failed")
	ErrImportConflict   = errors.New("import conflict")
)

type ImportFormat string

const (
	ImportFormatCSV  ImportFormat = "csv"
	ImportFormatJSON ImportFormat = "json"
)

func importValidation(message string) error {
	return fmt.Errorf("%w: %s", ErrImportValidation, message)
}

func importConflict(message string) error {
	return fmt.Errorf("%w: %s", ErrImportConflict, message)
}

func importHash(content []byte) string {
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:])
}

func validateImportContent(content []byte, format ImportFormat) error {
	if len(content) == 0 || len(bytes.TrimSpace(content)) == 0 {
		return importValidation("the import file is empty")
	}
	if len(content) > ImportMaxBytes {
		return importValidation("the import is limited to 5 MB")
	}
	if format != ImportFormatCSV && format != ImportFormatJSON {
		return importValidation("the import format must be csv or json")
	}
	return nil
}

func verifyImportHash(content []byte, expected string) error {
	actual := importHash(content)
	if len(expected) != sha256.Size*2 || !strings.EqualFold(actual, expected) {
		return importConflict("the content changed after preview; preview it again")
	}
	return nil
}

func decodeStrictJSON(content []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("JSON must contain exactly one value")
	}
	return nil
}

func parseExactCSV(content []byte, expected []string) ([][]string, error) {
	reader := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(content, []byte("\xef\xbb\xbf"))))
	reader.FieldsPerRecord = -1
	records, err := reader.ReadAll()
	if err != nil {
		return nil, importValidation("the CSV is malformed")
	}
	if len(records) < 2 {
		return nil, importValidation("the file contains no records")
	}
	headers := records[0]
	if len(headers) != len(expected) {
		return nil, importValidation("the CSV headers do not match the required template")
	}
	seen := make(map[string]bool, len(headers))
	for _, header := range headers {
		header = strings.TrimSpace(header)
		if seen[header] {
			return nil, importValidation("the CSV headers do not match the required template")
		}
		seen[header] = true
	}
	for _, header := range expected {
		if !seen[header] {
			return nil, importValidation("the CSV headers do not match the required template")
		}
	}
	if len(records)-1 > ImportMaxRecords {
		return nil, importValidation("the import is limited to 10,000 records")
	}
	for _, record := range records[1:] {
		if len(record) != len(headers) {
			return nil, importValidation("the CSV is malformed")
		}
	}
	return records, nil
}

func csvRecord(headers, values []string) map[string]string {
	result := make(map[string]string, len(headers))
	for index, header := range headers {
		result[strings.TrimSpace(header)] = values[index]
	}
	return result
}
