package database

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	assets "github.com/wechuli/wealthboard/db"
	"github.com/wechuli/wealthboard/internal/database/generated"
)

func workspace(t *testing.T) string {
	t.Helper()
	path, err := os.MkdirTemp(".", "migration-test-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(path) })
	return path
}

func configFor(t *testing.T) Config {
	dir := workspace(t)
	return Config{
		DatabasePath: filepath.Join(dir, "database with 'quotes' & spaces.db"),
		BackupPath:   filepath.Join(dir, "backups with 'quotes' & spaces"),
	}
}

func execute(t *testing.T, handle *sql.DB, statement string, args ...any) {
	t.Helper()
	if _, err := handle.Exec(statement, args...); err != nil {
		t.Fatal(err)
	}
}

func fixture(t *testing.T, config Config, prefix int) *sql.DB {
	t.Helper()
	handle, err := Open(t.Context(), config.DatabasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { handle.Close() })
	execute(t, handle, "PRAGMA foreign_keys=OFF")
	tx, err := handle.Begin()
	if err != nil {
		t.Fatal(err)
	}
	migrations, err := legacyMigrations()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(drizzleTableSQL); err != nil {
		t.Fatal(err)
	}
	for _, migration := range migrations[:prefix] {
		if err := applyLegacy(t.Context(), tx, migration); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec("INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)", migration.Hash, migration.Timestamp); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	execute(t, handle, "PRAGMA foreign_keys=ON")
	for index, user := range []string{"user-a", "user-b"} {
		execute(t, handle, `INSERT INTO users(id,username,password_hash,session_version,created_at,updated_at)
			VALUES(?,?,?,7,'2026-01-01','2026-01-01')`, user, "fictional-"+user, "fictional-hash-"+user)
		execute(t, handle, `INSERT INTO user_settings(id,user_id,display_name,created_at,updated_at)
			VALUES(?,?,?,'2026-01-01','2026-01-01')`, "settings-"+user, user, "Fictional "+user)
		execute(t, handle, `INSERT INTO categories(id,user_id,name,slug,is_system,created_at,updated_at)
			VALUES(?,?,'Fixed Income','fixed-income',1,'2026-01-01','2026-01-01')`, "category-"+user, user)
		execute(t, handle, `INSERT INTO accounts(id,user_id,name,category_id,currency,current_value_minor,created_at,updated_at)
			VALUES(?,?,?,?, 'USD',?,'2026-01-01','2026-01-01')`, "account-"+user, user, "Fictional "+user, "category-"+user, 12345+index)
		execute(t, handle, `INSERT INTO transactions(id,user_id,account_id,type,amount_minor,currency,transaction_date,created_at,updated_at)
			VALUES(?,?,?,'opening_balance',?,'USD','2026-01-01','2026-01-01','2026-01-01')`, "transaction-"+user, user, "account-"+user, 12345+index)
		execute(t, handle, `INSERT INTO valuation_snapshots(id,user_id,account_id,value_minor,currency,valuation_date,created_at)
			VALUES(?,?,?,?,'USD','2026-01-02','2026-01-02')`, "valuation-"+user, user, "account-"+user, 12345+index)
		execute(t, handle, `INSERT INTO exchange_rates(id,user_id,base_currency,quote_currency,rate,effective_date,created_at)
			VALUES(?,?,'USD','KES','129.123456789','2026-01-01','2026-01-01')`, "rate-"+user, user)
		execute(t, handle, `INSERT INTO goals(id,user_id,name,target_amount_minor,currency,target_date,linked_account_id,created_at,updated_at)
			VALUES(?,?,'Fictional goal',100000,'USD','2027-01-01',?,'2026-01-01','2026-01-01')`, "goal-"+user, user, "account-"+user)
		execute(t, handle, `INSERT INTO idempotency_keys(user_id,key,operation,result_id,created_at)
			VALUES(?,'fictional-idempotency','fixture',?,'2026-01-01')`, user, "transaction-"+user)
	}
	return handle
}

func financialSnapshot(t *testing.T, handle *sql.DB) []string {
	t.Helper()
	rows, err := handle.Query(`SELECT u.id,u.password_hash,u.session_version,a.id,a.current_value_minor,
		t.id,t.amount_minor,v.id,v.value_minor,s.display_name,r.rate,g.linked_account_id,g.current_amount_minor,
		k.key,u.created_at
		FROM users u JOIN accounts a ON a.user_id=u.id JOIN transactions t ON t.account_id=a.id
		JOIN valuation_snapshots v ON v.account_id=a.id JOIN user_settings s ON s.user_id=u.id
		JOIN exchange_rates r ON r.user_id=u.id JOIN goals g ON g.user_id=u.id
		JOIN idempotency_keys k ON k.user_id=u.id ORDER BY u.id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var result []string
	for rows.Next() {
		var user, hash, account, transaction, valuation, display, rate, linked, key, created string
		var session, balance, amount, value, goalAmount int64
		if err := rows.Scan(&user, &hash, &session, &account, &balance, &transaction, &amount, &valuation, &value, &display, &rate, &linked, &goalAmount, &key, &created); err != nil {
			t.Fatal(err)
		}
		result = append(result, fmt.Sprint(user, hash, session, account, balance, transaction, amount, valuation, value, display, rate, linked, goalAmount, key, created))
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return result
}

func tableCounts(t *testing.T, handle *sql.DB) map[string]int {
	t.Helper()
	objects, err := schemaObjects(t.Context(), handle)
	if err != nil {
		t.Fatal(err)
	}
	counts := make(map[string]int)
	for key := range objects {
		if !strings.HasPrefix(key, "table:") || key == "table:__drizzle_migrations" || key == "table:"+gooseTable {
			continue
		}
		name := strings.TrimPrefix(key, "table:")
		var count int
		if err := handle.QueryRow(`SELECT count(*) FROM "` + strings.ReplaceAll(name, `"`, `""`) + `"`).Scan(&count); err != nil {
			t.Fatal(err)
		}
		counts[name] = count
	}
	return counts
}

func TestFreshMigrateAndOwnerQueries(t *testing.T) {
	config := configFor(t)
	if err := Migrate(t.Context(), config); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(t.Context(), config); err != nil {
		t.Fatal(err)
	}
	status, err := Status(t.Context(), config)
	if err != nil || status.State != "goose" || status.GooseVersion != 1 || status.LegacyMigrations != 0 {
		t.Fatalf("%+v %v", status, err)
	}
	handle, err := Open(t.Context(), config.DatabasePath)
	if err != nil {
		t.Fatal(err)
	}
	defer handle.Close()
	schema, err := assets.Assets.ReadFile("schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	memory, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer memory.Close()
	if _, err := memory.Exec(string(schema)); err != nil {
		t.Fatal(err)
	}
	baseline, err := schemaObjects(t.Context(), memory)
	if err != nil {
		t.Fatal(err)
	}
	current, err := schemaObjects(t.Context(), handle)
	if err != nil {
		t.Fatal(err)
	}
	delete(current, "table:"+gooseTable)
	if !reflect.DeepEqual(baseline, current) {
		t.Fatal("baseline/schema.sql drift")
	}
	for _, user := range []string{"a", "b"} {
		execute(t, handle, `INSERT INTO users(id,username,created_at,updated_at) VALUES(?,?,'2026-01-01','2026-01-01')`, user, user)
		execute(t, handle, `INSERT INTO categories(id,user_id,name,slug,created_at,updated_at) VALUES(?,?,'Category','category','2026-01-01','2026-01-01')`, user, user)
		execute(t, handle, `INSERT INTO accounts(id,user_id,name,category_id,currency,created_at,updated_at) VALUES(?,?,?,?,'USD','2026-01-01','2026-01-01')`, user, user, "Fictional "+user, user)
	}
	queries := generated.New(handle)
	for _, user := range []string{"a", "b"} {
		account, err := queries.GetAccount(t.Context(), generated.GetAccountParams{UserID: user, ID: user})
		if err != nil || account.UserID != user {
			t.Fatalf("owner query: %+v %v", account, err)
		}
		accounts, err := queries.ListAccounts(t.Context(), user)
		if err != nil || len(accounts) != 1 || accounts[0].UserID != user {
			t.Fatalf("owner list: %+v %v", accounts, err)
		}
	}
	if _, err := queries.GetAccount(t.Context(), generated.GetAccountParams{UserID: "b", ID: "a"}); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("cross-user lookup: %v", err)
	}
}

func TestAdoptEveryLegacyPrefix(t *testing.T) {
	migrations, err := legacyMigrations()
	if err != nil {
		t.Fatal(err)
	}
	for prefix := 1; prefix <= len(migrations); prefix++ {
		t.Run(fmt.Sprint(prefix), func(t *testing.T) {
			config := configFor(t)
			handle := fixture(t, config, prefix)
			before := financialSnapshot(t, handle)
			beforeCounts := tableCounts(t, handle)
			if len(before) != 2 {
				t.Fatal("fixture must have two users")
			}
			if err := Migrate(t.Context(), config); !errors.Is(err, ErrUnadopted) {
				t.Fatalf("implicit adoption: %v", err)
			}
			status, err := Status(t.Context(), config)
			if err != nil || status.LegacyMigrations != prefix {
				t.Fatalf("%+v %v", status, err)
			}
			// Keep the WAL connection open: the backup must include WAL-only data.
			result, err := Adopt(t.Context(), config, true)
			if err != nil {
				t.Fatal(err)
			}
			if result.AlreadyAdopted || result.BackupPath == "" {
				t.Fatalf("%+v", result)
			}
			info, err := os.Stat(result.BackupPath)
			if err != nil || info.Mode().Perm() != 0600 {
				t.Fatalf("backup permissions: %v %v", info, err)
			}
			backupConfig := Config{DatabasePath: result.BackupPath}
			oldStatus, err := Status(t.Context(), backupConfig)
			if err != nil || oldStatus.State != "legacy" || oldStatus.LegacyMigrations != prefix {
				t.Fatalf("backup not prior state: %+v %v", oldStatus, err)
			}
			backupHandle, err := openPath(t.Context(), result.BackupPath, "ro", false)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before, financialSnapshot(t, backupHandle)) {
				t.Fatal("backup lost committed WAL records")
			}
			backupHandle.Close()
			if !reflect.DeepEqual(before, financialSnapshot(t, handle)) {
				t.Fatal("rows, aggregates, password hashes or session versions changed")
			}
			afterCounts := tableCounts(t, handle)
			for table, count := range beforeCounts {
				if afterCounts[table] != count {
					t.Fatalf("%s row count changed: %d -> %d", table, count, afterCounts[table])
				}
			}
			if err := checkForeignKeys(t.Context(), handle); err != nil {
				t.Fatal(err)
			}
			status, err = Status(t.Context(), config)
			if err != nil || status.LegacyMigrations != len(migrations) || status.GooseVersion != 1 {
				t.Fatalf("%+v %v", status, err)
			}
			repeat, err := Adopt(t.Context(), config, true)
			if err != nil || !repeat.AlreadyAdopted || repeat.BackupPath != "" {
				t.Fatalf("idempotence: %+v %v", repeat, err)
			}
			if err := Migrate(t.Context(), config); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestAdoptRejectsUnknownStatesWithoutMutation(t *testing.T) {
	tests := map[string]string{
		"old hash tampering":              `UPDATE __drizzle_migrations SET hash='fictional-tamper' WHERE rowid=1`,
		"timestamp tampering":             `UPDATE __drizzle_migrations SET created_at=0 WHERE rowid=1`,
		"missing early history":           `DELETE FROM __drizzle_migrations WHERE rowid=1`,
		"missing schema-changing history": `DELETE FROM __drizzle_migrations WHERE rowid>=7`,
		"missing table":                   `DROP TABLE __drizzle_migrations`,
		"empty history":                   `DELETE FROM __drizzle_migrations`,
		"duplicate history":               `INSERT INTO __drizzle_migrations(hash,created_at) SELECT hash,created_at FROM __drizzle_migrations LIMIT 1`,
		"reordered history":               `CREATE TABLE history_copy AS SELECT hash,created_at FROM __drizzle_migrations; DELETE FROM __drizzle_migrations; INSERT INTO __drizzle_migrations(hash,created_at) SELECT hash,created_at FROM history_copy ORDER BY created_at DESC; DROP TABLE history_copy`,
		"unknown table":                   `CREATE TABLE unexpected(id INTEGER)`,
		"unknown view":                    `CREATE VIEW unexpected AS SELECT id FROM users`,
		"unknown trigger":                 `CREATE TRIGGER unexpected AFTER UPDATE ON users BEGIN SELECT 1; END`,
		"unknown index":                   `CREATE INDEX unexpected ON users(status)`,
		"bookkeeping index":               `CREATE INDEX unexpected ON __drizzle_migrations(hash)`,
		"column drift":                    `ALTER TABLE users ADD unexpected TEXT`,
		"missing index":                   `DROP INDEX users_username_unique`,
		"invalid FK":                      `PRAGMA foreign_keys=OFF; UPDATE accounts SET category_id='missing'; PRAGMA foreign_keys=ON`,
	}
	for name, mutation := range tests {
		t.Run(name, func(t *testing.T) {
			config := configFor(t)
			handle := fixture(t, config, 8)
			execute(t, handle, mutation)
			beforeSchema, err := schemaObjects(t.Context(), handle)
			if err != nil {
				t.Fatal(err)
			}
			beforeRows := financialSnapshot(t, handle)
			if _, err := Adopt(t.Context(), config, true); err == nil {
				t.Fatal("accepted unknown state")
			}
			afterSchema, err := schemaObjects(t.Context(), handle)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(beforeSchema, afterSchema) || !reflect.DeepEqual(beforeRows, financialSnapshot(t, handle)) {
				t.Fatal("rejection changed database")
			}
			if _, err := os.Stat(config.BackupPath); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("invalid state created backup: %v", err)
			}
		})
	}
}

func TestAdoptionRollbackBeforeCommit(t *testing.T) {
	for _, failure := range []string{"foreign key", "statement"} {
		t.Run(failure, func(t *testing.T) {
			config := configFor(t)
			handle := fixture(t, config, 1)
			beforeSchema, err := schemaObjects(t.Context(), handle)
			if err != nil {
				t.Fatal(err)
			}
			beforeRows := financialSnapshot(t, handle)
			migrations, err := legacyMigrations()
			if err != nil {
				t.Fatal(err)
			}
			if failure == "foreign key" {
				migrations[7].SQL += "\n--> statement-breakpoint\nUPDATE accounts SET category_id='missing';"
			} else {
				migrations[7].SQL += "\n--> statement-breakpoint\nINSERT INTO nonexistent VALUES(1);"
			}
			conn, err := handle.Conn(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			err = upgradeAndRecord(t.Context(), conn, migrations)
			if err == nil {
				t.Fatal("invalid upgrade committed")
			}
			if failure == "foreign key" && !errors.Is(err, ErrForeignKeys) {
				t.Fatal(err)
			}
			var enabled int
			if err := conn.QueryRowContext(t.Context(), "PRAGMA foreign_keys").Scan(&enabled); err != nil || enabled != 1 {
				t.Fatalf("FK not restored: %d %v", enabled, err)
			}
			conn.Close()
			afterSchema, err := schemaObjects(t.Context(), handle)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(beforeSchema, afterSchema) || !reflect.DeepEqual(beforeRows, financialSnapshot(t, handle)) {
				t.Fatal("upgrade did not roll back")
			}
			status, err := Status(t.Context(), config)
			if err != nil || status.LegacyMigrations != 1 {
				t.Fatalf("%+v %v", status, err)
			}
		})
	}
}

func TestStatusReadOnlyAndOfflineConfirmation(t *testing.T) {
	config := configFor(t)
	if _, err := Adopt(t.Context(), config, false); !errors.Is(err, ErrOffline) {
		t.Fatal(err)
	}
	status, err := Status(t.Context(), config)
	if err != nil || status.State != "missing" {
		t.Fatalf("%+v %v", status, err)
	}
	if _, err := os.Stat(config.DatabasePath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("status created database: %v", err)
	}
	file, err := os.Create(config.DatabasePath)
	if err != nil {
		t.Fatal(err)
	}
	file.Close()
	before, err := os.ReadFile(config.DatabasePath)
	if err != nil {
		t.Fatal(err)
	}
	status, err = Status(t.Context(), config)
	if err != nil || status.State != "empty" {
		t.Fatalf("%+v %v", status, err)
	}
	after, err := os.ReadFile(config.DatabasePath)
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatalf("status mutated empty file: %v", err)
	}
	if _, err := Adopt(t.Context(), config, true); err == nil {
		t.Fatal("adopted empty DB")
	}
}

func TestNonemptyMigrateAndStatusDoNotWrite(t *testing.T) {
	for _, statement := range []string{
		`CREATE TABLE unknown(id INTEGER)`,
		`CREATE VIEW unknown AS SELECT 1`,
		drizzleTableSQL,
	} {
		t.Run(statement, func(t *testing.T) {
			config := configFor(t)
			handle, err := Open(t.Context(), config.DatabasePath)
			if err != nil {
				t.Fatal(err)
			}
			execute(t, handle, statement)
			handle.Close()
			before, err := os.ReadFile(config.DatabasePath)
			if err != nil {
				t.Fatal(err)
			}
			if err := Migrate(t.Context(), config); err == nil {
				t.Fatal("migrated unknown nonempty database")
			}
			if _, err := Status(t.Context(), config); err == nil {
				t.Fatal("reported unknown nonempty database as compatible")
			}
			after, err := os.ReadFile(config.DatabasePath)
			if err != nil || !reflect.DeepEqual(before, after) {
				t.Fatalf("database changed: %v", err)
			}
		})
	}
	config := configFor(t)
	handle := fixture(t, config, 3)
	handle.Close()
	before, err := os.ReadFile(config.DatabasePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Status(t.Context(), config); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(config.DatabasePath)
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatalf("legacy status wrote to database: %v", err)
	}
}

func TestUnsupportedGooseAndHistorySchema(t *testing.T) {
	for _, mutation := range []string{
		`INSERT INTO goose_db_version(version_id,is_applied) VALUES(2,1)`,
		`DELETE FROM goose_db_version WHERE version_id=1`,
		`UPDATE goose_db_version SET is_applied=0 WHERE version_id=1`,
		`INSERT INTO goose_db_version(version_id,is_applied) VALUES(1,1)`,
	} {
		t.Run(mutation, func(t *testing.T) {
			config := configFor(t)
			if err := Migrate(t.Context(), config); err != nil {
				t.Fatal(err)
			}
			handle, err := Open(t.Context(), config.DatabasePath)
			if err != nil {
				t.Fatal(err)
			}
			defer handle.Close()
			execute(t, handle, mutation)
			if _, err := Status(t.Context(), config); !errors.Is(err, ErrHistory) {
				t.Fatal(err)
			}
			if err := Migrate(t.Context(), config); !errors.Is(err, ErrHistory) {
				t.Fatal(err)
			}
			if _, err := Adopt(t.Context(), config, true); !errors.Is(err, ErrHistory) {
				t.Fatal(err)
			}
		})
	}
	config := configFor(t)
	handle := fixture(t, config, 8)
	execute(t, handle, `ALTER TABLE __drizzle_migrations RENAME TO old_history`)
	execute(t, handle, drizzleFixtureTableSQL)
	execute(t, handle, `INSERT INTO __drizzle_migrations(hash,created_at) SELECT hash,created_at FROM old_history ORDER BY rowid; DROP TABLE old_history`)
	if _, err := Adopt(t.Context(), config, true); err != nil {
		t.Fatal(err)
	}
}

func TestConnectionAndConfiguration(t *testing.T) {
	t.Setenv("DATABASE_PATH", "")
	t.Setenv("BACKUP_PATH", "")
	if got := ConfigFromEnv(); got.DatabasePath != "./data/wealthboard.db" || got.BackupPath != "./backups" {
		t.Fatal(got)
	}
	config := configFor(t)
	t.Setenv("DATABASE_PATH", config.DatabasePath)
	t.Setenv("BACKUP_PATH", config.BackupPath)
	if got := ConfigFromEnv(); got != config {
		t.Fatal(got)
	}
	handle, err := Open(t.Context(), config.DatabasePath)
	if err != nil {
		t.Fatal(err)
	}
	defer handle.Close()
	for _, pragma := range []struct{ name, value string }{{"journal_mode", "wal"}, {"foreign_keys", "1"}, {"busy_timeout", "5000"}} {
		var got string
		if err := handle.QueryRow("PRAGMA " + pragma.name).Scan(&got); err != nil || got != pragma.value {
			t.Fatalf("%s=%s %v", pragma.name, got, err)
		}
	}
	if handle.Stats().MaxOpenConnections != 1 {
		t.Fatal("unbounded SQLite pool")
	}
	execute(t, handle, `CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(id INTEGER REFERENCES parent(id))`)
	if _, err := handle.Exec("INSERT INTO child VALUES(2)"); err == nil {
		t.Fatal("foreign keys disabled")
	}
	handle.SetMaxIdleConns(0)
	var enabled int
	if err := handle.QueryRow("PRAGMA foreign_keys").Scan(&enabled); err != nil || enabled != 1 {
		t.Fatalf("replacement connection lost FK: %d %v", enabled, err)
	}
}

func TestOriginalDrizzleRunnerReadsAdoptedDatabase(t *testing.T) {
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "node_modules/better-sqlite3")); err != nil {
		t.Skip("Next.js dependencies not installed")
	}
	config := configFor(t)
	handle := fixture(t, config, 1)
	before := financialSnapshot(t, handle)
	if _, err := Adopt(t.Context(), config, true); err != nil {
		t.Fatal(err)
	}
	path, err := filepath.Abs(config.DatabasePath)
	if err != nil {
		t.Fatal(err)
	}
	command := exec.CommandContext(t.Context(), "node", "scripts/migrate.mjs")
	command.Dir = root
	command.Env = append(os.Environ(), "DATABASE_PATH="+path)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("legacy runner: %v\n%s", err, output)
	}
	if !reflect.DeepEqual(before, financialSnapshot(t, handle)) {
		t.Fatal("legacy runner changed records")
	}
	status, err := Status(t.Context(), config)
	if err != nil || status.GooseVersion != 1 {
		t.Fatalf("%+v %v", status, err)
	}
}

