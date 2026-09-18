package database

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"unicode"

	"github.com/pressly/goose/v3"
	goosedb "github.com/pressly/goose/v3/database"
	assets "github.com/wechuli/wealthboard/db"
)

const gooseTable = "goose_db_version"
const drizzleTableSQL = `CREATE TABLE "__drizzle_migrations" (
	id SERIAL PRIMARY KEY,
	hash text NOT NULL,
	created_at numeric
)`

// Existing repository migration fixtures also use SQLite's native integer key.
const drizzleFixtureTableSQL = `CREATE TABLE __drizzle_migrations (
	id integer PRIMARY KEY AUTOINCREMENT,
	hash text NOT NULL,
	created_at numeric
)`

var (
	ErrOffline     = errors.New("adoption requires --confirm-offline; stop all application processes first")
	ErrUnadopted   = errors.New("nonempty database requires explicit migrate-adopt --confirm-offline")
	ErrHistory     = errors.New("database migration history is missing, modified, or unsupported")
	ErrSchema      = errors.New("database schema does not match the recorded migration history")
	ErrForeignKeys = errors.New("database has invalid foreign-key relationships")
)

type MigrationStatus struct {
	State            string
	LegacyMigrations int
	GooseVersion     int64
}

type AdoptionResult struct {
	AlreadyAdopted bool
	BackupPath     string
}

type legacyMigration struct {
	Timestamp int64  `json:"when"`
	Tag       string `json:"tag"`
	SQL       string
	Hash      string
}

func legacyMigrations() ([]legacyMigration, error) {
	data, err := assets.Assets.ReadFile("migrations/meta/_journal.json")
	if err != nil {
		return nil, err
	}
	var journal struct {
		Entries []legacyMigration `json:"entries"`
	}
	if err := json.Unmarshal(data, &journal); err != nil {
		return nil, err
	}
	for i := range journal.Entries {
		m := &journal.Entries[i]
		data, err := assets.Assets.ReadFile("migrations/" + m.Tag + ".sql")
		if err != nil {
			return nil, err
		}
		m.SQL = string(data)
		sum := sha256.Sum256(data)
		m.Hash = hex.EncodeToString(sum[:])
	}
	return journal.Entries, nil
}

func versionStore() (goosedb.Store, error) {
	return goosedb.NewStore(goosedb.DialectSQLite3, gooseTable)
}

// Status never creates a database or migration bookkeeping. Unknown states are
// errors rather than an invitation to apply a new baseline.
func Status(ctx context.Context, config Config) (MigrationStatus, error) {
	if _, err := os.Stat(config.DatabasePath); errors.Is(err, os.ErrNotExist) {
		return MigrationStatus{State: "missing"}, nil
	} else if err != nil {
		return MigrationStatus{}, err
	}
	handle, err := openPath(ctx, config.DatabasePath, "ro", false)
	if err != nil {
		return MigrationStatus{}, err
	}
	defer handle.Close()
	tx, err := handle.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return MigrationStatus{}, err
	}
	defer tx.Rollback()
	return inspect(ctx, tx)
}

func Migrate(ctx context.Context, config Config) error {
	status, err := Status(ctx, config)
	if err != nil {
		return err
	}
	if status.State == "legacy" {
		return ErrUnadopted
	}
	if status.State == "goose" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(config.DatabasePath), 0700); err != nil {
		return err
	}
	handle, err := Open(ctx, config.DatabasePath)
	if err != nil {
		return err
	}
	defer handle.Close()
	// Recheck after opening: never use IF NOT EXISTS to mask an existing schema.
	status, err = inspect(ctx, handle)
	if err != nil {
		return err
	}
	if status.State != "empty" {
		return ErrUnadopted
	}
	migrations, err := fs.Sub(assets.Assets, "goose")
	if err != nil {
		return err
	}
	provider, err := goose.NewProvider(goose.DialectSQLite3, handle, migrations)
	if err != nil {
		return err
	}
	if _, err := provider.Up(ctx); err != nil {
		return err
	}
	_, err = inspect(ctx, handle)
	return err
}

// Adopt is deliberately offline-only. Confirmation is an operator assertion,
// not detection of a running Next.js process.
func Adopt(ctx context.Context, config Config, confirmOffline bool) (AdoptionResult, error) {
	if !confirmOffline {
		return AdoptionResult{}, ErrOffline
	}
	handle, err := openPath(ctx, config.DatabasePath, "rw", false)
	if err != nil {
		return AdoptionResult{}, err
	}
	defer handle.Close()
	conn, err := handle.Conn(ctx)
	if err != nil {
		return AdoptionResult{}, err
	}
	defer conn.Close()
	status, err := inspect(ctx, conn)
	if err != nil {
		return AdoptionResult{}, err
	}
	if status.State == "goose" {
		return AdoptionResult{AlreadyAdopted: true}, nil
	}
	if status.State != "legacy" {
		return AdoptionResult{}, ErrHistory
	}
	backupPath, err := backup(ctx, conn, config.BackupPath)
	if err != nil {
		return AdoptionResult{}, err
	}
	result := AdoptionResult{BackupPath: backupPath}
	migrations, err := legacyMigrations()
	if err != nil {
		return result, err
	}
	return result, upgradeAndRecord(ctx, conn, migrations)
}

