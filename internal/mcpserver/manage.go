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

// LedgerManager edits accounts, transactions, transfers, and valuations.
type LedgerManager interface {
	CreateAccount(context.Context, uuid.UUID, service.AccountMutationInput) (uuid.UUID, error)
	UpdateAccount(context.Context, uuid.UUID, uuid.UUID, service.AccountMutationInput) error
	SetAccountArchived(context.Context, uuid.UUID, uuid.UUID, bool) error
	GetTransaction(context.Context, uuid.UUID, uuid.UUID) (service.TransactionDetail, error)
	BulkUpdateTransactions(context.Context, uuid.UUID, []service.TransactionUpdate) (service.LedgerBulkResult, error)
	BulkDeleteTransactions(context.Context, uuid.UUID, []uuid.UUID) (service.LedgerBulkResult, error)
	CreateTransfer(context.Context, uuid.UUID, service.TransferMutationInput) (uuid.UUID, error)
	GetValuation(context.Context, uuid.UUID, uuid.UUID) (service.ValuationDetail, error)
	UpdateValuation(context.Context, uuid.UUID, uuid.UUID, service.ValuationMutationInput) error
	DeleteValuation(context.Context, uuid.UUID, uuid.UUID) error
}

// CatalogReader reads categories, institutions, and valuations.
type CatalogReader interface {
	Categories(context.Context, uuid.UUID) ([]service.Category, error)
	Institutions(context.Context, uuid.UUID) ([]service.Institution, error)
	Valuations(context.Context, uuid.UUID, service.ActivityFilter) (service.Page[service.Valuation], error)
}

type StatementImporter interface {
	Import(context.Context, uuid.UUID, service.StatementImportInput) (service.StatementImportResult, error)
	Reconcile(context.Context, uuid.UUID, service.StatementImportInput) (service.StatementImportResult, error)
}

type ImportHistory interface {
	List(context.Context, uuid.UUID, service.ImportBatchFilter) (service.Page[service.ImportBatch], error)
	Rollback(context.Context, uuid.UUID, uuid.UUID) (service.RollbackResult, error)
	ReconciliationStatus(context.Context, uuid.UUID, *uuid.UUID) ([]service.ReconciliationStatus, error)
}

type InvestmentManager interface {
	CreateInstrument(context.Context, uuid.UUID, service.InstrumentMutationInput) (uuid.UUID, error)
	UpdateInstrument(context.Context, uuid.UUID, uuid.UUID, service.InstrumentMutationInput) error
	SyncPositions(context.Context, uuid.UUID, service.PositionSyncInput) (service.PositionSyncResult, error)
	ImportTrades(context.Context, uuid.UUID, service.TradeImportInput) (service.TradeImportResult, error)
	BulkUpsertPrices(context.Context, uuid.UUID, []service.PriceInput) (service.PriceUpsertResult, error)
	DeleteSecurityPrice(context.Context, uuid.UUID, uuid.UUID) error
	DeletePosition(context.Context, uuid.UUID, uuid.UUID, service.InstrumentRef, *time.Time, bool) (service.DeletePositionResult, error)
}

type FeatureReader interface {
	Instruments(context.Context, uuid.UUID) ([]service.Instrument, error)
	Instrument(context.Context, uuid.UUID, uuid.UUID) (service.InstrumentDetail, error)
	PriceHistory(context.Context, uuid.UUID, uuid.UUID, *time.Time, *time.Time, int) (service.PriceHistoryRead, error)
	ExchangeRates(context.Context, uuid.UUID, service.ExchangeRateFilter) (service.Page[service.ExchangeRateRead], error)
	TaxReport(context.Context, uuid.UUID, int, *uuid.UUID) (service.TaxReportRead, error)
}

type RateManager interface {
	UpsertExchangeRates(context.Context, uuid.UUID, []service.ExchangeRateUpsert) (service.ExchangeRateUpsertResult, error)
	DeleteExchangeRate(context.Context, uuid.UUID, uuid.UUID) error
}

