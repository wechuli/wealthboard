package operator

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/wechuli/wealthboard/internal/database"
)

type commandRunner interface {
	Run(ctx context.Context, executable string, args []string, env []string) error
}

type execRunner struct {
	stdout io.Writer
	stderr io.Writer
}

func (runner execRunner) Run(ctx context.Context, executable string, args []string, env []string) error {
	command := exec.CommandContext(ctx, executable, args...)
	command.Env = env
	command.Stdout = runner.stdout
	command.Stderr = runner.stderr
	return command.Run()
}

type PostgresTools struct {
	lookPath func(string) (string, error)
	runner   commandRunner
	now      func() time.Time
	validate func(context.Context, string) error
}

type BackupOptions struct {
	DatabaseURL string
	FilePath    string
}

type RestoreOptions struct {
	DatabaseURL        string
	FilePath           string
	ConfirmMaintenance bool
}

type RestoreResult struct {
	SafetyDumpPath string
}

func NewPostgresTools(stdout, stderr io.Writer) *PostgresTools {
	return &PostgresTools{
		lookPath: exec.LookPath,
		runner:   execRunner{stdout: stdout, stderr: stderr},
		now:      time.Now,
		validate: validateRestoredDatabase,
	}
}

func (tools *PostgresTools) Backup(ctx context.Context, options BackupOptions) error {
	if strings.TrimSpace(options.DatabaseURL) == "" {
		return errors.New("DATABASE_URL is required")
	}
	filePath, err := explicitFilePath(options.FilePath)
	if err != nil {
		return err
	}
	if _, err := os.Stat(filePath); err == nil {
		return fmt.Errorf("backup file already exists: %s", filePath)
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect backup file: %w", err)
	}
	if info, err := os.Stat(filepath.Dir(filePath)); err != nil || !info.IsDir() {
		return fmt.Errorf("backup directory must already exist: %s", filepath.Dir(filePath))
	}
	reserved, err := os.OpenFile(filePath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("reserve backup file: %w", err)
	}
	if err := reserved.Close(); err != nil {
		_ = os.Remove(filePath)
		return fmt.Errorf("reserve backup file: %w", err)
	}

	pgDump, err := tools.lookupExecutable("pg_dump")
	if err != nil {
		_ = os.Remove(filePath)
		return err
	}
	env, _, err := postgresEnvironment(options.DatabaseURL)
	if err != nil {
		_ = os.Remove(filePath)
		return err
	}
	args := []string{"--format=custom", "--no-owner", "--no-privileges", "--file", filePath}
	if err := tools.runner.Run(ctx, pgDump, args, env); err != nil {
		_ = os.Remove(filePath)
		return fmt.Errorf("create PostgreSQL backup: %w", err)
	}
	info, err := os.Stat(filePath)
	if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
		_ = os.Remove(filePath)
		return errors.New("pg_dump completed without creating a nonempty regular backup file")
	}
	if err := os.Chmod(filePath, 0o600); err != nil {
		return fmt.Errorf("secure PostgreSQL backup permissions: %w", err)
	}
	return nil
}

