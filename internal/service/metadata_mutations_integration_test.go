package service

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestMetadataMutationsAreOwnerScopedAndEnforceInvariants(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open PostgreSQL: %v", err)
	}
	defer db.Close()
	ctx := context.Background()
	ownerID, otherID := uuid.New(), uuid.New()
	for _, userID := range []uuid.UUID{ownerID, otherID} {
		if _, err := db.ExecContext(ctx, `INSERT INTO users (id,username,created_at,updated_at) VALUES ($1,$2,now(),now())`, userID, "metadata-"+userID.String()); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO user_settings (id,user_id,display_name,supported_currencies,created_at,updated_at) VALUES ($1,$2,'Owner','["KES","USD"]',now(),now())`, uuid.New(), userID); err != nil {
			t.Fatalf("seed settings: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = ANY($1)`, []uuid.UUID{ownerID, otherID})
	})

	mutations := NewMetadataMutations(db)
	mutations.now = func() time.Time { return time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC) }
	category, err := mutations.CreateCategory(ctx, ownerID, CategoryInput{Name: "Real Estate", Icon: "Building", AssetOrLiability: "asset", IsInvestible: true})
	if err != nil {
		t.Fatalf("create category: %v", err)
	}
	if err := mutations.UpdateCategory(ctx, otherID, category.ID, CategoryInput{Name: "Stolen", Icon: "Circle", AssetOrLiability: "asset"}); metadataErrorKind(err) != MetadataNotFound {
		t.Fatalf("cross-owner category update error = %v, want not found", err)
	}
	var ownerName string
	if err := db.QueryRowContext(ctx, `SELECT name FROM categories WHERE user_id=$1 AND id=$2`, ownerID, category.ID).Scan(&ownerName); err != nil || ownerName != "Real Estate" {
		t.Fatalf("owner category changed: name=%q err=%v", ownerName, err)
	}

	systemID := uuid.New()
	if _, err := db.ExecContext(ctx, `INSERT INTO categories (id,user_id,name,slug,is_system,created_at,updated_at) VALUES ($1,$2,'System','system',TRUE,now(),now())`, systemID, ownerID); err != nil {
		t.Fatalf("seed system category: %v", err)
	}
	if err := mutations.ArchiveCategory(ctx, ownerID, systemID, true); metadataErrorKind(err) != MetadataConflict {
		t.Fatalf("archive system category error = %v, want conflict", err)
	}

	firstInstitution, err := mutations.CreateInstitution(ctx, ownerID, InstitutionInput{Name: " Acme   Bank ", Type: "bank", CountryCode: "ke"})
	if err != nil || firstInstitution.Name != "Acme Bank" {
		t.Fatalf("create institution = %+v, err=%v", firstInstitution, err)
	}
	if _, err := mutations.CreateInstitution(ctx, ownerID, InstitutionInput{Name: "acme bank", Type: "bank"}); metadataErrorKind(err) != MetadataConflict {
		t.Fatalf("duplicate institution error = %v, want conflict", err)
	}
	if _, err := mutations.CreateInstitution(ctx, otherID, InstitutionInput{Name: "ACME BANK", Type: "bank"}); err != nil {
		t.Fatalf("same institution name for another owner: %v", err)
	}

	rate, err := mutations.CreateExchangeRate(ctx, ownerID, ExchangeRateInput{BaseCurrency: "KES", QuoteCurrency: "USD", Rate: "0.00775", EffectiveDate: "2026-09-20"})
	if err != nil {
		t.Fatalf("create exchange rate: %v", err)
	}
	if err := mutations.DeleteExchangeRate(ctx, otherID, rate.ID); metadataErrorKind(err) != MetadataNotFound {
		t.Fatalf("cross-owner rate delete error = %v, want not found", err)
	}
	if err := mutations.DeleteExchangeRate(ctx, ownerID, rate.ID); err != nil {
		t.Fatalf("delete exchange rate: %v", err)
	}
}

func metadataErrorKind(err error) MetadataErrorKind {
	var metadataErr *MetadataError
	if errors.As(err, &metadataErr) {
		return metadataErr.Kind
	}
	return ""
}
