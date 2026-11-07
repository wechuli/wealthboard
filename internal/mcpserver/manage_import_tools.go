package mcpserver

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/wechuli/wealthboard/internal/service"
)

const statementHelp = "Rows need date (YYYY-MM-DD), type, and amount (a positive plain decimal in the account currency; only manual_adjustment may be negative). " +
	"Give each row the statement's own transaction ID as externalId when it has one; otherwise Wealthboard derives a stable ID from date, type, amount, and occurrence, so identical rows on one day are kept apart and re-imports are skipped. "

func (tools *toolset) registerImportReads(server *mcp.Server) {
	addTool(server, &mcp.Tool{
		Name: "reconcile_transactions",
		Description: "Compare statement rows with the account's records without changing anything. Reports rows already recorded, missing rows, possible duplicates, conflicting IDs, records in the period that the statement lacks, and the difference from closingBalance. " +
			statementHelp,
		Annotations: readOnly("Reconcile a statement"),
	}, handle(tools, tools.reconcile))
	addTool(server, &mcp.Tool{
		Name:        "get_import_history",
		Description: "Imports (statements, trades, and position syncs) newest first, with counts, statement balances, and whether they were rolled back.",
		Annotations: readOnly("Import history"),
	}, handle(tools, tools.importHistory))
	addTool(server, &mcp.Tool{
		Name:        "get_reconciliation_status",
		Description: "For each account, the latest import and whether the balance Wealthboard now calculates for the latest imported statement date still equals that statement's closing balance.",
		Annotations: readOnly("Reconciliation status"),
	}, handle(tools, tools.reconciliationStatus))
}

func (tools *toolset) registerImportWrites(server *mcp.Server) {
	importAudit := func(out StatementImportOutput) auditRef {
		if out.ImportID == "" || out.Status != "completed" {
			return auditRef{skip: true}
		}
		ids := []string{}
		for _, row := range out.Rows {
			if row.TransactionID != "" {
				ids = append(ids, row.TransactionID)
			}
		}
		return auditRef{recordType: "transaction", ids: mustIDs(ids...), accountID: mustID(out.AccountID), batchID: mustID(out.ImportID)}
	}
	addTool(server, &mcp.Tool{
		Name: "bulk_create_transactions",
		Description: "Create up to 1,000 transactions in one account atomically, for example every row of a statement. Existing rows are skipped, rows that only match an existing record's date, type, and amount are held for review, and nothing is written if any row is invalid or conflicts (unless allowPartial). " +
			"dryRun previews without writing. " + statementHelp,
		Annotations: writeAnnotations("Create transactions"),
	}, handleWrite(tools, "import", tools.bulkCreate, func(_ bulkCreateInput, out StatementImportOutput) auditRef { return importAudit(out) }))
	addTool(server, &mcp.Tool{
		Name:        "preview_import",
		Description: "Preview a statement import without writing: what would be created, skipped, held as possible duplicates, or rejected, the resulting balance, and the closing-balance check. Returns a hash to pass to commit_import. " + statementHelp,
		Annotations: readOnly("Preview an import"),
	}, handle(tools, tools.previewImport))
	addTool(server, &mcp.Tool{
		Name:        "commit_import",
		Description: "Commit a previewed statement import. Send the same request as preview_import plus its hash, which guarantees the user approved exactly these rows. All rows are written in one transaction and linked to an import ID for history and rollback.",
		Annotations: writeAnnotations("Commit an import"),
	}, handleWrite(tools, "import", tools.commitImport, func(_ commitImportInput, out StatementImportOutput) auditRef { return importAudit(out) }))
	addTool(server, &mcp.Tool{
		Name:        "rollback_import",
		Description: "Delete exactly the records one import created and replay the account. Refuses if any of them was edited after the import or if removing trades would leave a later sale without holdings. Unrelated records are never touched. Confirm with the user first.",
		Annotations: destructive("Roll back an import"),
	}, handleWrite(tools, "rollback", tools.rollbackImport, func(_ importInput, out RollbackOutput) auditRef {
		return auditRef{recordType: "import", ids: mustIDs(out.ImportID), accountID: mustID(out.Account.ID), batchID: mustID(out.ImportID)}
	}))
}

type statementRowInput struct {
	ExternalID  string `json:"externalId,omitempty" jsonschema:"The statement's transaction ID, if any. Case-sensitive."`
	Date        string `json:"date" jsonschema:"Posting date, YYYY-MM-DD."`
	Type        string `json:"type" jsonschema:"deposit, withdrawal, interest, dividend, capital_gain, capital_loss, fee, purchase, sale, manual_adjustment, liability_payment, or liability_increase. Record withholding tax as fee."`
	Amount      string `json:"amount" jsonschema:"Plain decimal in the account currency, such as 122.61."`
	Currency    string `json:"currency,omitempty" jsonschema:"Optional; must equal the account currency."`
	Description string `json:"description,omitempty"`
}

