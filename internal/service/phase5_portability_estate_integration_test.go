package service

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestPortabilityPostgreSQLVersionsIsolationAndRollback(t *testing.T) {
	db := openPhase5TestDatabase(t)
	ctx := context.Background()
	ownerID, otherID := uuid.New(), uuid.New()
	ownerSettingsID, otherSettingsID := uuid.New(), uuid.New()
	ownerCategoryID, otherCategoryID := uuid.New(), uuid.New()
	ownerAccountID, otherAccountID := uuid.New(), uuid.New()
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users (id,username,password_hash,created_at,updated_at) VALUES ($1,$2,'never-export-this-password',now(),now())`, []any{ownerID, "portable-owner-" + ownerID.String()}},
		{`INSERT INTO users (id,username,created_at,updated_at) VALUES ($1,$2,now(),now())`, []any{otherID, "portable-other-" + otherID.String()}},
		{`INSERT INTO user_settings (id,user_id,display_name,base_currency,supported_currencies,timezone,created_at,updated_at) VALUES ($1,$2,'Owner','KES','["KES"]','UTC',now(),now())`, []any{ownerSettingsID, ownerID}},
		{`INSERT INTO user_settings (id,user_id,display_name,base_currency,supported_currencies,timezone,created_at,updated_at) VALUES ($1,$2,'Other','KES','["KES"]','UTC',now(),now())`, []any{otherSettingsID, otherID}},
		{`INSERT INTO categories (id,user_id,name,slug,asset_or_liability,created_at,updated_at) VALUES ($1,$2,'Cash',$3,'asset',now(),now())`, []any{ownerCategoryID, ownerID, "cash-" + ownerCategoryID.String()}},
		{`INSERT INTO categories (id,user_id,name,slug,asset_or_liability,created_at,updated_at) VALUES ($1,$2,'Other Cash',$3,'asset',now(),now())`, []any{otherCategoryID, otherID, "cash-" + otherCategoryID.String()}},
		{`INSERT INTO accounts (id,user_id,name,category_id,currency,current_value_minor,created_at,updated_at) VALUES ($1,$2,'Owner Wallet',$3,'KES',0,now(),now())`, []any{ownerAccountID, ownerID, ownerCategoryID}},
		{`INSERT INTO accounts (id,user_id,name,category_id,currency,current_value_minor,created_at,updated_at) VALUES ($1,$2,'Other Wallet',$3,'KES',777,now(),now())`, []any{otherAccountID, otherID, otherCategoryID}},
		{`INSERT INTO transactions (id,user_id,account_id,type,amount_minor,currency,transaction_date,created_at,updated_at) VALUES ($1,$2,$3,'opening_balance',1250,'KES','2026-01-01',now(),now())`, []any{uuid.New(), ownerID, ownerAccountID}},
		{`INSERT INTO oidc_identities (id,user_id,issuer,subject,created_at,updated_at,last_login_at) VALUES ($1,$2,'https://issuer.example','private-subject',now(),now(),now())`, []any{uuid.New(), ownerID}},
		{`INSERT INTO api_keys (id,user_id,name,display_prefix,token_hash,created_at) VALUES ($1,$2,'private','wb_private',decode('deadbeef','hex'),now())`, []any{uuid.New(), ownerID}},
		{`INSERT INTO ai_provider_settings (id,user_id,provider,base_url,model,encrypted_api_key,created_at,updated_at) VALUES ($1,$2,'openai','https://api.openai.com','model','never-export-this-ai-key',now(),now())`, []any{uuid.New(), ownerID}},
	} {
		if _, err := db.ExecContext(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed portability integration test: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id=ANY($1)`, []uuid.UUID{ownerID, otherID})
	})

	portability := NewPortabilityService(db)
	portability.now = func() time.Time { return time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC) }
	v8, err := portability.ExportJSON(ctx, ownerID)
	if err != nil {
		t.Fatalf("export v8: %v", err)
	}
	for _, forbidden := range []string{"never-export-this-password", "private-subject", "wb_private", "never-export-this-ai-key", "passwordHash", "oidcIdentities", "apiKeys", "aiCredentials"} {
		if strings.Contains(string(v8), forbidden) {
			t.Fatalf("export contains forbidden value %q", forbidden)
		}
	}
	var exported UserArchive
	if err := json.Unmarshal(v8, &exported); err != nil || exported.Version != 8 || len(exported.Accounts) != 1 || len(exported.Transactions) != 1 {
		t.Fatalf("exported archive=%+v err=%v", exported, err)
	}

	if _, err := db.ExecContext(ctx, `INSERT INTO accounts (id,user_id,name,category_id,currency,created_at,updated_at) VALUES ($1,$2,'Replace Me',$3,'KES',now(),now())`, uuid.New(), ownerID, ownerCategoryID); err != nil {
		t.Fatalf("seed replace-only account: %v", err)
	}
	summary, err := portability.RestoreJSON(ctx, ownerID, v8)
	if err != nil || summary.Accounts != 1 || summary.Transactions != 1 {
		t.Fatalf("restore v8 summary=%+v err=%v", summary, err)
	}
	var restoredAccountID uuid.UUID
	var restoredBalance int64
	if err := db.QueryRowContext(ctx, `SELECT id,current_value_minor FROM accounts WHERE user_id=$1`, ownerID).Scan(&restoredAccountID, &restoredBalance); err != nil {
		t.Fatalf("read restored account: %v", err)
	}
	if restoredAccountID == ownerAccountID || restoredBalance != 1250 {
		t.Fatalf("restored account=%s balance=%d", restoredAccountID, restoredBalance)
	}
	var preservedSettingsID uuid.UUID
	if err := db.QueryRowContext(ctx, `SELECT id FROM user_settings WHERE user_id=$1`, ownerID).Scan(&preservedSettingsID); err != nil || preservedSettingsID != ownerSettingsID {
		t.Fatalf("settings identity=%s err=%v", preservedSettingsID, err)
	}
	var otherValue int64
	if err := db.QueryRowContext(ctx, `SELECT current_value_minor FROM accounts WHERE user_id=$1 AND id=$2`, otherID, otherAccountID).Scan(&otherValue); err != nil || otherValue != 777 {
		t.Fatalf("other user account value=%d err=%v", otherValue, err)
	}

	rollbackArchive, err := portability.Export(ctx, ownerID)
	if err != nil {
		t.Fatalf("export rollback archive: %v", err)
	}
	duplicate := map[string]any{}
	for key, value := range rollbackArchive.Categories[0] {
		duplicate[key] = value
	}
	duplicate["id"] = uuid.NewString()
	rollbackArchive.Categories = append(rollbackArchive.Categories, duplicate)
	rollbackJSON, _ := json.Marshal(rollbackArchive)
	if _, err := portability.RestoreJSON(ctx, ownerID, rollbackJSON); err == nil {
		t.Fatal("duplicate category restore succeeded, want transaction rollback")
	}
	var count int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM accounts WHERE user_id=$1`, ownerID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("rollback account count=%d err=%v", count, err)
	}

	cleanV8, err := portability.Export(ctx, ownerID)
	if err != nil {
		t.Fatalf("export clean v2 source: %v", err)
	}
	v2 := archiveV8ToV2(t, cleanV8)
	if _, err := portability.RestoreJSON(ctx, ownerID, v2); err != nil {
		t.Fatalf("restore v2: %v", err)
	}
	var mode string
	if err := db.QueryRowContext(ctx, `SELECT tracking_mode FROM accounts WHERE user_id=$1`, ownerID).Scan(&mode); err != nil || mode != "balance" {
		t.Fatalf("v2 restored mode=%s err=%v", mode, err)
	}
}

func TestEstateMutationsPostgreSQLSnapshotImmutabilityHashAndIsolation(t *testing.T) {
	db := openPhase5TestDatabase(t)
	ctx := context.Background()
	ownerID, otherID := uuid.New(), uuid.New()
	categoryID, otherCategoryID, accountID := uuid.New(), uuid.New(), uuid.New()
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users (id,username,created_at,updated_at) VALUES ($1,$2,now(),now())`, []any{ownerID, "estate-owner-" + ownerID.String()}},
		{`INSERT INTO users (id,username,created_at,updated_at) VALUES ($1,$2,now(),now())`, []any{otherID, "estate-other-" + otherID.String()}},
		{`INSERT INTO user_settings (id,user_id,display_name,base_currency,supported_currencies,timezone,created_at,updated_at) VALUES ($1,$2,'Owner','KES','["KES"]','Africa/Nairobi',now(),now())`, []any{uuid.New(), ownerID}},
		{`INSERT INTO user_settings (id,user_id,display_name,base_currency,supported_currencies,timezone,created_at,updated_at) VALUES ($1,$2,'Other','KES','["KES"]','UTC',now(),now())`, []any{uuid.New(), otherID}},
		{`INSERT INTO categories (id,user_id,name,slug,asset_or_liability,created_at,updated_at) VALUES ($1,$2,'Property',$3,'asset',now(),now())`, []any{categoryID, ownerID, "property-" + categoryID.String()}},
		{`INSERT INTO categories (id,user_id,name,slug,asset_or_liability,created_at,updated_at) VALUES ($1,$2,'Other',$3,'asset',now(),now())`, []any{otherCategoryID, otherID, "other-" + otherCategoryID.String()}},
		{`INSERT INTO accounts (id,user_id,name,category_id,currency,current_value_minor,created_at,updated_at) VALUES ($1,$2,'Home',$3,'KES',500000,now(),now())`, []any{accountID, ownerID, categoryID}},
	} {
		if _, err := db.ExecContext(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed estate integration test: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id=ANY($1)`, []uuid.UUID{ownerID, otherID})
	})

	estate := NewEstateMutations(db)
	estate.now = func() time.Time { return time.Date(2026, 9, 20, 21, 30, 0, 0, time.UTC) }
	plan, err := estate.UpdatePlan(ctx, ownerID, EstatePlanInput{Title: "Family plan", Jurisdiction: "Kenya"})
	if err != nil {
		t.Fatalf("update plan: %v", err)
	}
	beneficiary, err := estate.CreateBeneficiary(ctx, ownerID, BeneficiaryInput{Kind: "person", Name: "Alex", Relationship: "Child"})
	if err != nil {
		t.Fatalf("create beneficiary: %v", err)
	}
	directive, err := estate.UpsertDirective(ctx, ownerID, accountID, EstateDirectiveInput{IsIncluded: true, OwnershipShareBPS: 10000, TransferContext: "estate", DistributionMethod: "sell_and_divide"})
	if err != nil {
		t.Fatalf("upsert directive: %v", err)
	}
	if _, err := estate.UpsertAllocation(ctx, ownerID, directive.ID, EstateAllocationInput{BeneficiaryID: beneficiary.ID, Tier: "primary", AllocationBPS: 10000}); err != nil {
		t.Fatalf("upsert allocation: %v", err)
	}
	snapshot, err := estate.CreateSnapshot(ctx, ownerID)
	if err != nil {
		t.Fatalf("create snapshot: %v", err)
	}
	actual := sha256.Sum256(snapshot.Content)
	if snapshot.EstatePlanID != plan.ID || snapshot.ContentHash != hex.EncodeToString(actual[:]) || !strings.Contains(string(snapshot.Content), `"name":"Alex"`) {
		t.Fatalf("snapshot=%+v content=%s", snapshot.EstateSnapshotMeta, snapshot.Content)
	}
	originalContent, originalHash := string(snapshot.Content), snapshot.ContentHash
	if err := estate.UpdateBeneficiary(ctx, ownerID, beneficiary.ID, BeneficiaryInput{Kind: "person", Name: "Changed"}); err != nil {
		t.Fatalf("update beneficiary: %v", err)
	}
	if _, err := estate.UpdatePlan(ctx, ownerID, EstatePlanInput{Title: "Changed plan"}); err != nil {
		t.Fatalf("update plan after snapshot: %v", err)
	}
	var storedContent, storedHash string
	if err := db.QueryRowContext(ctx, `SELECT content,content_hash FROM estate_plan_snapshots WHERE user_id=$1 AND id=$2`, ownerID, snapshot.ID).Scan(&storedContent, &storedHash); err != nil {
		t.Fatalf("read immutable snapshot: %v", err)
	}
	if storedContent != originalContent || storedHash != originalHash {
		t.Fatal("snapshot changed after live estate mutations")
	}
	if err := estate.DeleteSnapshot(ctx, otherID, snapshot.ID); !errors.Is(err, ErrEstateNotFound) {
		t.Fatalf("foreign delete error=%v", err)
	}
	if err := estate.DeleteSnapshot(ctx, ownerID, snapshot.ID); err != nil {
		t.Fatalf("delete owner snapshot: %v", err)
	}
}

func openPhase5TestDatabase(t *testing.T) *sql.DB {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open PostgreSQL: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func archiveV8ToV2(t *testing.T, archive UserArchive) []byte {
	t.Helper()
	data, err := json.Marshal(archive)
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.UseNumber()
	if err := decoder.Decode(&raw); err != nil {
		t.Fatal(err)
	}
	raw["version"] = json.Number("2")
	settings := raw["settings"].(map[string]any)
	delete(settings, "positionStaleDaysStock")
	delete(settings, "positionStaleDaysEtf")
	delete(settings, "positionStaleDaysFund")
	for _, account := range objectRows(raw["accounts"]) {
		delete(account, "trackingMode")
		delete(account, "institutionId")
		account["institution"] = nil
	}
	for _, transaction := range objectRows(raw["transactions"]) {
		delete(transaction, "externalId")
		delete(transaction, "eventGroupId")
	}
	for _, key := range []string{"institutions", "goalMilestones", "goalAlertDismissals", "beneficiaries", "estatePlans", "estateAccountDirectives", "estateAllocations", "estateResiduaryAllocations", "estatePlanSnapshots", "investmentInstruments", "positionEvents", "securityPrices", "positionReconciliations", "accountConversions"} {
		delete(raw, key)
	}
	result, err := json.Marshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	return result
}
