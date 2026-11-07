package mcpserver

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/wechuli/wealthboard/internal/domain"
	"github.com/wechuli/wealthboard/internal/service"
)

func destructive(title string) *mcp.ToolAnnotations {
	closed, yes := false, true
	return &mcp.ToolAnnotations{Title: title, DestructiveHint: &yes, OpenWorldHint: &closed}
}

func (tools *toolset) registerLedgerReads(server *mcp.Server) {
	addTool(server, &mcp.Tool{
		Name:        "list_categories",
		Description: "Account categories and institutions, for choosing categoryId and institutionId when creating or updating an account.",
		Annotations: readOnly("Categories and institutions"),
	}, handle(tools, tools.listCategories))
	addTool(server, &mcp.Tool{
		Name:        "get_account_history",
		Description: "An account's value over time in its currency, by month (default) or day, optionally between from and to. Not available for archived accounts.",
		Annotations: readOnly("Account history"),
	}, handle(tools, tools.accountHistory))
	addTool(server, &mcp.Tool{
		Name:        "list_valuations",
		Description: "Valuations (absolute balance observations) for balance-tracked accounts, newest first, filtered by account and dates.",
		Annotations: readOnly("List valuations"),
	}, handle(tools, tools.listValuations))
	addTool(server, &mcp.Tool{
		Name:        "get_transaction",
		Description: "One transaction with its external ID, import batch, whether it can be edited individually, and updatedAt for safe concurrent updates.",
		Annotations: readOnly("Transaction details"),
	}, handle(tools, tools.getTransaction))
}

func (tools *toolset) registerLedgerWrites(server *mcp.Server) {
	addTool(server, &mcp.Tool{
		Name:        "create_account",
		Description: "Create an account. trackingMode is balance (default; valued by transactions and valuations) or positions (an investment account valued from holdings and cash). Currency and tracking mode can't change later. Use list_categories for categoryId.",
		Annotations: writeAnnotations("Create an account"),
	}, handleWrite(tools, "create", tools.createAccount, func(_ createAccountInput, out AccountWriteResult) auditRef {
		return auditRef{recordType: "account", ids: mustIDs(out.Account.ID), accountID: mustID(out.Account.ID)}
	}))
	addTool(server, &mcp.Tool{
		Name:        "update_account",
		Description: "Change an account's name, description, category, institution, net-worth inclusion, or cost basis (balance accounts). Omitted fields are unchanged. Currency and tracking mode can't change.",
		Annotations: writeAnnotations("Update an account"),
	}, handleWrite(tools, "update", tools.updateAccount, func(in updateAccountInput, out AccountWriteResult) auditRef {
		return auditRef{recordType: "account", ids: mustIDs(out.Account.ID), accountID: mustID(out.Account.ID)}
	}))
	addTool(server, &mcp.Tool{
		Name:        "archive_account",
		Description: "Archive an account (hide it and stop counting it) or, with restore, bring it back. History is kept; nothing is deleted.",
		Annotations: writeAnnotations("Archive an account"),
	}, handleWrite(tools, "archive", tools.archiveAccount, func(in archiveAccountInput, out AccountWriteResult) auditRef {
		return auditRef{recordType: "account", ids: mustIDs(out.Account.ID), accountID: mustID(out.Account.ID)}
	}))
	addTool(server, &mcp.Tool{
		Name:        "update_valuation",
		Description: "Correct a valuation's value or date. Omitted fields are unchanged. The account's balances are replayed.",
		Annotations: writeAnnotations("Update a valuation"),
	}, handleWrite(tools, "update", tools.updateValuation, func(_ updateValuationInput, out RecordValuationResult) auditRef {
		return auditRef{recordType: "valuation", ids: mustIDs(out.Valuation.ID), accountID: mustID(out.Account.ID)}
	}))
	addTool(server, &mcp.Tool{
		Name:        "delete_valuation",
		Description: "Delete an incorrect valuation. The account's balances are replayed. Confirm with the user first.",
		Annotations: destructive("Delete a valuation"),
	}, handleWrite(tools, "delete", tools.deleteValuation, func(_ valuationInput, out DeleteResult) auditRef {
		return auditRef{recordType: "valuation", ids: mustIDs(out.DeletedIDs...), accountID: firstAccount(out.Accounts)}
	}))
	addTool(server, &mcp.Tool{
		Name:        "update_transaction",
		Description: "Change one transaction's type, amount, date, description, or externalId. Omitted fields are unchanged. Pass expectedUpdatedAt from get_transaction to fail if it changed meanwhile. Opening balances, transfers, and grouped investment activity can't be edited here. Changing the type, amount, or date of a synced cash snapshot turns it into a fixed adjustment; use update_cash_balance to change a synced balance.",
		Annotations: writeAnnotations("Update a transaction"),
	}, handleWrite(tools, "update", tools.updateTransaction, func(in updateTransactionInput, out TransactionWriteResult) auditRef {
		return transactionAudit(out)
	}))
	addTool(server, &mcp.Tool{
		Name:        "bulk_update_transactions",
		Description: "Apply up to 1,000 transaction updates atomically: all succeed or none do. Each update works like update_transaction.",
		Annotations: writeAnnotations("Update transactions"),
	}, handleWrite(tools, "update", tools.bulkUpdateTransactions, func(_ bulkUpdateInput, out TransactionWriteResult) auditRef {
		return transactionAudit(out)
	}))
	addTool(server, &mcp.Tool{
		Name:        "delete_transaction",
		Description: "Delete one transaction and replay the account. Deleting either side of a transfer deletes both sides. The opening balance can't be deleted. Confirm with the user first.",
		Annotations: destructive("Delete a transaction"),
	}, handleWrite(tools, "delete", tools.deleteTransaction, func(_ transactionInput, out DeleteResult) auditRef {
		return auditRef{recordType: "transaction", ids: mustIDs(out.DeletedIDs...), accountID: firstAccount(out.Accounts)}
	}))
	addTool(server, &mcp.Tool{
		Name:        "bulk_delete_transactions",
		Description: "Delete up to 1,000 transactions atomically: all are deleted or none are. Confirm with the user first.",
		Annotations: destructive("Delete transactions"),
	}, handleWrite(tools, "delete", tools.bulkDeleteTransactions, func(_ bulkDeleteInput, out DeleteResult) auditRef {
		return auditRef{recordType: "transaction", ids: mustIDs(out.DeletedIDs...), accountID: firstAccount(out.Accounts)}
	}))
	addTool(server, &mcp.Tool{
		Name:        "transfer_between_accounts",
		Description: "Move money between two of the user's asset accounts. Both sides are recorded together and don't count as contributions or withdrawals. Across currencies, pass destinationAmount or Wealthboard converts at the rate effective on the date.",
		Annotations: writeAnnotations("Transfer between accounts"),
	}, handleWrite(tools, "create", tools.transfer, func(_ transferInput, out TransferResult) auditRef {
		return auditRef{recordType: "transfer", ids: mustIDs(out.TransferGroupID), accountID: mustID(out.From.ID)}
	}))
}