type closingBalanceInput struct {
	Date   string `json:"date" jsonschema:"Statement closing date, YYYY-MM-DD."`
	Amount string `json:"amount" jsonschema:"Closing balance printed on the statement (cash for investment accounts)."`
}

type statementInput struct {
	AccountID               string               `json:"accountId"`
	Source                  string               `json:"source,omitempty" jsonschema:"Where the rows come from, such as etica_statement."`
	Transactions            []statementRowInput  `json:"transactions" jsonschema:"Up to 1,000 rows."`
	ClosingBalance          *closingBalanceInput `json:"closingBalance,omitempty" jsonschema:"Optional statement balance to check; differences are reported, never adjusted."`
	AllowPartial            bool                 `json:"allowPartial,omitempty" jsonschema:"Import valid rows even when others are rejected or conflict."`
	AllowPossibleDuplicates bool                 `json:"allowPossibleDuplicates,omitempty" jsonschema:"Create rows that only match an existing record's date, type, and amount. Use after the user confirms they are separate transactions."`
}

type bulkCreateInput struct {
	statementInput
	DryRun         bool   `json:"dryRun,omitempty" jsonschema:"Validate and report without writing."`
	IdempotencyKey string `json:"idempotencyKey,omitempty" jsonschema:"Optional UUID for this import; a retry with the same key and rows returns the original result."`
}

type commitImportInput struct {
	statementInput
	ExpectedHash   string `json:"hash" jsonschema:"The hash preview_import returned for this request."`
	IdempotencyKey string `json:"idempotencyKey,omitempty" jsonschema:"Optional UUID; a retry with the same key and rows returns the original result."`
}

type reconcileInput struct {
	statementInput
	From string `json:"from,omitempty" jsonschema:"Statement period start, to list records the statement lacks. Defaults to the earliest row date."`
	To   string `json:"to,omitempty" jsonschema:"Statement period end. Defaults to the latest row date."`
}

type StatementRowItem struct {
	Index                int    `json:"index"`
	ExternalID           string `json:"externalId,omitempty" jsonschema:"The given or derived ID used for matching."`
	Date                 string `json:"date"`
	Type                 string `json:"type"`
	Amount               string `json:"amount"`
	Status               string `json:"status" jsonschema:"create, created, duplicate, possible_duplicate, conflict, rejected, or not_imported."`
	Code                 string `json:"code"`
	Message              string `json:"message"`
	TransactionID        string `json:"transactionId,omitempty"`
	MatchedTransactionID string `json:"matchedTransactionId,omitempty"`
}

type BalanceCheckItem struct {
	Date       string `json:"date"`
	Statement  Money  `json:"statement"`
	Calculated Money  `json:"calculated" jsonschema:"Wealthboard's balance at the end of that date, including the rows this call creates."`
	Difference Money  `json:"difference" jsonschema:"calculated minus statement."`
	Matches    bool   `json:"matches"`
}

type DateRangeItem struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type StatementImportOutput struct {
	ImportID           string             `json:"importId,omitempty"`
	Status             string             `json:"status" jsonschema:"preview, completed, unchanged, rejected, replayed, or reconciled."`
	Hash               string             `json:"hash" jsonschema:"Identifies this exact request; pass it to commit_import."`
	AccountID          string             `json:"accountId"`
	AccountName        string             `json:"accountName"`
	BalanceBasis       string             `json:"balanceBasis" jsonschema:"balance, or cash for investment accounts."`
	Created            int                `json:"created"`
	Updated            int                `json:"updated"`
	Skipped            int                `json:"skipped"`
	Duplicates         int                `json:"duplicates"`
	PossibleDuplicates int                `json:"possibleDuplicates"`
	Conflicts          int                `json:"conflicts"`
	Rejected           int                `json:"rejected"`
	BalanceBefore      Money              `json:"balanceBefore"`
	BalanceAfter       Money              `json:"balanceAfter" jsonschema:"Wealthboard's calculated balance after the import (projected for previews)."`
	DateRange          *DateRangeItem     `json:"dateRange,omitempty"`
	ClosingBalance     *BalanceCheckItem  `json:"closingBalance,omitempty"`
	Warnings           []string           `json:"warnings"`
	Rows               []StatementRowItem `json:"rows"`
	UnmatchedExisting  []TransactionItem  `json:"unmatchedExisting,omitempty" jsonschema:"Records in the period that the statement doesn't contain."`
	Notice             string             `json:"notice"`
}

