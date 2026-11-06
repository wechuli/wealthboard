package mcpserver

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/wechuli/wealthboard/internal/domain"
	"github.com/wechuli/wealthboard/internal/service"
)

// recordableTypes are the transaction types the ledger accepts outside the opening
// balance and transfer workflows.
var recordableTypes = []string{
	"deposit", "withdrawal", "interest", "dividend", "capital_gain", "capital_loss", "fee",
	"purchase", "sale", "manual_adjustment", "liability_payment", "liability_increase",
}

func writeAnnotations(title string) *mcp.ToolAnnotations {
	closed, destructive := false, false
	return &mcp.ToolAnnotations{Title: title, IdempotentHint: true, DestructiveHint: &destructive, OpenWorldHint: &closed}
}

func (tools *toolset) registerWrites(server *mcp.Server) {
	addTool(server, &mcp.Tool{
		Name: "record_transaction",
		Description: "Add one transaction to one of the user's accounts and return it with the account's new balance. " +
			"Use only when the user explicitly asks to record it, and confirm the details first. It can't edit or delete records. " +
			"Types: " + strings.Join(recordableTypes, ", ") + ". Investment (position-tracked) accounts accept only deposit, withdrawal, interest, dividend, fee, and manual_adjustment; trades are recorded in Wealthboard.",
		Annotations: writeAnnotations("Record a transaction"),
	}, handle(tools, tools.recordTransaction))
	addTool(server, &mcp.Tool{
		Name: "record_valuation",
		Description: "Set a balance-tracked account's value on a date, for example from a statement, and return the account's new balance. " +
			"A valuation sets the balance; it is not a contribution. Use only when the user explicitly asks, and confirm the details first. It can't edit or delete records.",
		Annotations: writeAnnotations("Record a valuation"),
	}, handle(tools, tools.recordValuation))
}

const idempotencyKeyHelp = "A new random UUID for this record. Reuse it only to retry the same call; reusing it with different details fails."

type recordTransactionInput struct {
	AccountID      string `json:"accountId" jsonschema:"Account ID from list_accounts."`
	Type           string `json:"type" jsonschema:"Transaction type, for example deposit, withdrawal, interest, dividend, or fee."`
	Amount         string `json:"amount" jsonschema:"Positive amount in the account's currency as a plain decimal string, such as 1500.00. Only manual_adjustment may be negative. No currency symbols or thousands separators."`
	Date           string `json:"date" jsonschema:"Transaction date, YYYY-MM-DD, not in the future."`
	Description    string `json:"description,omitempty" jsonschema:"Short description, at most 200 characters."`
	IdempotencyKey string `json:"idempotencyKey" jsonschema:"A new random UUID for this record. Reuse it only to retry the same call; reusing it with different details fails."`
}

func (tools *toolset) recordTransaction(ctx context.Context, userID uuid.UUID, input recordTransactionInput) (RecordTransactionResult, error) {
	account, key, date, err := tools.writeTarget(ctx, userID, input.AccountID, input.IdempotencyKey, input.Date)
	if err != nil {
		return RecordTransactionResult{}, err
	}
	if !transactionTypes[input.Type] || input.Type == "opening_balance" || input.Type == "transfer" {
		return RecordTransactionResult{}, invalid("type must be one of %s", strings.Join(recordableTypes, ", "))
	}
	amount, err := parseAmount("amount", input.Amount, account.Currency)
	if err != nil {
		return RecordTransactionResult{}, err
	}
	description := strings.TrimSpace(input.Description)
	id, err := tools.readers.Ledger.CreateTransaction(ctx, userID, service.TransactionMutationInput{
		IdempotencyKey: key, AccountID: account.ID, Type: input.Type, AmountMinor: amount, TransactionDate: date, Description: description,
	})
	if err != nil {
		return RecordTransactionResult{}, err
	}
	updated, err := tools.accountAfterWrite(ctx, userID, account.ID)
	if err != nil {
		return RecordTransactionResult{}, err
	}
	return RecordTransactionResult{
		Transaction: TransactionItem{
			ID: id.String(), AccountID: account.ID.String(), AccountName: account.Name, Type: input.Type,
			Amount: money(strconv.FormatInt(amount, 10), account.Currency), Date: date.Format(time.DateOnly), Description: description,
		},
		Account: updated,
	}, nil
}