func firstAccount(accounts []AccountSummary) *uuid.UUID {
	if len(accounts) == 0 {
		return nil
	}
	return mustID(accounts[0].ID)
}

func transactionAudit(out TransactionWriteResult) auditRef {
	ids := []string{}
	for _, item := range out.Transactions {
		ids = append(ids, item.ID)
	}
	return auditRef{recordType: "transaction", ids: mustIDs(ids...), accountID: firstAccount(out.Accounts)}
}

type CategoryItem struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Kind       string `json:"kind" jsonschema:"asset or liability."`
	Liquid     bool   `json:"liquid"`
	Investible bool   `json:"investible"`
	Archived   bool   `json:"archived"`
}

type InstitutionItem struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Archived bool   `json:"archived"`
}

type CatalogResult struct {
	Categories   []CategoryItem    `json:"categories"`
	Institutions []InstitutionItem `json:"institutions"`
}

func (tools *toolset) listCategories(ctx context.Context, userID uuid.UUID, _ noInput) (CatalogResult, error) {
	categories, err := tools.readers.Manage.Catalog.Categories(ctx, userID)
	if err != nil {
		return CatalogResult{}, err
	}
	institutions, err := tools.readers.Manage.Catalog.Institutions(ctx, userID)
	if err != nil {
		return CatalogResult{}, err
	}
	result := CatalogResult{Categories: []CategoryItem{}, Institutions: []InstitutionItem{}}
	for _, category := range categories {
		result.Categories = append(result.Categories, CategoryItem{ID: category.ID.String(), Name: category.Name, Kind: category.AssetOrLiability,
			Liquid: category.IsLiquid, Investible: category.IsInvestible, Archived: category.IsArchived})
	}
	for _, institution := range institutions {
		result.Institutions = append(result.Institutions, InstitutionItem{ID: institution.ID.String(), Name: institution.Name, Type: institution.Type, Archived: institution.ArchivedAt != ""})
	}
	return result, nil
}

func (tools *toolset) resolveCategory(ctx context.Context, userID uuid.UUID, idText, name string) (uuid.UUID, error) {
	categories, err := tools.readers.Manage.Catalog.Categories(ctx, userID)
	if err != nil {
		return uuid.Nil, err
	}
	for _, category := range categories {
		if category.IsArchived {
			continue
		}
		if (idText != "" && category.ID.String() == strings.TrimSpace(idText)) ||
			(idText == "" && (strings.EqualFold(category.Name, strings.TrimSpace(name)) || strings.EqualFold(category.Slug, strings.TrimSpace(name)))) {
			return category.ID, nil
		}
	}
	return uuid.Nil, invalid("no active category matches; call list_categories for categoryId")
}