type GoalManager interface {
	CreateGoal(context.Context, uuid.UUID, service.GoalMutationInput) (service.GoalMutationResult, error)
	UpdateGoal(context.Context, uuid.UUID, uuid.UUID, service.GoalMutationInput) error
	DeleteGoal(context.Context, uuid.UUID, uuid.UUID) error
	CreateMilestone(context.Context, uuid.UUID, uuid.UUID, service.GoalMilestoneInput) (uuid.UUID, error)
	DeleteMilestone(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error
}

type GoalSimulator interface {
	CalculateGoalScenarios(context.Context, uuid.UUID, uuid.UUID, service.GoalScenarioInput) (service.GoalScenariosRead, error)
}

type PerformanceReader interface {
	PerformanceReport(context.Context, uuid.UUID, string) (service.PerformanceReportRead, error)
}

type AuditLogger interface {
	Record(context.Context, uuid.UUID, service.AuditEntry) error
	List(context.Context, uuid.UUID, service.AuditFilter) (service.Page[service.AuditEntry], error)
}

// Management holds the services behind the management tools. Read tools are offered to
// detailed connections and write tools to connections with portfolio:write, once every
// service is set. Each service derives ownership from the userId the tool passes.
type Management struct {
	Ledger      LedgerManager
	Catalog     CatalogReader
	Statements  StatementImporter
	Imports     ImportHistory
	Investments InvestmentManager
	Features    FeatureReader
	Rates       RateManager
	Goals       GoalManager
	Simulator   GoalSimulator
	Performance PerformanceReader
	Audit       AuditLogger
}

func (management *Management) complete() bool {
	return management != nil && management.Ledger != nil && management.Catalog != nil && management.Statements != nil &&
		management.Imports != nil && management.Investments != nil && management.Features != nil && management.Rates != nil &&
		management.Goals != nil && management.Simulator != nil && management.Performance != nil && management.Audit != nil
}

// auditRef names the records a successful write changed. A write that changed nothing,
// such as a preview or a rejected import, sets skip.
type auditRef struct {
	skip       bool
	recordType string
	ids        []uuid.UUID
	accountID  *uuid.UUID
	batchID    *uuid.UUID
}

// handleWrite runs a write tool like handle and then records an audit entry with the
// changed record IDs. An audit failure is logged; the change itself already committed.
func handleWrite[In, Out any](tools *toolset, action string, run func(context.Context, uuid.UUID, In) (Out, error), audit func(In, Out) auditRef) mcp.ToolHandlerFor[In, Out] {
	inner := handle(tools, run)
	return func(ctx context.Context, request *mcp.CallToolRequest, input In) (*mcp.CallToolResult, Out, error) {
		result, output, err := inner(ctx, request, input)
		if err != nil || tools.readers.Manage == nil || tools.readers.Manage.Audit == nil {
			return result, output, err
		}
		ref := audit(input, output)
		if ref.skip {
			return result, output, err
		}
		userID, _ := principalUserID(request)
		client := ""
		if request.Extra != nil && request.Extra.TokenInfo != nil {
			client, _ = request.Extra.TokenInfo.Extra[rateKeyExtra].(string)
		}
		entry := service.AuditEntry{Channel: "mcp", Client: client, Tool: request.Params.Name, Action: action, RecordType: ref.recordType,
			RecordIDs: ref.ids, AccountID: ref.accountID, ImportBatchID: ref.batchID}
		if recordErr := tools.readers.Manage.Audit.Record(ctx, userID, entry); recordErr != nil {
			tools.logger.ErrorContext(ctx, "record MCP audit event", "tool", request.Params.Name, "error", recordErr)
		}
		return result, output, err
	}
}

// safeServiceMessage maps the service layer's expected errors to text that is safe to
// show the assistant. It reports false for unexpected errors.
func safeServiceMessage(err error) (string, bool) {
	if detail, ok := service.PublicDetail(err); ok {
		return detail, true
	}
	var metadata *service.MetadataError
	if errors.As(err, &metadata) {
		if metadata.Kind == service.MetadataNotFound {
			return notFoundMessage, true
		}
		return metadata.Detail, true
	}
	// Goal service messages are fixed text without user data, like ledger messages.
	if detail, ok := sentinelDetail(err, service.ErrGoalMutationValidation, service.ErrGoalMutationConflict); ok {
		return detail, true
	}
	switch {
	case errors.Is(err, service.ErrInvestmentMutationNotFound), errors.Is(err, service.ErrGoalMutationNotFound), errors.Is(err, service.ErrImportNotFound):
		return notFoundMessage, true
	case errors.Is(err, service.ErrInvestmentMutationValidation), errors.Is(err, service.ErrInvestmentMutationConflict),
		errors.Is(err, service.ErrGoalMutationValidation), errors.Is(err, service.ErrGoalMutationConflict),
		errors.Is(err, service.ErrImportValidation), errors.Is(err, service.ErrImportConflict):
		return "Wealthboard rejected this change. Check the details and try again.", true
	case errors.Is(err, service.ErrGoalsReportsInvalidInput):
		return "The simulation inputs are invalid: use a contribution of zero or more and a return between 0 and 100 percent.", true
	}
	return "", false
}

// sentinelDetail returns the text after a "<sentinel>: " prefix when err wraps one of sentinels.
func sentinelDetail(err error, sentinels ...error) (string, bool) {
	for _, sentinel := range sentinels {
		if errors.Is(err, sentinel) {
			detail := strings.TrimPrefix(err.Error(), sentinel.Error()+": ")
			if detail != "" && detail != err.Error() {
				return detail, true
			}
		}
	}
	return "", false
}

const notFoundMessage = "No matching record was found for this user."

func moneyMinor(minor int64, currency string) Money {
	return money(strconv.FormatInt(minor, 10), currency)
}

func parseUUIDs(name string, values []string) ([]uuid.UUID, error) {
	ids := make([]uuid.UUID, 0, len(values))
	for _, value := range values {
		id, err := parseID(name, value)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

func optionalUUIDArg(name, value string) (*uuid.UUID, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	id, err := parseID(name, value)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func idempotencyArg(value string, required bool) (*uuid.UUID, error) {
	if strings.TrimSpace(value) == "" {
		if required {
			return nil, invalid("idempotencyKey must be a UUID. %s", idempotencyKeyHelp)
		}
		return nil, nil
	}
	key, err := uuid.Parse(strings.TrimSpace(value))
	if err != nil || key == uuid.Nil {
		return nil, invalid("idempotencyKey must be a UUID. %s", idempotencyKeyHelp)
	}
	return &key, nil
}

func requiredDate(name, value string) (time.Time, error) {
	if strings.TrimSpace(value) == "" {
		return time.Time{}, invalid("%s is required, as YYYY-MM-DD", name)
	}
	date, err := parseDate(name, strings.TrimSpace(value))
	if err != nil {
		return time.Time{}, err
	}
	return *date, nil
}

func pageArgs(limit, offset int) (service.ReadPage, error) {
	if limit == 0 {
		limit = defaultTransactionPage
	}
	if limit < 1 || limit > service.MaxReadLimit {
		return service.ReadPage{}, invalid("limit must be between 1 and %d", service.MaxReadLimit)
	}
	if offset < 0 || offset > service.MaxReadOffset {
		return service.ReadPage{}, invalid("offset must be between 0 and %d", service.MaxReadOffset)
	}
	return service.ReadPage{Limit: limit, Offset: offset}, nil
}

func nextOffset(page service.ReadPage, count int, hasMore bool) *int {
	if !hasMore {
		return nil
	}
	next := page.Offset + count
	return &next
}

func dateRange(from, to string) (*time.Time, *time.Time, error) {
	fromDate, err := parseDate("from", strings.TrimSpace(from))
	if err != nil {
		return nil, nil, err
	}
	toDate, err := parseDate("to", strings.TrimSpace(to))
	if err != nil {
		return nil, nil, err
	}
	if fromDate != nil && toDate != nil && fromDate.After(*toDate) {
		return nil, nil, invalid("from must not be after to")
	}
	return fromDate, toDate, nil
}

// decimalPercent formats basis points as a percentage string, for example 800 as "8.00".
func decimalPercent(bps int32) string {
	text, _ := domain.FormatMinorUnits(strconv.FormatInt(int64(bps), 10), "USD")
	return text
}

func idStrings(ids []uuid.UUID) []string {
	result := make([]string, 0, len(ids))
	for _, id := range ids {
		result = append(result, id.String())
	}
	return result
}

func boolOr(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

// mustID parses an ID this package formatted; an empty or invalid value yields nil.
func mustID(value string) *uuid.UUID {
	id, err := uuid.Parse(value)
	if err != nil {
		return nil
	}
	return &id
}

func mustIDs(values ...string) []uuid.UUID {
	ids := []uuid.UUID{}
	for _, value := range values {
		if id := mustID(value); id != nil {
			ids = append(ids, *id)
		}
	}
	return ids
}
