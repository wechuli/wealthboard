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
	"time"

	"github.com/google/uuid"
)

const fullEstateAllocationBPS = 10_000

var (
	ErrEstateNotFound   = errors.New("estate resource not found")
	ErrEstateValidation = errors.New("estate validation failed")
)

type EstateMutations struct {
	db  *sql.DB
	now func() time.Time
}

func NewEstateMutations(db *sql.DB) *EstateMutations {
	return &EstateMutations{db: db, now: time.Now}
}

type BeneficiaryInput struct {
	Kind           string `json:"kind"`
	Name           string `json:"name"`
	Relationship   string `json:"relationship"`
	ContactSummary string `json:"contactSummary"`
	Notes          string `json:"notes"`
}

type EstatePlanInput struct {
	Title              string  `json:"title"`
	Jurisdiction       string  `json:"jurisdiction"`
	LastReviewedDate   *string `json:"lastReviewedDate"`
	ReviewReminderDate *string `json:"reviewReminderDate"`
}

type EstateDirectiveInput struct {
	IsIncluded         bool    `json:"isIncluded"`
	OwnershipShareBPS  int32   `json:"ownershipShareBps"`
	TransferContext    string  `json:"transferContext"`
	DistributionMethod string  `json:"distributionMethod"`
	DocumentReference  string  `json:"documentReference"`
	Notes              string  `json:"notes"`
	ReviewedAt         *string `json:"reviewedAt"`
}

type EstateAllocationInput struct {
	BeneficiaryID uuid.UUID `json:"beneficiaryId"`
	Tier          string    `json:"tier"`
	AllocationBPS int32     `json:"allocationBps"`
	Notes         string    `json:"notes"`
}

type EstateMutationResult struct {
	ID uuid.UUID `json:"id"`
}

type EstateSnapshotResult struct {
	EstateSnapshot
}

func (service *EstateMutations) EnsurePlan(ctx context.Context, userID uuid.UUID) (EstatePlan, error) {
	var plan EstatePlan
	err := scanEstatePlan(service.db.QueryRowContext(ctx, `
SELECT id,title,jurisdiction,last_reviewed_date,review_reminder_date,created_at,updated_at
FROM estate_plans WHERE user_id=$1`, userID), &plan)
	if err == nil {
		return plan, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return EstatePlan{}, fmt.Errorf("load estate plan: %w", err)
	}
	now := service.now().UTC()
	plan.ID, plan.Title, plan.CreatedAt, plan.UpdatedAt = uuid.New(), "My estate plan", now, now
	_, err = service.db.ExecContext(ctx, `
INSERT INTO estate_plans (id,user_id,title,created_at,updated_at)
VALUES ($1,$2,$3,$4,$4)
ON CONFLICT (user_id) DO NOTHING`, plan.ID, userID, plan.Title, now)
	if err != nil {
		return EstatePlan{}, fmt.Errorf("create estate plan: %w", err)
	}
	if err := scanEstatePlan(service.db.QueryRowContext(ctx, `
SELECT id,title,jurisdiction,last_reviewed_date,review_reminder_date,created_at,updated_at
FROM estate_plans WHERE user_id=$1`, userID), &plan); err != nil {
		return EstatePlan{}, fmt.Errorf("load created estate plan: %w", err)
	}
	return plan, nil
}