func (tools *toolset) resolveInstitution(ctx context.Context, userID uuid.UUID, idText, name string) (*uuid.UUID, error) {
	if strings.TrimSpace(idText) == "" && strings.TrimSpace(name) == "" {
		return nil, nil
	}
	institutions, err := tools.readers.Manage.Catalog.Institutions(ctx, userID)
	if err != nil {
		return nil, err
	}
	for _, institution := range institutions {
		if (idText != "" && institution.ID.String() == strings.TrimSpace(idText)) || (idText == "" && strings.EqualFold(institution.Name, strings.TrimSpace(name))) {
			id := institution.ID
			return &id, nil
		}
	}
	return nil, invalid("no institution matches; call list_categories for institutionId, or omit it")
}

type AccountWriteResult struct {
	Account AccountSummary `json:"account" jsonschema:"The account after the change."`
}

type createAccountInput struct {
	Name               string `json:"name" jsonschema:"Account name, at most 100 characters."`
	Description        string `json:"description,omitempty"`
	CategoryID         string `json:"categoryId,omitempty" jsonschema:"Category ID from list_categories. Or pass category."`
	Category           string `json:"category,omitempty" jsonschema:"Category name, used when categoryId is omitted."`
	InstitutionID      string `json:"institutionId,omitempty"`
	Institution        string `json:"institution,omitempty" jsonschema:"Existing institution name, used when institutionId is omitted."`
	Currency           string `json:"currency" jsonschema:"ISO 4217 code enabled in the user's settings."`
	TrackingMode       string `json:"trackingMode,omitempty" jsonschema:"balance (default) or positions."`
	OpeningBalance     string `json:"openingBalance,omitempty" jsonschema:"Opening value as a plain decimal; 0 by default."`
	OpenedAt           string `json:"openedAt,omitempty" jsonschema:"Opening date, YYYY-MM-DD. Defaults to today."`
	IncludedInNetWorth *bool  `json:"includedInNetWorth,omitempty" jsonschema:"Defaults to true."`
	IdempotencyKey     string `json:"idempotencyKey" jsonschema:"A new random UUID for this account. Reuse it only to retry the same call."`
}

func (tools *toolset) createAccount(ctx context.Context, userID uuid.UUID, input createAccountInput) (AccountWriteResult, error) {
	key, err := idempotencyArg(input.IdempotencyKey, true)
	if err != nil {
		return AccountWriteResult{}, err
	}
	categoryID, err := tools.resolveCategory(ctx, userID, input.CategoryID, input.Category)
	if err != nil {
		return AccountWriteResult{}, err
	}
	institutionID, err := tools.resolveInstitution(ctx, userID, input.InstitutionID, input.Institution)
	if err != nil {
		return AccountWriteResult{}, err
	}
	currency := domain.NormalizeCurrency(input.Currency)
	opening := int64(0)
	if strings.TrimSpace(input.OpeningBalance) != "" {
		if opening, err = parseAmount("openingBalance", input.OpeningBalance, currency); err != nil {
			return AccountWriteResult{}, err
		}
	}
	openedAt, err := parseDate("openedAt", strings.TrimSpace(input.OpenedAt))
	if err != nil {
		return AccountWriteResult{}, err
	}
	trackingMode := strings.TrimSpace(input.TrackingMode)
	if trackingMode == "" {
		trackingMode = "balance"
	}
	id, err := tools.readers.Manage.Ledger.CreateAccount(ctx, userID, service.AccountMutationInput{
		IdempotencyKey: key, Name: input.Name, Description: input.Description, CategoryID: categoryID, InstitutionID: institutionID,
		Currency: currency, TrackingMode: trackingMode, OpeningValueMinor: opening, IsIncludedInNetWorth: boolOr(input.IncludedInNetWorth, true), OpenedAt: openedAt,
	})
	if err != nil {
		return AccountWriteResult{}, err
	}
	account, err := tools.accountAfterWrite(ctx, userID, id)
	return AccountWriteResult{Account: account}, err
}

type updateAccountInput struct {
	AccountID          string  `json:"accountId"`
	Name               *string `json:"name,omitempty"`
	Description        *string `json:"description,omitempty" jsonschema:"New description; an empty string clears it."`
	CategoryID         string  `json:"categoryId,omitempty"`
	Category           string  `json:"category,omitempty"`
	InstitutionID      string  `json:"institutionId,omitempty"`
	Institution        string  `json:"institution,omitempty"`
	ClearInstitution   bool    `json:"clearInstitution,omitempty"`
	IncludedInNetWorth *bool   `json:"includedInNetWorth,omitempty"`
	CostBasis          *string `json:"costBasis,omitempty" jsonschema:"Balance accounts only: amount invested, as a plain decimal; an empty string clears it."`
}

