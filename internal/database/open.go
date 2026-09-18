package database

import (
	"context"
	"database/sql"
	"net/url"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

type Config struct {
	DatabasePath string
	BackupPath   string
}

func ConfigFromEnv() Config {
	return Config{
		DatabasePath: envDefault("DATABASE_PATH", "./data/wealthboard.db"),
		BackupPath:   envDefault("BACKUP_PATH", "./backups"),
	}
}

func envDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

// Open configures every connection, including replacements, with the same
// safety settings. One connection bounds writes to SQLite's single writer.
func Open(ctx context.Context, path string) (*sql.DB, error) {
	return openPath(ctx, path, "rwc", true)
}

func openPath(ctx context.Context, path, mode string, wal bool) (*sql.DB, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if mode == "rwc" {
		file, err := os.OpenFile(absolute, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
		if err != nil && !os.IsExist(err) {
			return nil, err
		}
		if err == nil {
			if err := file.Close(); err != nil {
				return nil, err
			}
		}
	}
	u := url.URL{Scheme: "file", Path: absolute}
	q := url.Values{"mode": {mode}, "_pragma": {"foreign_keys(1)", "busy_timeout(5000)"}}
	if wal {
		q.Add("_pragma", "journal_mode(WAL)")
	}
	u.RawQuery = q.Encode()
	handle, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, err
	}
	handle.SetMaxOpenConns(1)
	handle.SetMaxIdleConns(1)
	if err := handle.PingContext(ctx); err != nil {
		handle.Close()
		return nil, err
	}
	return handle, nil
}