func (tools *toolset) statementRequest(input statementInput) (service.StatementImportInput, error) {
	accountID, err := parseID("accountId", input.AccountID)
	if err != nil {
		return service.StatementImportInput{}, err
	}
	if len(input.Transactions) == 0 || len(input.Transactions) > service.MaxStatementRows {
		return service.StatementImportInput{}, invalid("send between 1 and %d transactions", service.MaxStatementRows)
	}
	request := service.StatementImportInput{AccountID: accountID, Source: input.Source, AllowPartial: input.AllowPartial, AllowPossibleDuplicates: input.AllowPossibleDuplicates}
	for _, row := range input.Transactions {
		request.Transactions = append(request.Transactions, service.StatementTransaction{ExternalID: row.ExternalID, Date: row.Date, Type: row.Type,
			Amount: row.Amount, Currency: row.Currency, Description: row.Description})
	}
	if input.ClosingBalance != nil {
		request.ClosingBalance = &service.StatementBalance{Date: input.ClosingBalance.Date, Amount: input.ClosingBalance.Amount}
	}
	return request, nil
}

func statementOutput(result service.StatementImportResult) StatementImportOutput {
	currency := result.Currency
	output := StatementImportOutput{
		Status: result.Status, Hash: result.Hash, AccountID: result.AccountID.String(), AccountName: result.AccountName, BalanceBasis: result.BalanceBasis,
		Created: result.Created, Updated: result.Updated, Skipped: result.Skipped, Duplicates: result.Duplicates, PossibleDuplicates: result.PossibleDuplicates,
		Conflicts: result.Conflicts, Rejected: result.Rejected, BalanceBefore: moneyMinor(result.BalanceBeforeMinor, currency),
		BalanceAfter: moneyMinor(result.BalanceAfterMinor, currency), Warnings: nonNil(result.Warnings), Rows: []StatementRowItem{}, Notice: untrustedTextNotice,
	}
	if result.ImportID != nil {
		output.ImportID = result.ImportID.String()
	}
	if result.DateRange != nil {
		output.DateRange = &DateRangeItem{From: result.DateRange.From, To: result.DateRange.To}
	}
	if check := result.ClosingBalance; check != nil {
		output.ClosingBalance = &BalanceCheckItem{Date: check.Date, Statement: moneyMinor(check.StatementMinor, currency), Calculated: moneyMinor(check.CalculatedMinor, currency),
			Difference: moneyMinor(check.DifferenceMinor, currency), Matches: check.Matches}
	}
	for _, row := range result.Rows {
		output.Rows = append(output.Rows, StatementRowItem{Index: row.Index, ExternalID: row.ExternalID, Date: row.Date, Type: row.Type, Amount: row.Amount,
			Status: row.Status, Code: row.Code, Message: row.Message, TransactionID: optionalID(row.TransactionID), MatchedTransactionID: optionalID(row.MatchedTransactionID)})
	}
	for _, item := range result.UnmatchedExisting {
		output.UnmatchedExisting = append(output.UnmatchedExisting, TransactionItem{ID: item.ID.String(), AccountID: item.AccountID.String(), AccountName: item.AccountName,
			Type: item.Type, Amount: money(item.AmountMinor, item.Currency), Date: item.TransactionDate, Description: item.Description, TransferGroupID: optionalID(item.TransferGroupID)})
	}
	return output
}

func (tools *toolset) bulkCreate(ctx context.Context, userID uuid.UUID, input bulkCreateInput) (StatementImportOutput, error) {
	request, err := tools.statementRequest(input.statementInput)
	if err != nil {
		return StatementImportOutput{}, err
	}
	if request.IdempotencyKey, err = idempotencyArg(input.IdempotencyKey, false); err != nil {
		return StatementImportOutput{}, err
	}
	request.DryRun = input.DryRun
	result, err := tools.readers.Manage.Statements.Import(ctx, userID, request)
	if err != nil {
		return StatementImportOutput{}, err
	}
	return statementOutput(result), nil
}

func (tools *toolset) previewImport(ctx context.Context, userID uuid.UUID, input statementInput) (StatementImportOutput, error) {
	request, err := tools.statementRequest(input)
	if err != nil {
		return StatementImportOutput{}, err
	}
	request.DryRun = true
	result, err := tools.readers.Manage.Statements.Import(ctx, userID, request)
	if err != nil {
		return StatementImportOutput{}, err
	}
	return statementOutput(result), nil
}