func upgradeAndRecord(ctx context.Context, conn *sql.Conn, migrations []legacyMigration) error {
	// SQLite ignores foreign_keys changes within transactions. All rebuilds
	// therefore run on this dedicated connection with FK validation pre-commit.
	if _, err := conn.ExecContext(ctx, "PRAGMA foreign_keys=OFF"); err != nil {
		return err
	}
	defer conn.ExecContext(context.Background(), "PRAGMA foreign_keys=ON")
	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		return err
	}
	defer conn.ExecContext(context.Background(), "ROLLBACK")
	status, err := inspect(ctx, conn)
	if err != nil {
		return err
	}
	if status.State != "legacy" {
		return ErrHistory
	}
	for _, migration := range migrations[status.LegacyMigrations:] {
		if err := applyLegacy(ctx, conn, migration); err != nil {
			return err
		}
		if _, err := conn.ExecContext(ctx,
			"INSERT INTO __drizzle_migrations(hash, created_at) VALUES (?, ?)",
			migration.Hash, migration.Timestamp); err != nil {
			return err
		}
	}
	store, err := versionStore()
	if err != nil {
		return err
	}
	if err := store.CreateVersionTable(ctx, conn); err != nil {
		return err
	}
	for _, version := range []int64{0, 1} {
		if err := store.Insert(ctx, conn, goosedb.InsertRequest{Version: version}); err != nil {
			return err
		}
	}
	if _, err := inspect(ctx, conn); err != nil {
		return err
	}
	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		return err
	}
	if _, err := conn.ExecContext(ctx, "PRAGMA foreign_keys=ON"); err != nil {
		return err
	}
	return nil
}

func applyLegacy(ctx context.Context, conn goosedb.DBTxConn, migration legacyMigration) error {
	for _, statement := range strings.Split(migration.SQL, "--> statement-breakpoint") {
		if strings.TrimSpace(statement) == "" {
			continue
		}
		if _, err := conn.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	return nil
}

func inspect(ctx context.Context, conn goosedb.DBTxConn) (MigrationStatus, error) {
	actual, err := schemaObjects(ctx, conn)
	if err != nil {
		return MigrationStatus{}, err
	}
	if len(actual) == 0 {
		return MigrationStatus{State: "empty"}, nil
	}
	migrations, err := legacyMigrations()
	if err != nil {
		return MigrationStatus{}, err
	}
	_, hasDrizzle := actual["table:__drizzle_migrations"]
	_, hasGoose := actual["table:"+gooseTable]
	prefix := 0
	if hasDrizzle {
		if actual["table:__drizzle_migrations"] != normalizeSQL(drizzleTableSQL) &&
			actual["table:__drizzle_migrations"] != normalizeSQL(drizzleFixtureTableSQL) {
			return MigrationStatus{}, ErrHistory
		}
		rows, err := conn.QueryContext(ctx, "SELECT hash, created_at FROM __drizzle_migrations ORDER BY rowid")
		if err != nil {
			return MigrationStatus{}, ErrHistory
		}
		for rows.Next() {
			var timestamp int64
			var hash string
			if err := rows.Scan(&hash, &timestamp); err != nil {
				rows.Close()
				return MigrationStatus{}, ErrHistory
			}
			if prefix >= len(migrations) ||
				hash != migrations[prefix].Hash || timestamp != migrations[prefix].Timestamp {
				rows.Close()
				return MigrationStatus{}, ErrHistory
			}
			prefix++
		}
		err = rows.Err()
		rows.Close()
		if err != nil || prefix == 0 {
			return MigrationStatus{}, ErrHistory
		}
	}
	state := "legacy"
	if hasGoose {
		store, err := versionStore()
		if err != nil {
			return MigrationStatus{}, err
		}
		versions, err := store.ListMigrations(ctx, conn)
		if err != nil {
			return MigrationStatus{}, ErrHistory
		}
		if len(versions) != 2 || versions[0].Version != 1 || !versions[0].IsApplied ||
			versions[1].Version != 0 || !versions[1].IsApplied {
			return MigrationStatus{}, ErrHistory
		}
		if hasDrizzle && prefix != len(migrations) {
			return MigrationStatus{}, ErrHistory
		}
		state = "goose"
	} else if !hasDrizzle {
		return MigrationStatus{}, ErrHistory
	}
	expectedPrefix := prefix
	if hasGoose {
		expectedPrefix = len(migrations)
	}
	expected, err := expectedSchema(ctx, migrations[:expectedPrefix], hasDrizzle, hasGoose)
	if err != nil {
		return MigrationStatus{}, err
	}
	if hasDrizzle {
		expected["table:__drizzle_migrations"] = actual["table:__drizzle_migrations"]
	}
	if !reflect.DeepEqual(actual, expected) {
		return MigrationStatus{}, ErrSchema
	}
	if err := checkForeignKeys(ctx, conn); err != nil {
		return MigrationStatus{}, err
	}
	status := MigrationStatus{State: state, LegacyMigrations: prefix}
	if hasGoose {
		status.GooseVersion = 1
	}
	return status, nil
}

func expectedSchema(ctx context.Context, migrations []legacyMigration, drizzle, goose bool) (map[string]string, error) {
	handle, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		return nil, err
	}
	defer handle.Close()
	handle.SetMaxOpenConns(1)
	tx, err := handle.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	for _, migration := range migrations {
		if err := applyLegacy(ctx, tx, migration); err != nil {
			return nil, err
		}
	}
	if drizzle {
		if _, err := tx.ExecContext(ctx, drizzleTableSQL); err != nil {
			return nil, err
		}
	}
	if goose {
		store, err := versionStore()
		if err != nil {
			return nil, err
		}
		if err := store.CreateVersionTable(ctx, tx); err != nil {
			return nil, err
		}
	}
	return schemaObjects(ctx, tx)
}