func TestLegacyDataTransformations(t *testing.T) {
	t.Run("institutions", func(t *testing.T) {
		config := configFor(t)
		handle := fixture(t, config, 1)
		execute(t, handle, `UPDATE accounts SET institution='  Fictional   Bank  '`)
		if _, err := Adopt(t.Context(), config, true); err != nil {
			t.Fatal(err)
		}
		var count int
		if err := handle.QueryRow(`SELECT count(*) FROM accounts a JOIN institutions i
			ON i.id=a.institution_id AND i.user_id=a.user_id WHERE i.normalized_name='fictional bank'`).Scan(&count); err != nil || count != 2 {
			t.Fatalf("institution mapping %d %v", count, err)
		}
		if err := handle.QueryRow(`SELECT count(*) FROM categories WHERE is_liquid=1`).Scan(&count); err != nil || count != 2 {
			t.Fatalf("fixed income upgrade %d %v", count, err)
		}
	})
	t.Run("positions and OIDC", func(t *testing.T) {
		config := configFor(t)
		handle := fixture(t, config, 6)
		execute(t, handle, `UPDATE users SET password_hash=NULL WHERE id='user-b';
			INSERT INTO oidc_identities(id,user_id,issuer,subject,created_at,updated_at,last_login_at)
			VALUES('fictional-identity','user-b','https://identity.example.test','fictional-subject','2026-01-01','2026-01-01','2026-01-01');
			UPDATE accounts SET tracking_mode='positions' WHERE id='account-user-a';
			INSERT INTO investment_instruments(id,user_id,name,identifier_type,identifier,asset_type,quote_currency,created_at,updated_at)
			VALUES('fictional-instrument','user-a','Fictional fund','custom','fictional','fund','USD','2026-01-01','2026-01-01');
			INSERT INTO position_events(id,user_id,account_id,instrument_id,type,quantity,trade_currency,trade_date,created_at,updated_at)
			VALUES('z-opening','user-a','account-user-a','fictional-instrument','opening_position','5.123456789','USD','2026-01-01','2026-01-01T12:00:00','2026-01-01'),
			('a-sell','user-a','account-user-a','fictional-instrument','sell','2.123456789','USD','2026-01-01','2026-01-01T12:00:01','2026-01-01')`)
		if _, err := Adopt(t.Context(), config, true); err != nil {
			t.Fatal(err)
		}
		rows, err := handle.Query(`SELECT id,quantity,event_sequence FROM position_events ORDER BY event_sequence`)
		if err != nil {
			t.Fatal(err)
		}
		var got []string
		for rows.Next() {
			var id, quantity string
			var sequence int
			if err := rows.Scan(&id, &quantity, &sequence); err != nil {
				t.Fatal(err)
			}
			got = append(got, fmt.Sprint(id, "/", quantity, "/", sequence))
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		rows.Close()
		if !reflect.DeepEqual(got, []string{"z-opening/5.123456789/1", "a-sell/2.123456789/2"}) {
			t.Fatal(got)
		}
		var count int
		if err := handle.QueryRow(`SELECT count(*) FROM oidc_identities i JOIN users u ON u.id=i.user_id
			WHERE i.issuer='https://identity.example.test' AND i.subject='fictional-subject' AND u.password_hash IS NULL AND u.session_version=7`).Scan(&count); err != nil || count != 1 {
			t.Fatalf("OIDC preservation %d %v", count, err)
		}
	})
}

func TestBackupFailureAndUniqueSnapshots(t *testing.T) {
	config := configFor(t)
	handle := fixture(t, config, 1)
	before := financialSnapshot(t, handle)
	if err := os.WriteFile(config.BackupPath, []byte("not a directory"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Adopt(t.Context(), config, true); err == nil {
		t.Fatal("adopted without backup")
	}
	status, err := Status(t.Context(), config)
	if err != nil || status.LegacyMigrations != 1 || !reflect.DeepEqual(before, financialSnapshot(t, handle)) {
		t.Fatalf("backup failure mutated DB: %+v %v", status, err)
	}
	if err := os.Remove(config.BackupPath); err != nil {
		t.Fatal(err)
	}
	conn, err := handle.Conn(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	first, err := backup(t.Context(), conn, config.BackupPath)
	if err != nil {
		t.Fatal(err)
	}
	second, err := backup(t.Context(), conn, config.BackupPath)
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatal("backup overwritten")
	}
	for _, path := range []string{first, second} {
		status, err := Status(t.Context(), Config{DatabasePath: path})
		if err != nil || status.LegacyMigrations != 1 {
			t.Fatalf("%+v %v", status, err)
		}
	}
}

func TestOperatorErrorsHideDatabaseDetails(t *testing.T) {
	if got := OperatorError(errors.New("fictional-private-value in SQL")); strings.Contains(got, "fictional-private-value") {
		t.Fatal(got)
	}
	for _, err := range []error{ErrOffline, ErrUnadopted, ErrHistory, ErrSchema, ErrForeignKeys} {
		if OperatorError(fmt.Errorf("context: %w", err)) != err.Error() {
			t.Fatal(err)
		}
	}
}

func TestSchemaLiteralWhitespaceIsSignificant(t *testing.T) {
	if normalizeSQL("DEFAULT 'a b'") == normalizeSQL("DEFAULT 'ab'") {
		t.Fatal("literal normalization erased data")
	}
	if normalizeSQL("CREATE TABLE `users` (id INTEGER)") != normalizeSQL("CREATE TABLE \"users\" (\n id integer\n)") {
		t.Fatal("identifier formatting is significant")
	}
}