func (tools *toolset) commitImport(ctx context.Context, userID uuid.UUID, input commitImportInput) (StatementImportOutput, error) {
	if strings.TrimSpace(input.ExpectedHash) == "" {
		return StatementImportOutput{}, invalid("hash is required; call preview_import with the same request first")
	}
	request, err := tools.statementRequest(input.statementInput)
	if err != nil {
		return StatementImportOutput{}, err
	}
	if request.IdempotencyKey, err = idempotencyArg(input.IdempotencyKey, false); err != nil {
		return StatementImportOutput{}, err
	}
	request.ExpectedHash = strings.TrimSpace(input.ExpectedHash)
	result, err := tools.readers.Manage.Statements.Import(ctx, userID, request)
	if err != nil {
		return StatementImportOutput{}, err
	}
	return statementOutput(result), nil
}

func (tools *toolset) reconcile(ctx context.Context, userID uuid.UUID, input reconcileInput) (StatementImportOutput, error) {
	request, err := tools.statementRequest(input.statementInput)
	if err != nil {
		return StatementImportOutput{}, err
	}
	if request.From, request.To, err = dateRange(input.From, input.To); err != nil {
		return StatementImportOutput{}, err
	}
	result, err := tools.readers.Manage.Statements.Reconcile(ctx, userID, request)
	if err != nil {
		return StatementImportOutput{}, err
	}
	return statementOutput(result), nil
}

type importHistoryInput struct {
	AccountID string `json:"accountId,omitempty"`
	Kind      string `json:"kind,omitempty" jsonschema:"transactions, trades, or positions."`
	Status    string `json:"status,omitempty" jsonschema:"committed or rolled_back."`
	Limit     int    `json:"limit,omitempty"`
	Offset    int    `json:"offset,omitempty"`
}

type ImportCounts struct {
	Created            int `json:"created"`
	Duplicates         int `json:"duplicates"`
	PossibleDuplicates int `json:"possibleDuplicates"`
	Conflicts          int `json:"conflicts"`
	Rejected           int `json:"rejected"`
	InstrumentsCreated int `json:"instrumentsCreated"`
	PricesRecorded     int `json:"pricesRecorded"`
}

type ImportItem struct {
	ID                 string       `json:"id"`
	AccountID          string       `json:"accountId"`
	AccountName        string       `json:"accountName"`
	Kind               string       `json:"kind"`
	Source             string       `json:"source,omitempty"`
	Status             string       `json:"status"`
	CreatedAt          string       `json:"createdAt"`
	RolledBackAt       string       `json:"rolledBackAt,omitempty"`
	TransactionCount   int          `json:"transactionCount" jsonschema:"Records from this import that still exist."`
	PositionEventCount int          `json:"positionEventCount"`
	StatementDate      string       `json:"statementDate,omitempty"`
	StatementBalance   *Money       `json:"statementBalance,omitempty"`
	Counts             ImportCounts `json:"counts"`
}

type ImportHistoryResult struct {
	Imports    []ImportItem `json:"imports"`
	Limit      int          `json:"limit"`
	Offset     int          `json:"offset"`
	HasMore    bool         `json:"hasMore"`
	NextOffset *int         `json:"nextOffset,omitempty"`
}

func (tools *toolset) importHistory(ctx context.Context, userID uuid.UUID, input importHistoryInput) (ImportHistoryResult, error) {
	page, err := pageArgs(input.Limit, input.Offset)
	if err != nil {
		return ImportHistoryResult{}, err
	}
	filter := service.ImportBatchFilter{Kind: input.Kind, Status: input.Status, Page: page}
	if filter.AccountID, err = optionalUUIDArg("accountId", input.AccountID); err != nil {
		return ImportHistoryResult{}, err
	}
	listed, err := tools.readers.Manage.Imports.List(ctx, userID, filter)
	if err != nil {
		return ImportHistoryResult{}, err
	}
	result := ImportHistoryResult{Imports: []ImportItem{}, Limit: listed.Limit, Offset: listed.Offset, HasMore: listed.HasMore, NextOffset: nextOffset(page, len(listed.Items), listed.HasMore)}
	for _, batch := range listed.Items {
		item := ImportItem{ID: batch.ID.String(), AccountID: batch.AccountID.String(), AccountName: batch.AccountName, Kind: batch.Kind, Source: batch.Source,
			Status: batch.Status, CreatedAt: batch.CreatedAt.UTC().Format(time.RFC3339), TransactionCount: batch.TransactionCount, PositionEventCount: batch.PositionEventCount}
		if batch.RolledBackAt != nil {
			item.RolledBackAt = batch.RolledBackAt.UTC().Format(time.RFC3339)
		}
		if batch.StatementDate != nil {
			item.StatementDate = *batch.StatementDate
		}
		item.StatementBalance = optionalMoney(batch.StatementBalanceMinor, batch.Currency)
		_ = json.Unmarshal(batch.Summary, &item.Counts)
		result.Imports = append(result.Imports, item)
	}
	return result, nil
}