func (service *EstateMutations) UpdatePlan(ctx context.Context, userID uuid.UUID, input EstatePlanInput) (EstatePlan, error) {
	title := strings.TrimSpace(input.Title)
	if title == "" || len(title) > 120 {
		return EstatePlan{}, estateValidation("enter an estate plan title")
	}
	jurisdiction, err := estateOptionalText(input.Jurisdiction, 120, "jurisdiction")
	if err != nil {
		return EstatePlan{}, err
	}
	reviewed, err := estateOptionalDate(input.LastReviewedDate, "lastReviewedDate")
	if err != nil {
		return EstatePlan{}, err
	}
	reminder, err := estateOptionalDate(input.ReviewReminderDate, "reviewReminderDate")
	if err != nil {
		return EstatePlan{}, err
	}
	plan, err := service.EnsurePlan(ctx, userID)
	if err != nil {
		return EstatePlan{}, err
	}
	_, err = service.db.ExecContext(ctx, `
UPDATE estate_plans SET title=$3,jurisdiction=$4,last_reviewed_date=$5,
review_reminder_date=$6,updated_at=$7 WHERE user_id=$1 AND id=$2`,
		userID, plan.ID, title, jurisdiction, reviewed, reminder, service.now().UTC())
	if err != nil {
		return EstatePlan{}, fmt.Errorf("update estate plan: %w", err)
	}
	return service.EnsurePlan(ctx, userID)
}

func (service *EstateMutations) CreateBeneficiary(ctx context.Context, userID uuid.UUID, input BeneficiaryInput) (EstateMutationResult, error) {
	prepared, err := prepareBeneficiary(input)
	if err != nil {
		return EstateMutationResult{}, err
	}
	id, now := uuid.New(), service.now().UTC()
	_, err = service.db.ExecContext(ctx, `
INSERT INTO beneficiaries (id,user_id,kind,name,relationship,contact_summary,notes,created_at,updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`, id, userID, prepared.Kind, prepared.Name,
		nullableTrimmed(prepared.Relationship), nullableTrimmed(prepared.ContactSummary), nullableTrimmed(prepared.Notes), now)
	if err != nil {
		return EstateMutationResult{}, fmt.Errorf("create beneficiary: %w", err)
	}
	return EstateMutationResult{ID: id}, nil
}

func (service *EstateMutations) UpdateBeneficiary(ctx context.Context, userID, beneficiaryID uuid.UUID, input BeneficiaryInput) error {
	prepared, err := prepareBeneficiary(input)
	if err != nil {
		return err
	}
	result, err := service.db.ExecContext(ctx, `
UPDATE beneficiaries SET kind=$3,name=$4,relationship=$5,contact_summary=$6,notes=$7,updated_at=$8
WHERE user_id=$1 AND id=$2`, userID, beneficiaryID, prepared.Kind, prepared.Name,
		nullableTrimmed(prepared.Relationship), nullableTrimmed(prepared.ContactSummary), nullableTrimmed(prepared.Notes), service.now().UTC())
	return estateMutationResult(result, err, "update beneficiary")
}

func (service *EstateMutations) SetBeneficiaryArchived(ctx context.Context, userID, beneficiaryID uuid.UUID, archived bool) error {
	var archivedAt any
	if archived {
		archivedAt = service.now().UTC()
	}
	result, err := service.db.ExecContext(ctx, `
UPDATE beneficiaries SET archived_at=$3,updated_at=$4 WHERE user_id=$1 AND id=$2`,
		userID, beneficiaryID, archivedAt, service.now().UTC())
	return estateMutationResult(result, err, "archive beneficiary")
}

