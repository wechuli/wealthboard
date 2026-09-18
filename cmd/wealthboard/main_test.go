package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOperatorCommands(t *testing.T) {
	dir, err := os.MkdirTemp(".", "command-test-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "database 'with spaces'.db")
	t.Setenv("DATABASE_PATH", path)
	t.Setenv("BACKUP_PATH", filepath.Join(dir, "backups"))
	var stdout, stderr bytes.Buffer
	call := func(args ...string) int {
		stdout.Reset()
		stderr.Reset()
		return run(t.Context(), args, &stdout, &stderr)
	}
	if code := call("migrate-status"); code != 0 || !strings.Contains(stdout.String(), "state=missing") {
		t.Fatalf("%d %s %s", code, &stdout, &stderr)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("status created DB: %v", err)
	}
	if code := call("migrate-adopt"); code != 1 || !strings.Contains(stderr.String(), "--confirm-offline") {
		t.Fatalf("%d %s", code, &stderr)
	}
	if code := call("migrate"); code != 0 {
		t.Fatalf("%d %s", code, &stderr)
	}
	if code := call("migrate-status"); code != 0 || !strings.Contains(stdout.String(), "state=goose goose=1 legacy=0") {
		t.Fatalf("%d %s %s", code, &stdout, &stderr)
	}
	if code := call("migrate-adopt", "--confirm-offline"); code != 0 || !strings.Contains(stdout.String(), "already recorded") {
		t.Fatalf("%d %s %s", code, &stdout, &stderr)
	}
	for _, args := range [][]string{nil, {"serve"}, {"backup"}, {"migrate", "--force"}, {"migrate-status", "--write"}, {"migrate-adopt", "--unknown"}} {
		if code := call(args...); code != 2 {
			t.Fatalf("%v: %d %s", args, code, &stderr)
		}
	}
	t.Setenv("DATABASE_PATH", filepath.Join(dir, "missing parent", "private-value.db"))
	if code := call("migrate-adopt", "--confirm-offline"); code != 1 || strings.Contains(stderr.String(), "private-value") {
		t.Fatalf("%d %s", code, &stderr)
	}
}