func (tools *toolset) updateAccount(ctx context.Context, userID uuid.UUID, input updateAccountInput) (AccountWriteResult, error) {
	accountID, err := parseID("accountId", input.AccountID)
	if err != nil {
		return AccountWriteResult{}, err
	}
	account, err := tools.readers.Core.Account(ctx, userID, accountID)
	if err != nil {
		return AccountWriteResult{}, err
	}
	mutation := service.AccountMutationInput{
		Name: account.Name, Description: account.Description, CategoryID: account.CategoryID, InstitutionID: account.InstitutionID,
		AccountReference: account.AccountReference, Currency: account.Currency, TrackingMode: account.TrackingMode,
		IsIncludedInNetWorth: account.IsIncludedInNetWorth, Notes: account.Notes,
	}
	if account.CostBasisMinor != nil {
		value, parseErr := service.ParseMinorUnits(*account.CostBasisMinor)
		if parseErr == nil {
			mutation.CostBasisMinor = &value
		}
	}
	if input.Name != nil {
		mutation.Name = *input.Name
	}
	if input.Description != nil {
		mutation.Description = *input.Description
	}
	if input.CategoryID != "" || input.Category != "" {
		if mutation.CategoryID, err = tools.resolveCategory(ctx, userID, input.CategoryID, input.Category); err != nil {
			return AccountWriteResult{}, err
		}
	}
	if input.ClearInstitution {
		mutation.InstitutionID = nil
	} else if input.InstitutionID != "" || input.Institution != "" {
		if mutation.InstitutionID, err = tools.resolveInstitution(ctx, userID, input.InstitutionID, input.Institution); err != nil {
			return AccountWriteResult{}, err
		}
	}
	mutation.IsIncludedInNetWorth = boolOr(input.IncludedInNetWorth, mutation.IsIncludedInNetWorth)
	if input.CostBasis != nil {
		if account.TrackingMode != "balance" {
			return AccountWriteResult{}, invalid("cost basis applies only to balance-tracked accounts; investment accounts derive it from trades")
		}
		mutation.CostBasisMinor = nil
		if strings.TrimSpace(*input.CostBasis) != "" {
			value, err := parseAmount("costBasis", *input.CostBasis, account.Currency)
			if err != nil {
				return AccountWriteResult{}, err
			}
			mutation.CostBasisMinor = &value
		}
	}
	if err := tools.readers.Manage.Ledger.UpdateAccount(ctx, userID, accountID, mutation); err != nil {
		return AccountWriteResult{}, err
	}
	updated, err := tools.accountAfterWrite(ctx, userID, accountID)
	return AccountWriteResult{Account: updated}, err
}

type archiveAccountInput struct {
	AccountID string `json:"accountId"`
	Restore   bool   `json:"restore,omitempty" jsonschema:"true to restore an archived account instead."`
}

func (tools *toolset) archiveAccount(ctx context.Context, userID uuid.UUID, input archiveAccountInput) (AccountWriteResult, error) {
	accountID, err := parseID("accountId", input.AccountID)
	if err != nil {
		return AccountWriteResult{}, err
	}
	if err := tools.readers.Manage.Ledger.SetAccountArchived(ctx, userID, accountID, !input.Restore); err != nil {
		return AccountWriteResult{}, err
	}
	account, err := tools.accountAfterWrite(ctx, userID, accountID)
	return AccountWriteResult{Account: account}, err
}

type accountHistoryInput struct {
	AccountID string `json:"accountId"`
	From      string `json:"from,omitempty" jsonschema:"First date, YYYY-MM-DD."`
	To        string `json:"to,omitempty" jsonschema:"Last date, YYYY-MM-DD."`
	Interval  string `json:"interval,omitempty" jsonschema:"month (default; the last value of each month) or day."`
}

type HistoryPoint struct {
	Date     string `json:"date"`
	Value    Money  `json:"value"`
	Complete bool   `json:"complete"`
}

type AccountHistoryResult struct {
	AccountID           string         `json:"accountId"`
	Currency            string         `json:"currency"`
	Interval            string         `json:"interval"`
	Points              []HistoryPoint `json:"points"`
	Truncated           bool           `json:"truncated" jsonschema:"True when only the most recent points are included."`
	HistoryComplete     bool           `json:"historyComplete"`
	CompletenessReasons []string       `json:"completenessReasons"`
}

const maxHistoryPoints = 400