func schemaObjects(ctx context.Context, conn goosedb.DBTxConn) (map[string]string, error) {
	rows, err := conn.QueryContext(ctx, `SELECT type, name, sql FROM sqlite_schema
		WHERE substr(name, 1, 7) != 'sqlite_' ORDER BY type, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]string{}
	for rows.Next() {
		var kind, name string
		var statement sql.NullString
		if err := rows.Scan(&kind, &name, &statement); err != nil {
			return nil, err
		}
		result[kind+":"+name] = normalizeSQL(statement.String)
	}
	return result, rows.Err()
}

// Ignore formatting and identifier quoting, never whitespace/case in literals.
func normalizeSQL(statement string) string {
	var tokens []string
	for i := 0; i < len(statement); {
		ch := statement[i]
		if unicode.IsSpace(rune(ch)) || ch == ';' {
			i++
			continue
		}
		if ch == '\'' || ch == '"' || ch == '`' {
			quote := ch
			i++
			var value strings.Builder
			for i < len(statement) {
				if statement[i] == quote {
					i++
					if i < len(statement) && statement[i] == quote {
						value.WriteByte(quote)
						i++
						continue
					}
					break
				}
				value.WriteByte(statement[i])
				i++
			}
			if quote == '\'' {
				tokens = append(tokens, strconv.Quote(value.String()))
			} else {
				tokens = append(tokens, strings.ToLower(value.String()))
			}
			continue
		}
		start := i
		for i < len(statement) && (unicode.IsLetter(rune(statement[i])) || unicode.IsDigit(rune(statement[i])) || statement[i] == '_') {
			i++
		}
		if i == start {
			i++
		}
		tokens = append(tokens, strings.ToLower(statement[start:i]))
	}
	return strings.Join(tokens, " ")
}

func checkForeignKeys(ctx context.Context, conn goosedb.DBTxConn) error {
	rows, err := conn.QueryContext(ctx, "PRAGMA foreign_key_check")
	if err != nil {
		return err
	}
	defer rows.Close()
	if rows.Next() {
		return ErrForeignKeys
	}
	return rows.Err()
}

func backup(ctx context.Context, conn *sql.Conn, directory string) (string, error) {
	if err := os.MkdirAll(directory, 0700); err != nil {
		return "", err
	}
	var token [16]byte
	if _, err := rand.Read(token[:]); err != nil {
		return "", err
	}
	path, err := filepath.Abs(filepath.Join(directory, "pre-goose-"+hex.EncodeToString(token[:])+".db"))
	if err != nil {
		return "", err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return "", err
	}
	defer file.Close()
	ok := false
	defer func() {
		if !ok {
			os.Remove(path)
		}
	}()
	// VACUUM INTO includes committed WAL pages, unlike copying the main file.
	if _, err := conn.ExecContext(ctx, "VACUUM INTO ?", path); err != nil {
		return "", err
	}
	if err := file.Sync(); err != nil {
		return "", err
	}
	parent, err := os.Open(filepath.Dir(path))
	if err != nil {
		return "", err
	}
	err = parent.Sync()
	closeErr := parent.Close()
	if err != nil {
		return "", err
	}
	if closeErr != nil {
		return "", closeErr
	}
	ok = true
	return path, nil
}

// OperatorError intentionally does not expose driver errors, SQL, or row data.
func OperatorError(err error) string {
	for _, safe := range []error{ErrOffline, ErrUnadopted, ErrHistory, ErrSchema, ErrForeignKeys} {
		if errors.Is(err, safe) {
			return safe.Error()
		}
	}
	return "database operation failed; verify database access and backup permissions, and retain the pre-adoption backup"
}