type importInput struct {
	ImportID string `json:"importId" jsonschema:"Import ID from an import result or get_import_history."`
}

type RollbackOutput struct {
	ImportID              string         `json:"importId"`
	DeletedTransactions   int            `json:"deletedTransactions"`
	DeletedPositionEvents int            `json:"deletedPositionEvents"`
	BalanceBefore         Money          `json:"balanceBefore"`
	BalanceAfter          Money          `json:"balanceAfter"`
	Account               AccountSummary `json:"account"`
	Warnings              []string       `json:"warnings"`
}

func (tools *toolset) rollbackImport(ctx context.Context, userID uuid.UUID, input importInput) (RollbackOutput, error) {
	importID, err := parseID("importId", input.ImportID)
	if err != nil {
		return RollbackOutput{}, err
	}
	result, err := tools.readers.Manage.Imports.Rollback(ctx, userID, importID)
	if err != nil {
		return RollbackOutput{}, err
	}
	account, err := tools.accountAfterWrite(ctx, userID, result.AccountID)
	if err != nil {
		return RollbackOutput{}, err
	}
	return RollbackOutput{ImportID: importID.String(), DeletedTransactions: result.DeletedTransactions, DeletedPositionEvents: result.DeletedPositionEvent,
		BalanceBefore: moneyMinor(result.BalanceBeforeMinor, account.Currency), BalanceAfter: moneyMinor(result.BalanceAfterMinor, account.Currency),
		Account: account, Warnings: nonNil(result.Warnings)}, nil
}

type reconciliationStatusInput struct {
	AccountID string `json:"accountId,omitempty" jsonschema:"Only this account. Omit for all active accounts."`
}

type ReconciliationItem struct {
	AccountID         string `json:"accountId"`
	AccountName       string `json:"accountName"`
	BalanceBasis      string `json:"balanceBasis"`
	CurrentBalance    Money  `json:"currentBalance"`
	LastImportID      string `json:"lastImportId,omitempty"`
	LastImportAt      string `json:"lastImportAt,omitempty"`
	StatementImportID string `json:"statementImportId,omitempty"`
	StatementDate     string `json:"statementDate,omitempty"`
	StatementBalance  *Money `json:"statementBalance,omitempty"`
	Calculated        *Money `json:"calculated,omitempty"`
	Difference        *Money `json:"difference,omitempty"`
	Status            string `json:"status" jsonschema:"reconciled, out_of_balance, or no_statement."`
}

type ReconciliationStatusResult struct {
	Accounts []ReconciliationItem `json:"accounts"`
}

func (tools *toolset) reconciliationStatus(ctx context.Context, userID uuid.UUID, input reconciliationStatusInput) (ReconciliationStatusResult, error) {
	accountID, err := optionalUUIDArg("accountId", input.AccountID)
	if err != nil {
		return ReconciliationStatusResult{}, err
	}
	statuses, err := tools.readers.Manage.Imports.ReconciliationStatus(ctx, userID, accountID)
	if err != nil {
		return ReconciliationStatusResult{}, err
	}
	result := ReconciliationStatusResult{Accounts: []ReconciliationItem{}}
	for _, status := range statuses {
		item := ReconciliationItem{AccountID: status.AccountID.String(), AccountName: status.AccountName, BalanceBasis: status.BalanceBasis,
			CurrentBalance: money(status.CurrentBalanceMinor, status.Currency), StatementBalance: optionalMoney(status.StatementBalanceMinor, status.Currency),
			Calculated: optionalMoney(status.CalculatedMinor, status.Currency), Difference: optionalMoney(status.DifferenceMinor, status.Currency), Status: status.Status}
		for target, value := range map[*string]*string{&item.LastImportID: status.LastImportID, &item.LastImportAt: status.LastImportAt, &item.StatementImportID: status.StatementImportID, &item.StatementDate: status.StatementDate} {
			if value != nil {
				*target = *value
			}
		}
		result.Accounts = append(result.Accounts, item)
	}
	return result, nil
}
