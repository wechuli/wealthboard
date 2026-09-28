package service

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestPortabilityPostgreSQLVersionsIsolationAndRollback(t *testing.T) {
	db := openServiceTestDatabase(t)
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

	for version := 2; version <= CurrentUserArchiveVersion; version++ {
		t.Run(fmt.Sprintf("restore_v%d", version), func(t *testing.T) {
			archiveJSON := representativeArchiveJSON(t, version)
			summary, err := portability.RestoreJSON(ctx, ownerID, archiveJSON)
			if err != nil {
				t.Fatalf("restore v%d: %v", version, err)
			}
			wantEstate, wantInvestments := 0, 0
			if version >= 6 {
				wantEstate = 1
			}
			if version >= 7 {
				wantInvestments = 1
			}
			if summary.Accounts != 3 || summary.Transactions != 2 || summary.EstatePlans != wantEstate || summary.InvestmentInstruments != wantInvestments || summary.PositionEvents != wantInvestments {
				t.Fatalf("v%d restore summary=%+v", version, summary)
			}

			var balanceAccountID, goalAccountID, institutionID, accountInstitutionID uuid.UUID
			var balance int64
			if err := db.QueryRowContext(ctx, `SELECT id,current_value_minor,institution_id FROM accounts WHERE user_id=$1 AND name='Everyday Cash'`, ownerID).Scan(&balanceAccountID, &balance, &accountInstitutionID); err != nil {
				t.Fatalf("read v%d balance account: %v", version, err)
			}
			if err := db.QueryRowContext(ctx, `SELECT linked_account_id FROM goals WHERE user_id=$1 AND name='Reserve'`, ownerID).Scan(&goalAccountID); err != nil {
				t.Fatalf("read v%d goal relationship: %v", version, err)
			}
			if err := db.QueryRowContext(ctx, `SELECT id FROM institutions WHERE user_id=$1 AND name='Example Bank'`, ownerID).Scan(&institutionID); err != nil {
				t.Fatalf("read v%d institution: %v", version, err)
			}
			if balance != 1250 || goalAccountID != balanceAccountID || accountInstitutionID != institutionID {
				t.Fatalf("v%d balance=%d account=%s goalAccount=%s institution=%s accountInstitution=%s", version, balance, balanceAccountID, goalAccountID, institutionID, accountInstitutionID)
			}

			assertPortabilityVersionAdditions(t, ctx, db, ownerID, version, balanceAccountID)
			if err := db.QueryRowContext(ctx, `SELECT current_value_minor FROM accounts WHERE user_id=$1 AND id=$2`, otherID, otherAccountID).Scan(&otherValue); err != nil || otherValue != 777 {
				t.Fatalf("v%d changed other user value=%d err=%v", version, otherValue, err)
			}

			broken := duplicateRepresentativeCategoryJSON(t, version)
			if _, err := portability.RestoreJSON(ctx, ownerID, broken); err == nil {
				t.Fatalf("v%d duplicate-category restore succeeded", version)
			}
			var afterRollbackID uuid.UUID
			var afterRollbackBalance int64
			if err := db.QueryRowContext(ctx, `SELECT id,current_value_minor FROM accounts WHERE user_id=$1 AND name='Everyday Cash'`, ownerID).Scan(&afterRollbackID, &afterRollbackBalance); err != nil || afterRollbackID != balanceAccountID || afterRollbackBalance != 1250 {
				t.Fatalf("v%d rollback account=%s balance=%d err=%v", version, afterRollbackID, afterRollbackBalance, err)
			}
		})
	}
}