func (tools *toolset) accountHistory(ctx context.Context, userID uuid.UUID, input accountHistoryInput) (AccountHistoryResult, error) {
	accountID, err := parseID("accountId", input.AccountID)
	if err != nil {
		return AccountHistoryResult{}, err
	}
	interval := input.Interval
	if interval == "" {
		interval = "month"
	}
	if interval != "month" && interval != "day" {
		return AccountHistoryResult{}, invalid("interval must be month or day")
	}
	from, to, err := dateRange(input.From, input.To)
	if err != nil {
		return AccountHistoryResult{}, err
	}
	account, err := tools.readers.Core.Account(ctx, userID, accountID)
	if err != nil {
		return AccountHistoryResult{}, err
	}
	if account.ArchivedAt != "" {
		return AccountHistoryResult{}, invalid("history isn't available for archived accounts")
	}
	analytics, err := tools.readers.Reports.AccountAnalytics(ctx, userID, accountID)
	if err != nil {
		return AccountHistoryResult{}, err
	}
	points := []HistoryPoint{}
	for _, point := range analytics.History {
		if (from != nil && point.Date < from.Format(time.DateOnly)) || (to != nil && point.Date > to.Format(time.DateOnly)) {
			continue
		}
		item := HistoryPoint{Date: point.Date, Value: money(point.ValueMinor, analytics.Currency), Complete: point.Complete}
		if interval == "month" && len(points) > 0 && points[len(points)-1].Date[:7] == point.Date[:7] {
			points[len(points)-1] = item
			continue
		}
		points = append(points, item)
	}
	recent, truncated := lastN(points, maxHistoryPoints)
	return AccountHistoryResult{AccountID: accountID.String(), Currency: analytics.Currency, Interval: interval, Points: recent, Truncated: truncated,
		HistoryComplete: analytics.HistoryComplete, CompletenessReasons: nonNil(analytics.CompletenessReasons)}, nil
}

type listValuationsInput struct {
	AccountID string `json:"accountId,omitempty"`
	From      string `json:"from,omitempty"`
	To        string `json:"to,omitempty"`
	Limit     int    `json:"limit,omitempty" jsonschema:"Rows per page, 1 to 100. Defaults to 50."`
	Offset    int    `json:"offset,omitempty"`
}

type ValuationsResult struct {
	Valuations []ValuationItem `json:"valuations"`
	Limit      int             `json:"limit"`
	Offset     int             `json:"offset"`
	HasMore    bool            `json:"hasMore"`
	NextOffset *int            `json:"nextOffset,omitempty"`
}

func (tools *toolset) listValuations(ctx context.Context, userID uuid.UUID, input listValuationsInput) (ValuationsResult, error) {
	page, err := pageArgs(input.Limit, input.Offset)
	if err != nil {
		return ValuationsResult{}, err
	}
	filter := service.ActivityFilter{Page: page}
	if filter.AccountID, err = optionalUUIDArg("accountId", input.AccountID); err != nil {
		return ValuationsResult{}, err
	}
	if filter.From, filter.To, err = dateRange(input.From, input.To); err != nil {
		return ValuationsResult{}, err
	}
	listed, err := tools.readers.Manage.Catalog.Valuations(ctx, userID, filter)
	if err != nil {
		return ValuationsResult{}, err
	}
	result := ValuationsResult{Valuations: []ValuationItem{}, Limit: listed.Limit, Offset: listed.Offset, HasMore: listed.HasMore, NextOffset: nextOffset(page, len(listed.Items), listed.HasMore)}
	for _, item := range listed.Items {
		result.Valuations = append(result.Valuations, ValuationItem{ID: item.ID.String(), AccountID: item.AccountID.String(), AccountName: item.AccountName,
			Value: money(item.ValueMinor, item.Currency), Date: item.ValuationDate})
	}
	return result, nil
}

type valuationInput struct {
	ValuationID string `json:"valuationId" jsonschema:"Valuation ID from list_valuations."`
}

type updateValuationInput struct {
	ValuationID string `json:"valuationId"`
	Value       string `json:"value,omitempty" jsonschema:"New value as a plain decimal in the account currency."`
	Date        string `json:"date,omitempty" jsonschema:"New date, YYYY-MM-DD."`
}

func (tools *toolset) updateValuation(ctx context.Context, userID uuid.UUID, input updateValuationInput) (RecordValuationResult, error) {
	valuationID, err := parseID("valuationId", input.ValuationID)
	if err != nil {
		return RecordValuationResult{}, err
	}
	existing, err := tools.readers.Manage.Ledger.GetValuation(ctx, userID, valuationID)
	if err != nil {
		return RecordValuationResult{}, err
	}
	value, err := service.ParseMinorUnits(existing.ValueMinor)
	if err != nil {
		return RecordValuationResult{}, err
	}
	if strings.TrimSpace(input.Value) != "" {
		if value, err = parseAmount("value", input.Value, existing.Currency); err != nil {
			return RecordValuationResult{}, err
		}
		if value < 0 {
			return RecordValuationResult{}, invalid("value can't be negative")
		}
	}
	dateText := existing.ValuationDate
	if strings.TrimSpace(input.Date) != "" {
		dateText = strings.TrimSpace(input.Date)
	}
	date, err := requiredDate("date", dateText)
	if err != nil {
		return RecordValuationResult{}, err
	}
	if err := tools.readers.Manage.Ledger.UpdateValuation(ctx, userID, valuationID, service.ValuationMutationInput{ValueMinor: value, ValuationDate: date, Notes: existing.Notes}); err != nil {
		return RecordValuationResult{}, err
	}
	account, err := tools.accountAfterWrite(ctx, userID, existing.AccountID)
	if err != nil {
		return RecordValuationResult{}, err
	}
	return RecordValuationResult{
		Valuation: ValuationItem{ID: valuationID.String(), AccountID: existing.AccountID.String(), AccountName: existing.AccountName, Value: moneyMinor(value, existing.Currency), Date: date.Format(time.DateOnly)},
		Account:   account,
	}, nil
}

