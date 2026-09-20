package aiworkflow

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

type SourceError struct {
	Message string
	Code    string
}

func (sourceError *SourceError) Error() string { return sourceError.Message }

type Extractor struct {
	NodePath   string
	ScriptPath string
	Timeout    time.Duration
}

func (extractor Extractor) Extract(ctx context.Context, name string, content []byte, password string) (Source, error) {
	if len(content) == 0 || len(content) > MaxSourceBytes {
		return Source{}, &SourceError{Message: "Choose a non-empty source file no larger than 5 MB."}
	}
	if len(password) > 1024 {
		return Source{}, &SourceError{Message: "The document password must be at most 1,024 characters."}
	}
	extension := strings.ToLower(filepath.Ext(name))
	if password != "" && extension != ".pdf" {
		return Source{}, &SourceError{Message: "Document passwords are supported for PDF files only."}
	}
	switch extension {
	case ".txt", ".csv", ".tsv", ".json":
		return extractText(name, content)
	case ".pdf", ".xlsx", ".docx":
		return extractor.extractDocument(ctx, strings.TrimPrefix(extension, "."), content, password)
	default:
		return Source{}, &SourceError{Message: "Choose a supported text, table, PDF, XLSX, or DOCX file."}
	}
}

func extractText(name string, content []byte) (Source, error) {
	if !utf8.Valid(content) {
		return Source{}, &SourceError{Message: "Text files must use UTF-8 encoding."}
	}
	text := strings.TrimPrefix(string(content), "\ufeff")
	for _, value := range text {
		if value < 32 && value != '\n' && value != '\r' && value != '\t' {
			return Source{}, &SourceError{Message: "The file contains binary content, not supported text."}
		}
	}
	source := Source{Units: []SourceUnit{}, Warnings: []string{}}
	add := func(location, value string) error {
		if strings.TrimSpace(value) == "" {
			return nil
		}
		if len(source.Units) >= MaxSourceUnits {
			return &SourceError{Message: "The source exceeds 1,000 sections. Select a smaller file."}
		}
		source.Units = append(source.Units, SourceUnit{ID: fmt.Sprintf("source-%d", len(source.Units)+1), Location: location, Text: value})
		encoded, _ := json.Marshal(source)
		if len(encoded) > MaxTextBytes {
			return &SourceError{Message: "Extracted content exceeds 64 KB. Select a smaller source file."}
		}
		return nil
	}
	extension := strings.ToLower(filepath.Ext(name))
	switch extension {
	case ".csv", ".tsv":
		reader := csv.NewReader(strings.NewReader(text))
		if extension == ".tsv" {
			reader.Comma = '\t'
		}
		reader.FieldsPerRecord = -1
		reader.ReuseRecord = false
		for row := 1; ; row++ {
			record, err := reader.Read()
			if errors.Is(err, io.EOF) {
				break
			}
			if err != nil {
				return Source{}, &SourceError{Message: "The table file is malformed."}
			}
			encoded, _ := json.Marshal(record)
			if err := add(fmt.Sprintf("Row %d", row), string(encoded)); err != nil {
				return Source{}, err
			}
		}
	case ".json":
		var value any
		decoder := json.NewDecoder(strings.NewReader(text))
		decoder.UseNumber()
		if err := decoder.Decode(&value); err != nil {
			return Source{}, &SourceError{Message: "The JSON file is malformed."}
		}
		if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
			return Source{}, &SourceError{Message: "The JSON file is malformed."}
		}
		if err := add("JSON document", text); err != nil {
			return Source{}, err
		}
	default:
		for index, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
			if err := add(fmt.Sprintf("Line %d", index+1), strings.TrimSuffix(line, "\r")); err != nil {
				return Source{}, err
			}
		}
	}
	if err := validateSource(source); err != nil {
		return Source{}, &SourceError{Message: "The extracted document is empty or exceeds the source limits."}
	}
	return source, nil
}

func (extractor Extractor) extractDocument(ctx context.Context, extension string, content []byte, password string) (Source, error) {
	timeout := extractor.Timeout
	if timeout <= 0 || timeout > 15*time.Second {
		timeout = 15 * time.Second
	}
	workerContext, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	nodePath := extractor.NodePath
	if nodePath == "" {
		resolved, err := exec.LookPath("node")
		if err != nil {
			return Source{}, &SourceError{Message: "The document parser is not installed."}
		}
		nodePath = resolved
	}
	input, _ := json.Marshal(map[string]string{
		"extension":        extension,
		"bytes":            base64.StdEncoding.EncodeToString(content),
		"documentPassword": password,
	})
	command := exec.CommandContext(workerContext, nodePath, "--max-old-space-size=160", extractor.ScriptPath)
	command.Env = []string{}
	command.Stdin = bytes.NewReader(input)
	var output cappedBuffer
	output.maximum = MaxTextBytes + 16*1024
	command.Stdout = &output
	command.Stderr = io.Discard
	err := command.Run()
	if errors.Is(workerContext.Err(), context.DeadlineExceeded) {
		return Source{}, &SourceError{Message: "Document extraction exceeded 15 seconds. Select a smaller file."}
	}
	if err != nil || output.exceeded {
		return Source{}, &SourceError{Message: "The document parser could not complete within its resource limits."}
	}
	var response struct {
		Source *Source `json:"source"`
		Error  string  `json:"error"`
		Code   string  `json:"code"`
	}
	if strictDecode(output.Bytes(), &response) != nil {
		return Source{}, &SourceError{Message: "Document extraction ended before completion."}
	}
	if response.Error != "" {
		return Source{}, &SourceError{Message: response.Error, Code: response.Code}
	}
	if response.Source == nil || validateSource(*response.Source) != nil {
		return Source{}, &SourceError{Message: "The extracted document is empty or exceeds the source limits."}
	}
	return *response.Source, nil
}

type cappedBuffer struct {
	bytes.Buffer
	maximum  int
	exceeded bool
}

func (buffer *cappedBuffer) Write(value []byte) (int, error) {
	if buffer.Len()+len(value) > buffer.maximum {
		remaining := max(0, buffer.maximum-buffer.Len())
		_, _ = buffer.Buffer.Write(value[:remaining])
		buffer.exceeded = true
		return len(value), nil
	}
	return buffer.Buffer.Write(value)
}