func assertPortabilityVersionAdditions(t *testing.T, ctx context.Context, db *sql.DB, ownerID uuid.UUID, version int, balanceAccountID uuid.UUID) {
	t.Helper()
	wantEstate, wantInvestments, wantConversions := 0, 0, 0
	if version >= 6 {
		wantEstate = 1
	}
	if version >= 7 {
		wantInvestments = 1
	}
	if version == 8 {
		wantConversions = 1
	}
	var estateCount, investmentCount, conversionCount int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM estate_plans WHERE user_id=$1`, ownerID).Scan(&estateCount); err != nil {
		t.Fatalf("count v%d estate plans: %v", version, err)
	}
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM investment_instruments WHERE user_id=$1`, ownerID).Scan(&investmentCount); err != nil {
		t.Fatalf("count v%d investments: %v", version, err)
	}
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM account_conversions WHERE user_id=$1`, ownerID).Scan(&conversionCount); err != nil {
		t.Fatalf("count v%d conversions: %v", version, err)
	}
	if estateCount != wantEstate || investmentCount != wantInvestments || conversionCount != wantConversions {
		t.Fatalf("v%d additions estate=%d investments=%d conversions=%d", version, estateCount, investmentCount, conversionCount)
	}
	if version >= 6 {
		var directiveAccountID uuid.UUID
		if err := db.QueryRowContext(ctx, `SELECT account_id FROM estate_account_directives WHERE user_id=$1`, ownerID).Scan(&directiveAccountID); err != nil || directiveAccountID != balanceAccountID {
			t.Fatalf("v%d estate account=%s want=%s err=%v", version, directiveAccountID, balanceAccountID, err)
		}
	}
	if version >= 7 {
		var positionAccountID, eventAccountID, eventInstrumentID, instrumentID uuid.UUID
		var positionValue int64
		var quantity string
		if err := db.QueryRowContext(ctx, `SELECT id,current_value_minor FROM accounts WHERE user_id=$1 AND name='Brokerage'`, ownerID).Scan(&positionAccountID, &positionValue); err != nil {
			t.Fatalf("read v%d position account: %v", version, err)
		}
		if err := db.QueryRowContext(ctx, `SELECT account_id,instrument_id,quantity::text FROM position_events WHERE user_id=$1`, ownerID).Scan(&eventAccountID, &eventInstrumentID, &quantity); err != nil {
			t.Fatalf("read v%d position event: %v", version, err)
		}
		if err := db.QueryRowContext(ctx, `SELECT id FROM investment_instruments WHERE user_id=$1`, ownerID).Scan(&instrumentID); err != nil {
			t.Fatalf("read v%d instrument: %v", version, err)
		}
		if positionValue != 25000 || quantity != "2" || eventAccountID != positionAccountID || eventInstrumentID != instrumentID {
			t.Fatalf("v%d position value=%d quantity=%s account=%s eventAccount=%s instrument=%s eventInstrument=%s", version, positionValue, quantity, positionAccountID, eventAccountID, instrumentID, eventInstrumentID)
		}
	}
	var stockDays, fundDays int
	if err := db.QueryRowContext(ctx, `SELECT position_stale_days_stock,position_stale_days_fund FROM user_settings WHERE user_id=$1`, ownerID).Scan(&stockDays, &fundDays); err != nil {
		t.Fatalf("read v%d stale-price settings: %v", version, err)
	}
	wantStockDays, wantFundDays := 7, 31
	if version == 8 {
		wantStockDays, wantFundDays = 14, 45
	}
	if stockDays != wantStockDays || fundDays != wantFundDays {
		t.Fatalf("v%d stale-price settings=%d/%d want=%d/%d", version, stockDays, fundDays, wantStockDays, wantFundDays)
	}
}

func duplicateRepresentativeCategoryJSON(t *testing.T, version int) []byte {
	t.Helper()
	decoder := json.NewDecoder(strings.NewReader(string(representativeArchiveJSON(t, version))))
	decoder.UseNumber()
	var raw map[string]any
	if err := decoder.Decode(&raw); err != nil {
		t.Fatalf("decode representative v%d archive: %v", version, err)
	}
	categories := raw["categories"].([]any)
	duplicate := map[string]any{}
	for key, value := range categories[0].(map[string]any) {
		duplicate[key] = value
	}
	duplicate["id"] = "duplicate-category"
	raw["categories"] = append(categories, duplicate)
	data, err := json.Marshal(raw)
	if err != nil {
		t.Fatalf("marshal invalid v%d archive: %v", version, err)
	}
	return data
}

func TestEstateMutationsPostgreSQLSnapshotImmutabilityHashAndIsolation(t *testing.T) {
	db := openServiceTestDatabase(t)
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
	firstDirective, err := estate.UpsertDirective(ctx, ownerID, accountID, EstateDirectiveInput{IsIncluded: true, OwnershipShareBPS: 10000, TransferContext: "estate", DistributionMethod: "sell_and_divide"})
	if err != nil || firstDirective.ID == uuid.Nil {
		t.Fatalf("upsert first directive with default plan: result=%+v err=%v", firstDirective, err)
	}
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