type DeleteResult struct {
	DeletedIDs []string         `json:"deletedIds"`
	Accounts   []AccountSummary `json:"accounts" jsonschema:"Affected accounts after the change, with new balances."`
}

func (tools *toolset) accountsAfterWrite(ctx context.Context, userID uuid.UUID, ids []uuid.UUID) ([]AccountSummary, error) {
	result := []AccountSummary{}
	for _, id := range ids {
		account, err := tools.accountAfterWrite(ctx, userID, id)
		if err != nil {
			return nil, err
		}
		result = append(result, account)
	}
	return result, nil
}

func (tools *toolset) deleteValuation(ctx context.Context, userID uuid.UUID, input valuationInput) (DeleteResult, error) {
	valuationID, err := parseID("valuationId", input.ValuationID)
	if err != nil {
		return DeleteResult{}, err
	}
	existing, err := tools.readers.Manage.Ledger.GetValuation(ctx, userID, valuationID)
	if err != nil {
		return DeleteResult{}, err
	}
	if err := tools.readers.Manage.Ledger.DeleteValuation(ctx, userID, valuationID); err != nil {
		return DeleteResult{}, err
	}
	accounts, err := tools.accountsAfterWrite(ctx, userID, []uuid.UUID{existing.AccountID})
	return DeleteResult{DeletedIDs: []string{valuationID.String()}, Accounts: accounts}, err
}

type transactionInput struct {
	TransactionID string `json:"transactionId" jsonschema:"Transaction ID from list_transactions."`
}

type TransactionDetailResult struct {
	Transaction  TransactionItem `json:"transaction"`
	ExternalID   string          `json:"externalId,omitempty"`
	ImportID     string          `json:"importId,omitempty"`
	CashSnapshot *Money          `json:"cashSnapshot,omitempty" jsonschema:"Set for a synced cash balance: the cash this adjustment brings the account to."`
	Editable     bool            `json:"editable" jsonschema:"False for opening balances, transfers, and grouped investment activity."`
	UpdatedAt    string          `json:"updatedAt" jsonschema:"Pass as expectedUpdatedAt to update only if unchanged."`
	Notice       string          `json:"notice"`
}

func transactionItem(detail service.TransactionDetail) TransactionItem {
	return TransactionItem{ID: detail.ID.String(), AccountID: detail.AccountID.String(), AccountName: detail.AccountName, Type: detail.Type,
		Amount: money(detail.AmountMinor, detail.Currency), Date: detail.TransactionDate, Description: detail.Description, TransferGroupID: optionalID(detail.TransferGroupID)}
}

func (tools *toolset) getTransaction(ctx context.Context, userID uuid.UUID, input transactionInput) (TransactionDetailResult, error) {
	transactionID, err := parseID("transactionId", input.TransactionID)
	if err != nil {
		return TransactionDetailResult{}, err
	}
	detail, err := tools.readers.Manage.Ledger.GetTransaction(ctx, userID, transactionID)
	if err != nil {
		return TransactionDetailResult{}, err
	}
	result := TransactionDetailResult{Transaction: transactionItem(detail), ImportID: optionalID(detail.ImportBatchID),
		CashSnapshot: optionalMoney(detail.CashSnapshotMinor, detail.Currency), UpdatedAt: detail.UpdatedAt.UTC().Format(time.RFC3339Nano), Notice: untrustedTextNotice,
		Editable: detail.Type != "opening_balance" && detail.Type != "transfer" && detail.EventGroupID == nil}
	// Source IDs from imports stay on the server unless the connection may edit records.
	if tools.write {
		result.ExternalID = detail.ExternalID
	}
	return result, nil
}

type updateTransactionInput struct {
	TransactionID     string  `json:"transactionId"`
	Type              string  `json:"type,omitempty" jsonschema:"New type; one of record_transaction's types."`
	Amount            string  `json:"amount,omitempty" jsonschema:"New amount as a plain decimal in the account currency."`
	Date              string  `json:"date,omitempty" jsonschema:"New date, YYYY-MM-DD."`
	Description       *string `json:"description,omitempty" jsonschema:"New description; an empty string clears it."`
	ExternalID        *string `json:"externalId,omitempty" jsonschema:"New external ID; an empty string clears it."`
	ExpectedUpdatedAt string  `json:"expectedUpdatedAt,omitempty" jsonschema:"updatedAt from get_transaction; the update fails if the record changed since."`
}