func (tools *PostgresTools) Restore(ctx context.Context, options RestoreOptions) (RestoreResult, error) {
	if !options.ConfirmMaintenance {
		return RestoreResult{}, errors.New("restore requires --confirm-maintenance and the application must be stopped")
	}
	if strings.TrimSpace(options.DatabaseURL) == "" {
		return RestoreResult{}, errors.New("DATABASE_URL is required")
	}
	archivePath, err := explicitFilePath(options.FilePath)
	if err != nil {
		return RestoreResult{}, err
	}
	if info, err := os.Stat(archivePath); err != nil {
		return RestoreResult{}, fmt.Errorf("inspect restore archive: %w", err)
	} else if !info.Mode().IsRegular() {
		return RestoreResult{}, errors.New("restore archive must be a regular file")
	}

	pgRestore, err := tools.lookupExecutable("pg_restore")
	if err != nil {
		return RestoreResult{}, err
	}
	if _, err := tools.lookupExecutable("pg_dump"); err != nil {
		return RestoreResult{}, err
	}
	if err := tools.runner.Run(ctx, pgRestore, []string{"--list", archivePath}, filteredEnvironment(os.Environ())); err != nil {
		return RestoreResult{}, fmt.Errorf("validate PostgreSQL restore archive: %w", err)
	}

	safetyPath := filepath.Join(
		filepath.Dir(archivePath),
		fmt.Sprintf("wealthboard-pre-restore-%s.dump", tools.now().UTC().Format("20060102T150405Z")),
	)
	if err := tools.Backup(ctx, BackupOptions{DatabaseURL: options.DatabaseURL, FilePath: safetyPath}); err != nil {
		return RestoreResult{}, fmt.Errorf("create pre-restore safety backup: %w", err)
	}

	env, databaseName, err := postgresEnvironment(options.DatabaseURL)
	if err != nil {
		return RestoreResult{SafetyDumpPath: safetyPath}, err
	}
	args := []string{
		"--clean", "--if-exists", "--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges",
		"--dbname", databaseName, archivePath,
	}
	if err := tools.runner.Run(ctx, pgRestore, args, env); err != nil {
		return RestoreResult{SafetyDumpPath: safetyPath}, fmt.Errorf("restore PostgreSQL backup; safety backup retained at %s: %w", safetyPath, err)
	}
	if err := tools.validate(ctx, options.DatabaseURL); err != nil {
		return RestoreResult{SafetyDumpPath: safetyPath}, fmt.Errorf("validate restored PostgreSQL database; safety backup retained at %s: %w", safetyPath, err)
	}
	return RestoreResult{SafetyDumpPath: safetyPath}, nil
}

func (tools *PostgresTools) lookupExecutable(name string) (string, error) {
	path, err := tools.lookPath(name)
	if err != nil {
		return "", fmt.Errorf("required PostgreSQL executable %q was not found in PATH: %w", name, err)
	}
	return path, nil
}

func explicitFilePath(value string) (string, error) {
	if strings.TrimSpace(value) == "" {
		return "", errors.New("an explicit --file path is required")
	}
	path, err := filepath.Abs(value)
	if err != nil {
		return "", fmt.Errorf("resolve file path: %w", err)
	}
	return filepath.Clean(path), nil
}

func postgresEnvironment(databaseURL string) ([]string, string, error) {
	parsed, err := url.Parse(databaseURL)
	if err != nil || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") {
		return nil, "", errors.New("DATABASE_URL must be a postgres:// or postgresql:// URL")
	}
	databaseName := strings.TrimPrefix(parsed.EscapedPath(), "/")
	if databaseName == "" || parsed.Hostname() == "" || parsed.User == nil || parsed.User.Username() == "" {
		return nil, "", errors.New("DATABASE_URL must include host, username, and database name")
	}
	databaseName, err = url.PathUnescape(databaseName)
	if err != nil {
		return nil, "", errors.New("DATABASE_URL contains an invalid database name")
	}

	env := filteredEnvironment(os.Environ())
	env = append(env,
		"PGHOST="+parsed.Hostname(),
		"PGUSER="+parsed.User.Username(),
		"PGDATABASE="+databaseName,
		"PGAPPNAME=wealthboard-operator",
		"PGCONNECT_TIMEOUT=10",
	)
	if port := parsed.Port(); port != "" {
		env = append(env, "PGPORT="+port)
	}
	if password, ok := parsed.User.Password(); ok {
		env = append(env, "PGPASSWORD="+password)
	}
	if sslMode := parsed.Query().Get("sslmode"); sslMode != "" {
		env = append(env, "PGSSLMODE="+sslMode)
	}
	return env, databaseName, nil
}

func filteredEnvironment(environment []string) []string {
	filtered := make([]string, 0, len(environment))
	for _, entry := range environment {
		name, _, _ := strings.Cut(entry, "=")
		if name == "DATABASE_URL" || strings.HasPrefix(name, "PG") {
			continue
		}
		filtered = append(filtered, entry)
	}
	return filtered
}

func validateRestoredDatabase(ctx context.Context, databaseURL string) error {
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return fmt.Errorf("open restored PostgreSQL database: %w", err)
	}
	defer db.Close()
	if err := database.CheckReady(ctx, db); err != nil {
		return err
	}
	var invalidConstraints int
	if err := db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM pg_constraint
		WHERE contype = 'f' AND NOT convalidated
	`).Scan(&invalidConstraints); err != nil {
		return fmt.Errorf("inspect restored foreign keys: %w", err)
	}
	if invalidConstraints != 0 {
		return fmt.Errorf("restored PostgreSQL database has %d unvalidated foreign keys", invalidConstraints)
	}
	return nil
}