func (service *EstateMutations) UpsertDirective(ctx context.Context, userID, accountID uuid.UUID, input EstateDirectiveInput) (EstateMutationResult, error) {
	if input.OwnershipShareBPS <= 0 || input.OwnershipShareBPS > fullEstateAllocationBPS {
		return EstateMutationResult{}, estateValidation("ownership share must be between 0.01% and 100%")
	}
	if !estateAllowed(input.TransferContext, "estate", "joint_survivorship", "provider_designation", "trust_entity", "unknown") {
		return EstateMutationResult{}, estateValidation("transfer context is invalid")
	}
	if !estateAllowed(input.DistributionMethod, "transfer_asset", "sell_and_divide", "cash_equivalent", "undecided") {
		return EstateMutationResult{}, estateValidation("distribution method is invalid")
	}
	document, err := estateOptionalText(input.DocumentReference, 300, "document reference")
	if err != nil {
		return EstateMutationResult{}, err
	}
	notes, err := estateOptionalText(input.Notes, 2000, "notes")
	if err != nil {
		return EstateMutationResult{}, err
	}
	reviewed, err := estateOptionalDate(input.ReviewedAt, "reviewedAt")
	if err != nil {
		return EstateMutationResult{}, err
	}
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return EstateMutationResult{}, fmt.Errorf("begin estate directive: %w", err)
	}
	defer tx.Rollback()
	plan, err := requireEstatePlan(ctx, tx, userID)
	if err != nil {
		return EstateMutationResult{}, err
	}
	var isLiability bool
	var archivedAt sql.NullTime
	if err := tx.QueryRowContext(ctx, `SELECT is_liability,archived_at FROM accounts WHERE user_id=$1 AND id=$2`, userID, accountID).Scan(&isLiability, &archivedAt); errors.Is(err, sql.ErrNoRows) || archivedAt.Valid {
		return EstateMutationResult{}, ErrEstateNotFound
	} else if err != nil {
		return EstateMutationResult{}, fmt.Errorf("load estate account: %w", err)
	}
	if isLiability {
		return EstateMutationResult{}, estateValidation("liabilities cannot be assigned to beneficiaries")
	}
	var id uuid.UUID
	err = tx.QueryRowContext(ctx, `SELECT id FROM estate_account_directives WHERE user_id=$1 AND estate_plan_id=$2 AND account_id=$3`, userID, plan.ID, accountID).Scan(&id)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return EstateMutationResult{}, fmt.Errorf("load estate directive: %w", err)
	}
	now := service.now().UTC()
	if errors.Is(err, sql.ErrNoRows) {
		id = uuid.New()
		_, err = tx.ExecContext(ctx, `
INSERT INTO estate_account_directives (id,user_id,estate_plan_id,account_id,is_included,ownership_share_bps,
transfer_context,distribution_method,document_reference,notes,reviewed_at,created_at,updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`, id, userID, plan.ID, accountID,
			input.IsIncluded, input.OwnershipShareBPS, input.TransferContext, input.DistributionMethod, document, notes, reviewed, now)
	} else {
		_, err = tx.ExecContext(ctx, `
UPDATE estate_account_directives SET is_included=$3,ownership_share_bps=$4,transfer_context=$5,
distribution_method=$6,document_reference=$7,notes=$8,reviewed_at=$9,updated_at=$10
WHERE user_id=$1 AND id=$2`, userID, id, input.IsIncluded, input.OwnershipShareBPS,
			input.TransferContext, input.DistributionMethod, document, notes, reviewed, now)
	}
	if err != nil {
		return EstateMutationResult{}, fmt.Errorf("save estate directive: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return EstateMutationResult{}, fmt.Errorf("commit estate directive: %w", err)
	}
	return EstateMutationResult{ID: id}, nil
}

func (service *EstateMutations) UpsertAllocation(ctx context.Context, userID, directiveID uuid.UUID, input EstateAllocationInput) (EstateMutationResult, error) {
	return service.upsertAllocation(ctx, userID, directiveID, input, false)
}

func (service *EstateMutations) UpsertResiduaryAllocation(ctx context.Context, userID uuid.UUID, input EstateAllocationInput) (EstateMutationResult, error) {
	return service.upsertAllocation(ctx, userID, uuid.Nil, input, true)
}