type TransactionWriteResult struct {
	Transactions []TransactionItem `json:"transactions" jsonschema:"The changed transactions as stored."`
	Accounts     []AccountSummary  `json:"accounts" jsonschema:"Affected accounts after the change, with new balances."`
}

func (tools *toolset) prepareUpdate(ctx context.Context, userID uuid.UUID, input updateTransactionInput) (service.TransactionUpdate, error) {
	transactionID, err := parseID("transactionId", input.TransactionID)
	if err != nil {
		return service.TransactionUpdate{}, err
	}
	detail, err := tools.readers.Manage.Ledger.GetTransaction(ctx, userID, transactionID)
	if err != nil {
		return service.TransactionUpdate{}, err
	}
	update := service.TransactionUpdate{ID: transactionID, Input: service.TransactionMutationInput{
		AccountID: detail.AccountID, Type: detail.Type, Description: detail.Description, Notes: detail.Notes, ExternalID: detail.ExternalID,
	}}
	if update.Input.AmountMinor, err = service.ParseMinorUnits(detail.AmountMinor); err != nil {
		return service.TransactionUpdate{}, err
	}
	if input.Type != "" {
		if !transactionTypes[input.Type] || input.Type == "opening_balance" || input.Type == "transfer" {
			return service.TransactionUpdate{}, invalid("type must be one of %s", strings.Join(recordableTypes, ", "))
		}
		update.Input.Type = input.Type
	}
	if update.Input.Type != "manual_adjustment" && update.Input.AmountMinor < 0 {
		update.Input.AmountMinor = -update.Input.AmountMinor
	}
	if strings.TrimSpace(input.Amount) != "" {
		if update.Input.AmountMinor, err = parseAmount("amount", input.Amount, detail.Currency); err != nil {
			return service.TransactionUpdate{}, err
		}
	}
	dateText := detail.TransactionDate
	if strings.TrimSpace(input.Date) != "" {
		dateText = strings.TrimSpace(input.Date)
	}
	if update.Input.TransactionDate, err = requiredDate("date", dateText); err != nil {
		return service.TransactionUpdate{}, err
	}
	if input.Description != nil {
		update.Input.Description = strings.TrimSpace(*input.Description)
	}
	if input.ExternalID != nil {
		update.Input.ExternalID = strings.TrimSpace(*input.ExternalID)
	}
	if strings.TrimSpace(input.ExpectedUpdatedAt) != "" {
		expected, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(input.ExpectedUpdatedAt))
		if err != nil {
			return service.TransactionUpdate{}, invalid("expectedUpdatedAt must be the updatedAt value from get_transaction")
		}
		update.ExpectedUpdatedAt = &expected
	}
	return update, nil
}

func (tools *toolset) applyUpdates(ctx context.Context, userID uuid.UUID, updates []service.TransactionUpdate) (TransactionWriteResult, error) {
	changed, err := tools.readers.Manage.Ledger.BulkUpdateTransactions(ctx, userID, updates)
	if err != nil {
		return TransactionWriteResult{}, err
	}
	result := TransactionWriteResult{Transactions: []TransactionItem{}}
	for _, update := range updates {
		detail, err := tools.readers.Manage.Ledger.GetTransaction(ctx, userID, update.ID)
		if err != nil {
			return TransactionWriteResult{}, err
		}
		result.Transactions = append(result.Transactions, transactionItem(detail))
	}
	result.Accounts, err = tools.accountsAfterWrite(ctx, userID, changed.AccountIDs)
	return result, err
}

func (tools *toolset) updateTransaction(ctx context.Context, userID uuid.UUID, input updateTransactionInput) (TransactionWriteResult, error) {
	update, err := tools.prepareUpdate(ctx, userID, input)
	if err != nil {
		return TransactionWriteResult{}, err
	}
	return tools.applyUpdates(ctx, userID, []service.TransactionUpdate{update})
}

type bulkUpdateInput struct {
	Updates []updateTransactionInput `json:"updates" jsonschema:"Up to 1,000 updates, each like update_transaction."`
}

