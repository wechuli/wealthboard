package operator

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/wechuli/wealthboard/internal/config"
	"github.com/wechuli/wealthboard/internal/database"
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

func TestPostgreSQLNativeBackupRestore(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}

	ctx := context.Background()
	admin, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open admin database: %v", err)
	}

	databaseName := fmt.Sprintf("wealthboard_backup_test_%d", time.Now().UnixNano())
	if _, err := admin.ExecContext(ctx, "CREATE DATABASE "+databaseName); err != nil {
		t.Fatalf("create disposable database: %v", err)
	}
	t.Cleanup(func() {
		if _, err := admin.ExecContext(context.Background(), "DROP DATABASE "+databaseName+" WITH (FORCE)"); err != nil {
			t.Errorf("drop disposable database: %v", err)
		}
		if err := admin.Close(); err != nil {
			t.Errorf("close admin database: %v", err)
		}
	})

	targetURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse TEST_DATABASE_URL: %v", err)
	}
	targetURL.Path = "/" + databaseName
	targetURL.RawPath = ""
	query := targetURL.Query()
	query.Del("search_path")
	targetURL.RawQuery = query.Encode()

	db, err := database.Open(ctx, config.Database{
		URL:             targetURL.String(),
		MaxOpenConns:    2,
		MaxIdleConns:    1,
		ConnMaxLifetime: time.Minute,
		ConnMaxIdleTime: time.Minute,
		PingTimeout:     5 * time.Second,
	})
	if err != nil {
		t.Fatalf("open disposable database: %v", err)
	}
	if err := database.MigrateUp(ctx, db); err != nil {
		db.Close()
		t.Fatalf("migrate disposable database: %v", err)
	}
	const userID = "00000000-0000-0000-0000-000000000001"
	if _, err := db.ExecContext(ctx, `
		INSERT INTO users (id, username, created_at, updated_at)
		VALUES ($1, 'backup-owner', now(), now())
	`, userID); err != nil {
		db.Close()
		t.Fatalf("seed disposable database: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close disposable database before backup: %v", err)
	}

	archivePath := filepath.Join(t.TempDir(), "wealthboard.dump")
	var toolErrors bytes.Buffer
	tools := NewPostgresTools(io.Discard, &toolErrors)
	if err := tools.Backup(ctx, BackupOptions{DatabaseURL: targetURL.String(), FilePath: archivePath}); err != nil {
		t.Fatalf("backup disposable database: %v\nPostgreSQL tools: %s", err, toolErrors.String())
	}

	db, err = sql.Open("pgx", targetURL.String())
	if err != nil {
		t.Fatalf("reopen disposable database: %v", err)
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, userID); err != nil {
		db.Close()
		t.Fatalf("mutate disposable database before restore: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close disposable database before restore: %v", err)
	}

	result, err := tools.Restore(ctx, RestoreOptions{
		DatabaseURL: targetURL.String(), FilePath: archivePath, ConfirmMaintenance: true,
	})
	if err != nil {
		t.Fatalf("restore disposable database: %v\nPostgreSQL tools: %s", err, toolErrors.String())
	}
	if info, err := os.Stat(result.SafetyDumpPath); err != nil || info.Size() == 0 {
		t.Fatalf("pre-restore safety backup is missing or empty: info=%v err=%v", info, err)
	}

	db, err = sql.Open("pgx", targetURL.String())
	if err != nil {
		t.Fatalf("open restored database: %v", err)
	}
	defer db.Close()
	var username string
	if err := db.QueryRowContext(ctx, `SELECT username FROM users WHERE id = $1`, userID).Scan(&username); err != nil {
		t.Fatalf("read restored user: %v", err)
	}
	if username != "backup-owner" {
		t.Fatalf("restored username = %q, want backup-owner", username)
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