func (service *EstateMutations) upsertAllocation(ctx context.Context, userID, directiveID uuid.UUID, input EstateAllocationInput, residuary bool) (EstateMutationResult, error) {
	if input.BeneficiaryID == uuid.Nil {
		return EstateMutationResult{}, ErrEstateNotFound
	}
	if !estateAllowed(input.Tier, "primary", "contingent") || input.AllocationBPS <= 0 || input.AllocationBPS > fullEstateAllocationBPS {
		return EstateMutationResult{}, estateValidation("allocation must be between 0.01% and 100%")
	}
	notes, err := estateOptionalText(input.Notes, 2000, "notes")
	if err != nil {
		return EstateMutationResult{}, err
	}
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return EstateMutationResult{}, fmt.Errorf("begin estate allocation: %w", err)
	}
	defer tx.Rollback()
	plan, err := requireEstatePlan(ctx, tx, userID)
	if err != nil {
		return EstateMutationResult{}, err
	}
	var beneficiaryExists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM beneficiaries WHERE user_id=$1 AND id=$2 AND archived_at IS NULL)`, userID, input.BeneficiaryID).Scan(&beneficiaryExists); err != nil {
		return EstateMutationResult{}, fmt.Errorf("load estate beneficiary: %w", err)
	}
	if !beneficiaryExists {
		return EstateMutationResult{}, ErrEstateNotFound
	}
	if !residuary {
		var included bool
		if err := tx.QueryRowContext(ctx, `SELECT is_included FROM estate_account_directives WHERE user_id=$1 AND estate_plan_id=$2 AND id=$3`, userID, plan.ID, directiveID).Scan(&included); errors.Is(err, sql.ErrNoRows) || !included {
			return EstateMutationResult{}, ErrEstateNotFound
		} else if err != nil {
			return EstateMutationResult{}, fmt.Errorf("load estate directive: %w", err)
		}
	}
	table, parentColumn, parentID := "estate_allocations", "directive_id", directiveID
	if residuary {
		table, parentColumn, parentID = "estate_residuary_allocations", "estate_plan_id", plan.ID
	}
	var existingID uuid.UUID
	err = tx.QueryRowContext(ctx, fmt.Sprintf(`SELECT id FROM %s WHERE user_id=$1 AND %s=$2 AND beneficiary_id=$3 AND tier=$4`, table, parentColumn), userID, parentID, input.BeneficiaryID, input.Tier).Scan(&existingID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return EstateMutationResult{}, fmt.Errorf("load estate allocation: %w", err)
	}
	existing := err == nil
	var otherTotal int32
	if err := tx.QueryRowContext(ctx, fmt.Sprintf(`SELECT COALESCE(sum(allocation_bps),0) FROM %s WHERE user_id=$1 AND %s=$2 AND tier=$3 AND id<>$4`, table, parentColumn), userID, parentID, input.Tier, existingID).Scan(&otherTotal); err != nil {
		return EstateMutationResult{}, fmt.Errorf("total estate allocations: %w", err)
	}
	if otherTotal+input.AllocationBPS > fullEstateAllocationBPS {
		return EstateMutationResult{}, estateValidation("allocations cannot exceed 100%")
	}
	now := service.now().UTC()
	if !existing {
		existingID = uuid.New()
		if residuary {
			_, err = tx.ExecContext(ctx, `INSERT INTO estate_residuary_allocations