func (tools *toolset) bulkUpdateTransactions(ctx context.Context, userID uuid.UUID, input bulkUpdateInput) (TransactionWriteResult, error) {
	if len(input.Updates) == 0 || len(input.Updates) > service.MaxBulkLedgerRecords {
		return TransactionWriteResult{}, invalid("send between 1 and %d updates", service.MaxBulkLedgerRecords)
	}
	updates := make([]service.TransactionUpdate, 0, len(input.Updates))
	for index, item := range input.Updates {
		update, err := tools.prepareUpdate(ctx, userID, item)
		if err != nil {
			if safe, ok := err.(toolError); ok {
				return TransactionWriteResult{}, invalid("update %d: %s", index+1, safe.message)
			}
			return TransactionWriteResult{}, err
		}
		updates = append(updates, update)
	}
	return tools.applyUpdates(ctx, userID, updates)
}

func (tools *toolset) deleteTransactions(ctx context.Context, userID uuid.UUID, ids []uuid.UUID) (DeleteResult, error) {
	changed, err := tools.readers.Manage.Ledger.BulkDeleteTransactions(ctx, userID, ids)
	if err != nil {
		return DeleteResult{}, err
	}
	accounts, err := tools.accountsAfterWrite(ctx, userID, changed.AccountIDs)
	return DeleteResult{DeletedIDs: idStrings(ids), Accounts: accounts}, err
}

func (tools *toolset) deleteTransaction(ctx context.Context, userID uuid.UUID, input transactionInput) (DeleteResult, error) {
	transactionID, err := parseID("transactionId", input.TransactionID)
	if err != nil {
		return DeleteResult{}, err
	}
	return tools.deleteTransactions(ctx, userID, []uuid.UUID{transactionID})
}

type bulkDeleteInput struct {
	TransactionIDs []string `json:"transactionIds" jsonschema:"Up to 1,000 transaction IDs."`
}

func (tools *toolset) bulkDeleteTransactions(ctx context.Context, userID uuid.UUID, input bulkDeleteInput) (DeleteResult, error) {
	if len(input.TransactionIDs) == 0 || len(input.TransactionIDs) > service.MaxBulkLedgerRecords {
		return DeleteResult{}, invalid("send between 1 and %d transaction IDs", service.MaxBulkLedgerRecords)
	}
	ids, err := parseUUIDs("transactionIds", input.TransactionIDs)
	if err != nil {
		return DeleteResult{}, err
	}
	return tools.deleteTransactions(ctx, userID, ids)
}

type transferInput struct {
	FromAccountID     string `json:"fromAccountId"`
	ToAccountID       string `json:"toAccountId"`
	Amount            string `json:"amount" jsonschema:"Amount leaving the source account, in its currency, as a plain decimal."`
	DestinationAmount string `json:"destinationAmount,omitempty" jsonschema:"Amount arriving, in the destination currency, when it differs (for example after conversion)."`
	Date              string `json:"date" jsonschema:"YYYY-MM-DD, not in the future."`
	Description       string `json:"description,omitempty"`
	IdempotencyKey    string `json:"idempotencyKey" jsonschema:"A new random UUID for this transfer. Reuse it only to retry the same call."`
}

type TransferResult struct {
	TransferGroupID string         `json:"transferGroupId"`
	From            AccountSummary `json:"from"`
	To              AccountSummary `json:"to"`
}

func (tools *toolset) transfer(ctx context.Context, userID uuid.UUID, input transferInput) (TransferResult, error) {
	key, err := idempotencyArg(input.IdempotencyKey, true)
	if err != nil {
		return TransferResult{}, err
	}
	fromID, err := parseID("fromAccountId", input.FromAccountID)
	if err != nil {
		return TransferResult{}, err
	}
	toID, err := parseID("toAccountId", input.ToAccountID)
	if err != nil {
		return TransferResult{}, err
	}
	from, err := tools.readers.Core.Account(ctx, userID, fromID)
	if err != nil {
		return TransferResult{}, err
	}
	to, err := tools.readers.Core.Account(ctx, userID, toID)
	if err != nil {
		return TransferResult{}, err
	}
	amount, err := parseAmount("amount", input.Amount, from.Currency)
	if err != nil {
		return TransferResult{}, err
	}
	destination := int64(0)
	if strings.TrimSpace(input.DestinationAmount) != "" {
		if destination, err = parseAmount("destinationAmount", input.DestinationAmount, to.Currency); err != nil {
			return TransferResult{}, err
		}
	}
	date, err := requiredDate("date", input.Date)
	if err != nil {
		return TransferResult{}, err
	}
	groupID, err := tools.readers.Manage.Ledger.CreateTransfer(ctx, userID, service.TransferMutationInput{
		IdempotencyKey: *key, FromAccountID: fromID, ToAccountID: toID, SourceAmountMinor: amount, DestinationAmountMinor: destination,
		TransactionDate: date, Description: input.Description,
	})
	if err != nil {
		return TransferResult{}, err
	}
	result := TransferResult{TransferGroupID: groupID.String()}
	if result.From, err = tools.accountAfterWrite(ctx, userID, fromID); err != nil {
		return TransferResult{}, err
	}
	result.To, err = tools.accountAfterWrite(ctx, userID, toID)
	return result, err
}