type recordValuationInput struct {
	AccountID      string `json:"accountId" jsonschema:"Account ID of a balance-tracked account from list_accounts."`
	Value          string `json:"value" jsonschema:"The account's value on the date, in its currency, as a plain decimal string such as 25000.00. Not negative. No currency symbols or thousands separators."`
	Date           string `json:"date" jsonschema:"Valuation date, YYYY-MM-DD, not in the future."`
	IdempotencyKey string `json:"idempotencyKey" jsonschema:"A new random UUID for this record. Reuse it only to retry the same call; reusing it with different details fails."`
}

func (tools *toolset) recordValuation(ctx context.Context, userID uuid.UUID, input recordValuationInput) (RecordValuationResult, error) {
	account, key, date, err := tools.writeTarget(ctx, userID, input.AccountID, input.IdempotencyKey, input.Date)
	if err != nil {
		return RecordValuationResult{}, err
	}
	if account.TrackingMode != "balance" {
		return RecordValuationResult{}, invalid("investment (position-tracked) accounts are valued from instrument prices; record a valuation only for a balance-tracked account")
	}
	value, err := parseAmount("value", input.Value, account.Currency)
	if err != nil {
		return RecordValuationResult{}, err
	}
	if value < 0 {
		return RecordValuationResult{}, invalid("value can't be negative")
	}
	id, err := tools.readers.Ledger.CreateValuation(ctx, userID, service.ValuationMutationInput{
		IdempotencyKey: key, AccountID: account.ID, ValueMinor: value, ValuationDate: date,
	})
	if err != nil {
		return RecordValuationResult{}, err
	}
	updated, err := tools.accountAfterWrite(ctx, userID, account.ID)
	if err != nil {
		return RecordValuationResult{}, err
	}
	return RecordValuationResult{
		Valuation: ValuationItem{
			ID: id.String(), AccountID: account.ID.String(), AccountName: account.Name,
			Value: money(strconv.FormatInt(value, 10), account.Currency), Date: date.Format(time.DateOnly),
		},
		Account: updated,
	}, nil
}

// writeTarget validates the common write arguments and loads the account through
// the owner-scoped reader, so another user's account is reported as not found.
func (tools *toolset) writeTarget(ctx context.Context, userID uuid.UUID, accountText, keyText, dateText string) (service.Account, uuid.UUID, time.Time, error) {
	accountID, err := parseID("accountId", accountText)
	if err != nil {
		return service.Account{}, uuid.Nil, time.Time{}, err
	}
	key, err := uuid.Parse(strings.TrimSpace(keyText))
	if err != nil || key == uuid.Nil {
		return service.Account{}, uuid.Nil, time.Time{}, invalid("idempotencyKey must be a UUID. %s", idempotencyKeyHelp)
	}
	if strings.TrimSpace(dateText) == "" {
		return service.Account{}, uuid.Nil, time.Time{}, invalid("date is required, as YYYY-MM-DD")
	}
	date, err := parseDate("date", strings.TrimSpace(dateText))
	if err != nil {
		return service.Account{}, uuid.Nil, time.Time{}, err
	}
	account, err := tools.readers.Core.Account(ctx, userID, accountID)
	if err != nil {
		return service.Account{}, uuid.Nil, time.Time{}, err
	}
	if account.ArchivedAt != "" {
		return service.Account{}, uuid.Nil, time.Time{}, invalid("this account is archived; the user can restore it in Wealthboard before recording activity")
	}
	return account, key, *date, nil
}

func (tools *toolset) accountAfterWrite(ctx context.Context, userID, accountID uuid.UUID) (AccountSummary, error) {
	settings, err := tools.readers.Core.Settings(ctx, userID)
	if err != nil {
		return AccountSummary{}, err
	}
	account, err := tools.readers.Core.Account(ctx, userID, accountID)
	if err != nil {
		return AccountSummary{}, err
	}
	return accountSummary(account, settings.BaseCurrency), nil
}

func parseAmount(name, value, currency string) (int64, error) {
	amount, err := domain.ParseDecimalAmount(value, currency)
	if err != nil {
		return 0, invalid("%s: %s", name, strings.TrimPrefix(err.Error(), domain.ErrInvalidAmount.Error()+": "))
	}
	return amount, nil
}

func ledgerMessage(err error) string {
	message := err.Error()
	for _, sentinel := range []error{service.ErrLedgerValidation, service.ErrLedgerConflict} {
		if errors.Is(err, sentinel) {
			message = strings.TrimPrefix(message, sentinel.Error()+": ")
		}
	}
	if message == service.ErrLedgerValidation.Error() || message == service.ErrLedgerConflict.Error() {
		return "Wealthboard rejected this change. Check the details and try again."
	}
	return message
}