(id,user_id,estate_plan_id,beneficiary_id,tier,allocation_bps,notes,created_at,updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`, existingID, userID, plan.ID, input.BeneficiaryID, input.Tier, input.AllocationBPS, notes, now)
		} else {
			_, err = tx.ExecContext(ctx, `INSERT INTO estate_allocations
(id,user_id,estate_plan_id,directive_id,beneficiary_id,tier,allocation_bps,notes,created_at,updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`, existingID, userID, plan.ID, directiveID, input.BeneficiaryID, input.Tier, input.AllocationBPS, notes, now)
		}
	} else {
		_, err = tx.ExecContext(ctx, fmt.Sprintf(`UPDATE %s SET allocation_bps=$3,notes=$4,updated_at=$5 WHERE user_id=$1 AND id=$2`, table), userID, existingID, input.AllocationBPS, notes, now)
	}
	if err != nil {
		return EstateMutationResult{}, fmt.Errorf("save estate allocation: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return EstateMutationResult{}, fmt.Errorf("commit estate allocation: %w", err)
	}
	return EstateMutationResult{ID: existingID}, nil
}

func (service *EstateMutations) DeleteAllocation(ctx context.Context, userID, allocationID uuid.UUID) error {
	result, err := service.db.ExecContext(ctx, `DELETE FROM estate_allocations WHERE user_id=$1 AND id=$2`, userID, allocationID)
	return estateMutationResult(result, err, "delete estate allocation")
}

func (service *EstateMutations) DeleteResiduaryAllocation(ctx context.Context, userID, allocationID uuid.UUID) error {
	result, err := service.db.ExecContext(ctx, `DELETE FROM estate_residuary_allocations WHERE user_id=$1 AND id=$2`, userID, allocationID)
	return estateMutationResult(result, err, "delete residuary allocation")
}

func (service *EstateMutations) CreateSnapshot(ctx context.Context, userID uuid.UUID) (EstateSnapshotResult, error) {
	tx, err := service.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return EstateSnapshotResult{}, fmt.Errorf("begin estate snapshot: %w", err)
	}
	defer tx.Rollback()
	plan, err := requireEstatePlan(ctx, tx, userID)
	if err != nil {
		return EstateSnapshotResult{}, err
	}
	var displayName, baseCurrency, timezone string
	if err := tx.QueryRowContext(ctx, `SELECT display_name,base_currency,timezone FROM user_settings WHERE user_id=$1`, userID).Scan(&displayName, &baseCurrency, &timezone); errors.Is(err, sql.ErrNoRows) {
		return EstateSnapshotResult{}, ErrEstateNotFound
	} else if err != nil {
		return EstateSnapshotResult{}, fmt.Errorf("load estate snapshot settings: %w", err)
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return EstateSnapshotResult{}, fmt.Errorf("load estate timezone: %w", err)
	}
	generatedAt := service.now().UTC()
	valueAsOfDate := generatedAt.In(location).Format(time.DateOnly)
	content, err := estateSnapshotJSON(ctx, tx, userID, plan, displayName, baseCurrency, generatedAt, valueAsOfDate)
	if err != nil {
		return EstateSnapshotResult{}, err
	}
	hashBytes := sha256.Sum256(content)
	hash := hex.EncodeToString(hashBytes[:])
	result := EstateSnapshotResult{EstateSnapshot: EstateSnapshot{
		EstateSnapshotMeta: EstateSnapshotMeta{ID: uuid.New(), EstatePlanID: plan.ID, Version: 1,
			Title: plan.Title, BaseCurrency: baseCurrency, ContentHash: hash, GeneratedAt: generatedAt},
		Content: json.RawMessage(content),
	}}
	result.ValueAsOfDate, _ = time.Parse(time.DateOnly, valueAsOfDate)
	_, err = tx.ExecContext(ctx, `INSERT INTO estate_plan_snapshots
(id,user_id,estate_plan_id,version,title,value_as_of_date,base_currency,content,content_hash,generated_at)
VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9)`, result.ID, userID, plan.ID, plan.Title, valueAsOfDate, baseCurrency, string(content), hash, generatedAt)
	if err != nil {
		return EstateSnapshotResult{}, fmt.Errorf("create estate snapshot: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return EstateSnapshotResult{}, fmt.Errorf("commit estate snapshot: %w", err)
	}
	return result, nil
}

func (service *EstateMutations) DeleteSnapshot(ctx context.Context, userID, snapshotID uuid.UUID) error {
	result, err := service.db.ExecContext(ctx, `DELETE FROM estate_plan_snapshots WHERE user_id=$1 AND id=$2`, userID, snapshotID)
	return estateMutationResult(result, err, "delete estate snapshot")
}

func estateSnapshotJSON(ctx context.Context, tx *sql.Tx, userID uuid.UUID, plan EstatePlan, displayName, baseCurrency string, generatedAt time.Time, valueAsOfDate string) ([]byte, error) {
	beneficiaries, err := estateJSONRows(ctx, tx, `
SELECT jsonb_build_object('id',id,'kind',kind,'name',name,'relationship',relationship,
'contactSummary',contact_summary,'notes',notes,'archivedAt',archived_at)
FROM beneficiaries WHERE user_id=$1 ORDER BY archived_at NULLS FIRST,name,id`, userID)
	if err != nil {
		return nil, fmt.Errorf("snapshot beneficiaries: %w", err)
	}
	assets, err := estateJSONRows(ctx, tx, `
SELECT jsonb_build_object('id',account.id,'name',account.name,'currency',account.currency,
'currentValueMinor',account.current_value_minor::text,'archivedAt',account.archived_at,
'directive',CASE WHEN directive.id IS NULL THEN NULL ELSE jsonb_build_object(
'id',directive.id,'isIncluded',directive.is_included,'ownershipShareBps',directive.ownership_share_bps,
'transferContext',directive.transfer_context,'distributionMethod',directive.distribution_method,
'documentReference',directive.document_reference,'notes',directive.notes,'reviewedAt',directive.reviewed_at) END,
'allocations',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',allocation.id,'beneficiaryId',allocation.beneficiary_id,
'tier',allocation.tier,'allocationBps',allocation.allocation_bps,'notes',allocation.notes) ORDER BY allocation.tier,allocation.beneficiary_id,allocation.id)
FROM estate_allocations allocation WHERE allocation.user_id=account.user_id AND allocation.directive_id=directive.id),'[]'::jsonb))
FROM accounts account LEFT JOIN estate_account_directives directive
ON directive.user_id=account.user_id AND directive.account_id=account.id
WHERE account.user_id=$1 AND account.is_liability=FALSE ORDER BY account.name,account.id`, userID)
	if err != nil {
		return nil, fmt.Errorf("snapshot assets: %w", err)
	}
	liabilities, err := estateJSONRows(ctx, tx, `SELECT jsonb_build_object('id',id,'name',name,'currency',currency,
'valueMinor',current_value_minor::text) FROM accounts WHERE user_id=$1 AND is_liability=TRUE AND archived_at IS NULL ORDER BY name,id`, userID)
	if err != nil {
		return nil, fmt.Errorf("snapshot liabilities: %w", err)
	}
	residuary, err := estateJSONRows(ctx, tx, `SELECT jsonb_build_object('id',allocation.id,'beneficiaryId',allocation.beneficiary_id,
'tier',allocation.tier,'allocationBps',allocation.allocation_bps,'notes',allocation.notes)
FROM estate_residuary_allocations allocation WHERE user_id=$1 ORDER BY tier,beneficiary_id,id`, userID)
	if err != nil {
		return nil, fmt.Errorf("snapshot residuary allocations: %w", err)
	}
	content := struct {
		Format                 string            `json:"format"`
		Version                int               `json:"version"`
		GeneratedAt            string            `json:"generatedAt"`
		ValueAsOfDate          string            `json:"valueAsOfDate"`
		OwnerDisplayName       string            `json:"ownerDisplayName"`
		Plan                   map[string]any    `json:"plan"`
		BaseCurrency           string            `json:"baseCurrency"`
		Beneficiaries          []json.RawMessage `json:"beneficiaries"`
		Assets                 []json.RawMessage `json:"assets"`
		Liabilities            []json.RawMessage `json:"liabilities"`
		ResiduaryAllocations   []json.RawMessage `json:"residuaryAllocations"`
		ReviewItems            []any             `json:"reviewItems"`
		MathematicallyComplete bool              `json:"mathematicallyComplete"`
		AccountsWarning        string            `json:"accountsWarning"`
		Disclaimer             string            `json:"disclaimer"`
	}{
		Format: "wealthboard-estate-summary", Version: 1, GeneratedAt: generatedAt.Format(time.RFC3339Nano),
		ValueAsOfDate: valueAsOfDate, OwnerDisplayName: displayName, BaseCurrency: baseCurrency,
		Plan:          map[string]any{"title": plan.Title, "jurisdiction": plan.Jurisdiction, "lastReviewedDate": plan.LastReviewedDate, "reviewReminderDate": plan.ReviewReminderDate},
		Beneficiaries: beneficiaries, Assets: assets, Liabilities: liabilities, ResiduaryAllocations: residuary,
		ReviewItems: []any{}, MathematicallyComplete: true, AccountsWarning: estateCurrentValueWarning,
		Disclaimer: "This Estate Planning Summary is a planning record, not a legally executed will. It does not transfer ownership or replace locally valid legal documents and provider designations.",
	}
	return json.Marshal(content)
}

func estateJSONRows(ctx context.Context, tx *sql.Tx, query string, userID uuid.UUID) ([]json.RawMessage, error) {
	rows, err := tx.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []json.RawMessage{}
	for rows.Next() {
		var value []byte
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		result = append(result, json.RawMessage(append([]byte(nil), value...)))
	}
	return result, rows.Err()
}

func requireEstatePlan(ctx context.Context, queryer sqlTx, userID uuid.UUID) (EstatePlan, error) {
	var plan EstatePlan
	if err := scanEstatePlan(queryer.QueryRowContext(ctx, `
