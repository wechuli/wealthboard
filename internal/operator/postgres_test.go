package operator

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

type recordedCommand struct {
	executable string
	args       []string
	env        []string
}

type recordingRunner struct {
	commands []recordedCommand
	failAt   int
}

func (runner *recordingRunner) Run(_ context.Context, executable string, args []string, env []string) error {
	runner.commands = append(runner.commands, recordedCommand{executable: executable, args: args, env: env})
	if runner.failAt > 0 && len(runner.commands) == runner.failAt {
		return errors.New("command failed")
	}
	if strings.HasSuffix(executable, "pg_dump") {
		for index, argument := range args {
			if argument == "--file" && index+1 < len(args) {
				if err := os.WriteFile(args[index+1], []byte("custom archive"), 0o600); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func TestBackupRequiresExplicitPath(t *testing.T) {
	tools := testTools(&recordingRunner{})
	err := tools.Backup(context.Background(), BackupOptions{DatabaseURL: testDatabaseURL})
	if err == nil || !strings.Contains(err.Error(), "explicit --file") {
		t.Fatalf("Backup() error = %v", err)
	}
}

func TestRestoreRequiresMaintenanceConfirmationBeforeCommands(t *testing.T) {
	runner := &recordingRunner{}
	tools := testTools(runner)
	_, err := tools.Restore(context.Background(), RestoreOptions{DatabaseURL: testDatabaseURL, FilePath: "backup.dump"})
	if err == nil || !strings.Contains(err.Error(), "--confirm-maintenance") {
		t.Fatalf("Restore() error = %v", err)
	}
	if len(runner.commands) != 0 {
		t.Fatalf("commands = %v, want none", runner.commands)
	}
}

func TestRestoreValidatesBacksUpRestoresAndChecksReadiness(t *testing.T) {
	directory := t.TempDir()
	archivePath := filepath.Join(directory, "source.dump")
	if err := os.WriteFile(archivePath, []byte("archive"), 0o600); err != nil {
		t.Fatal(err)
	}
	runner := &recordingRunner{}
	tools := testTools(runner)
	validated := false
	tools.validate = func(_ context.Context, databaseURL string) error {
		validated = databaseURL == testDatabaseURL
		return nil
	}

	result, err := tools.Restore(context.Background(), RestoreOptions{
		DatabaseURL: testDatabaseURL, FilePath: archivePath, ConfirmMaintenance: true,
	})
	if err != nil {
		t.Fatalf("Restore() error = %v", err)
	}
	if !validated {
		t.Fatal("post-restore validation was not called")
	}
	wantSafetyPath := filepath.Join(directory, "wealthboard-pre-restore-20260920T120000Z.dump")
	if result.SafetyDumpPath != wantSafetyPath {
		t.Fatalf("SafetyDumpPath = %q, want %q", result.SafetyDumpPath, wantSafetyPath)
	}
	if len(runner.commands) != 3 {
		t.Fatalf("commands = %d, want 3", len(runner.commands))
	}
	if !reflect.DeepEqual(runner.commands[0].args, []string{"--list", archivePath}) {
		t.Fatalf("preflight args = %v", runner.commands[0].args)
	}
	if runner.commands[1].executable != "/usr/bin/pg_dump" || !containsArgument(runner.commands[1].args, wantSafetyPath) {
		t.Fatalf("safety backup command = %#v", runner.commands[1])
	}
	if runner.commands[2].executable != "/usr/bin/pg_restore" || !containsArgument(runner.commands[2].args, "wealthboard") {
		t.Fatalf("restore command = %#v", runner.commands[2])
	}
	for _, command := range runner.commands {
		for _, argument := range command.args {
			if strings.Contains(argument, "secret") || strings.Contains(argument, "postgres://") {
				t.Fatalf("database secret leaked into argument %q", argument)
			}
		}
		for _, environment := range command.env {
			if strings.HasPrefix(environment, "DATABASE_URL=") {
				t.Fatal("DATABASE_URL was inherited by PostgreSQL subprocess")
			}
		}
	}
}

func TestRestoreStopsWhenArchivePreflightFails(t *testing.T) {
	directory := t.TempDir()
	archivePath := filepath.Join(directory, "source.dump")
	if err := os.WriteFile(archivePath, []byte("invalid"), 0o600); err != nil {
		t.Fatal(err)
	}
	runner := &recordingRunner{failAt: 1}
	tools := testTools(runner)
	_, err := tools.Restore(context.Background(), RestoreOptions{
		DatabaseURL: testDatabaseURL, FilePath: archivePath, ConfirmMaintenance: true,
	})
	if err == nil || !strings.Contains(err.Error(), "validate PostgreSQL restore archive") {
		t.Fatalf("Restore() error = %v", err)
	}
	if len(runner.commands) != 1 {
		t.Fatalf("commands = %d, want preflight only", len(runner.commands))
	}
}

const testDatabaseURL = "postgres://wealthboard:secret@db.example:5432/wealthboard?sslmode=require"

func testTools(runner commandRunner) *PostgresTools {
	return &PostgresTools{
		lookPath: func(name string) (string, error) { return "/usr/bin/" + name, nil },
		runner:   runner,
		now:      func() time.Time { return time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC) },
		validate: func(context.Context, string) error { return nil },
	}
}

func containsArgument(arguments []string, expected string) bool {
	for _, argument := range arguments {
		if argument == expected {
			return true
		}
	}
	return false
}