SELECT id,title,jurisdiction,last_reviewed_date,review_reminder_date,created_at,updated_at
FROM estate_plans WHERE user_id=$1`, userID), &plan); errors.Is(err, sql.ErrNoRows) {
		return EstatePlan{}, ErrEstateNotFound
	} else if err != nil {
		return EstatePlan{}, fmt.Errorf("load estate plan: %w", err)
	}
	return plan, nil
}

type estateRowScanner interface {
	Scan(...any) error
}

func scanEstatePlan(row estateRowScanner, plan *EstatePlan) error {
	var jurisdiction sql.NullString
	var reviewed, reminder sql.NullTime
	if err := row.Scan(&plan.ID, &plan.Title, &jurisdiction, &reviewed, &reminder, &plan.CreatedAt, &plan.UpdatedAt); err != nil {
		return err
	}
	plan.Jurisdiction, plan.LastReviewedDate, plan.ReviewReminderDate = stringPointer(jurisdiction), timePointer(reviewed), timePointer(reminder)
	return nil
}

func prepareBeneficiary(input BeneficiaryInput) (BeneficiaryInput, error) {
	input.Name = strings.TrimSpace(input.Name)
	if !estateAllowed(input.Kind, "person", "organization", "trust") || input.Name == "" || len(input.Name) > 120 {
		return BeneficiaryInput{}, estateValidation("beneficiary details are invalid")
	}
	for value, limit := range map[string]int{input.Relationship: 80, input.ContactSummary: 300, input.Notes: 2000} {
		if len(strings.TrimSpace(value)) > limit {
			return BeneficiaryInput{}, estateValidation("beneficiary details are too long")
		}
	}
	return input, nil
}

func estateOptionalText(value string, limit int, label string) (any, error) {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) > limit {
		return nil, estateValidation(label + " is too long")
	}
	if trimmed == "" {
		return nil, nil
	}
	return trimmed, nil
}

func estateOptionalDate(value *string, field string) (any, error) {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.DateOnly, strings.TrimSpace(*value))
	if err != nil || parsed.Format(time.DateOnly) != strings.TrimSpace(*value) {
		return nil, estateValidation(field + " must use YYYY-MM-DD")
	}
	return parsed.Format(time.DateOnly), nil
}

func nullableTrimmed(value string) any {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}

func estateAllowed(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func estateMutationResult(result sql.Result, err error, operation string) error {
	if err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	if count == 0 {
		return ErrEstateNotFound
	}
	return nil
}

func estateValidation(detail string) error {
	return fmt.Errorf("%w: %s", ErrEstateValidation, detail)
}
