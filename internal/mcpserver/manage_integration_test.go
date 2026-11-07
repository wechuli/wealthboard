package mcpserver

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http/httptest"

	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/database/generated"
	"github.com/wechuli/wealthboard/internal/service"
)

var managementReadTools = []string{
	"list_categories", "get_account_history", "list_valuations", "get_transaction", "reconcile_transactions", "get_import_history",
	"get_reconciliation_status", "list_instruments", "get_price_history", "simulate_goal", "get_exchange_rates", "get_performance_report",
	"get_tax_report", "get_portfolio_history", "get_audit_log",
}

var managementWriteTools = []string{
	"create_account", "update_account", "archive_account", "update_valuation", "delete_valuation", "update_transaction", "bulk_update_transactions",
	"delete_transaction", "bulk_delete_transactions", "transfer_between_accounts", "bulk_create_transactions", "preview_import", "commit_import",
	"rollback_import", "create_instrument", "update_instrument", "bulk_upsert_positions", "upsert_position", "update_cash_balance", "delete_position",
	"record_trade", "bulk_import_trades", "update_price", "bulk_update_prices", "delete_price", "create_goal", "update_goal", "delete_goal",
	"upsert_exchange_rate", "bulk_upsert_exchange_rates", "delete_exchange_rate",
}

func newManagementServer(t *testing.T, db *sql.DB) string {
	t.Helper()
	core := service.NewCoreReadService(service.NewSQLCoreReadRepository(db))
	reports := service.NewGoalsReportsService(service.NewSQLGoalsReportsRepository(db))
	insights := service.NewInsightsService(service.NewSQLGoalsReportsRepository(db))
	ledger := service.NewLedgerService(db)
	manage := &Management{Ledger: ledger, Catalog: core, Statements: service.NewStatementImportService(db), Imports: service.NewImportBatchService(db),
		Investments: service.NewInvestmentMutations(db), Features: service.NewFeatureReads(db), Rates: service.NewMetadataMutations(db),
		Goals: service.NewGoalMutationService(service.NewSQLGoalMutationRepository(db)), Simulator: reports, Performance: insights, Audit: service.NewAuditLog(db)}
	server := httptest.NewServer(NewHandler(Readers{Core: core, Reports: reports, Insights: insights, Ledger: ledger, Manage: manage},
		webauth.NewAPIKeyService(generated.New(db)), Options{RequestsPerMinute: 10000}))
	t.Cleanup(server.Close)
	return server.URL
}

func apiKey(t *testing.T, db *sql.DB, userID uuid.UUID, scopes ...webauth.Scope) string {
	t.Helper()
	key, err := webauth.NewAPIKeyService(generated.New(db)).Create(context.Background(), userID, "assistant-"+uuid.NewString()[:8], scopes, nil)
	if err != nil {
		t.Fatal(err)
	}
	return key.Token
}

func TestPostgreSQLManagementToolsAreDiscoverableByAccessLevel(t *testing.T) {
	db := openTestDatabase(t)
	owner := seedUser(t, context.Background(), db, "owner", 100_000, 1, "Salary")
	endpoint := newManagementServer(t, db)
	readNames := strings.Split(toolNames(t, endpoint, apiKey(t, db, owner.userID, webauth.ScopePortfolioRead)), ",")
	writeNames := strings.Split(toolNames(t, endpoint, apiKey(t, db, owner.userID, webauth.ScopePortfolioRead, webauth.ScopePortfolioWrite)), ",")
	for _, name := range managementReadTools {
		if !containsName(readNames, name) || !containsName(writeNames, name) {
			t.Errorf("read tool %s missing", name)
		}
	}
	for _, name := range append(managementWriteTools, "record_transaction", "record_valuation") {
		if containsName(readNames, name) {
			t.Errorf("read-only key sees write tool %s", name)
		}
		if !containsName(writeNames, name) {
			t.Errorf("write tool %s missing", name)
		}
	}
	tools, err := connect(t, endpoint, apiKey(t, db, owner.userID, webauth.ScopePortfolioRead, webauth.ScopePortfolioWrite)).ListTools(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range tools.Tools {
		for kind, schema := range map[string]any{"input": tool.InputSchema, "output": tool.OutputSchema} {
			if encoded, _ := json.Marshal(schema); strings.Contains(string(encoded), `"type":[`) {
				t.Errorf("%s %s schema has a multi-type union", tool.Name, kind)
			}
		}
		if tool.Description == "" || tool.Annotations == nil {
			t.Errorf("%s lacks a description or annotations", tool.Name)
		}
	}
}

func TestPostgreSQLManagementWorkflowsWriteExactRecordsForTheOwner(t *testing.T) {
	db := openTestDatabase(t)
	ctx := context.Background()
	owner := seedUser(t, ctx, db, "owner", 43_333_363, 1, "Seed")
	other := seedUser(t, ctx, db, "other", 100, 1, "Other")
	endpoint := newManagementServer(t, db)
	session := connect(t, endpoint, apiKey(t, db, owner.userID, webauth.ScopePortfolioRead, webauth.ScopePortfolioWrite))
	before := structured[AccountDetail](t, call(t, session, "get_account", map[string]any{"accountId": owner.accountID.String()})).Account.Balance

	rows := []map[string]any{}
	for day := 0; day < 51; day++ {
		date := time.Date(2026, time.September, 17, 0, 0, 0, 0, time.UTC).AddDate(0, 0, day).Format(time.DateOnly)
		rows = append(rows, map[string]any{"externalId": "etica-" + date + "-interest", "date": date, "type": "interest", "amount": "122.61", "currency": "KES", "description": "Daily net interest"})
	}
	rows = append(rows,
		map[string]any{"externalId": "etica-2026-10-06-deposit", "date": "2026-10-06", "type": "deposit", "amount": "130000.00", "currency": "KES"},
		map[string]any{"externalId": "etica-2026-10-20-deposit", "date": "2026-10-20", "type": "deposit", "amount": "130000.00", "currency": "KES"})
	statement := map[string]any{"accountId": owner.accountID.String(), "source": "etica_statement", "transactions": rows}
	preview := structured[StatementImportOutput](t, call(t, session, "preview_import", statement))
	if preview.Status != "preview" || preview.Created != 53 || preview.Hash == "" {
		t.Fatalf("preview = %+v", preview)
	}
	if missing := call(t, session, "commit_import", statement); !missing.IsError || !strings.Contains(text(missing), "hash") {
		t.Fatalf("commit without hash = %s", text(missing))
	}
	statement["hash"] = preview.Hash
	committed := structured[StatementImportOutput](t, call(t, session, "commit_import", statement))
	wantAfter := 43_333_363 + 1 + 51*12_261 + 2*13_000_000
	if committed.Status != "completed" || committed.Created != 53 || committed.ImportID == "" || committed.BalanceBefore != before ||
		committed.BalanceAfter.Minor != fmt.Sprint(wantAfter) {
		t.Fatalf("commit = %+v (before %+v)", committed, before)
	}
	again := structured[StatementImportOutput](t, call(t, session, "bulk_create_transactions", map[string]any{"accountId": owner.accountID.String(), "transactions": rows}))
	if again.Created != 0 || again.Duplicates != 53 {
		t.Fatalf("second import = %+v", again)
	}
	history := structured[ImportHistoryResult](t, call(t, session, "get_import_history", map[string]any{"accountId": owner.accountID.String()}))
	if len(history.Imports) != 1 || history.Imports[0].ID != committed.ImportID || history.Imports[0].Counts.Created != 53 || history.Imports[0].TransactionCount != 53 {
		t.Fatalf("history = %+v", history)
	}
	audit := structured[AuditLogResult](t, call(t, session, "get_audit_log", map[string]any{"tool": "commit_import"}))
	if len(audit.Entries) != 1 || audit.Entries[0].ImportID != committed.ImportID || len(audit.Entries[0].RecordIDs) != 53 || !strings.HasPrefix(audit.Entries[0].Client, "key:") {
		t.Fatalf("audit = %+v", audit)
	}

	createdID := committed.Rows[0].TransactionID
	detail := structured[TransactionDetailResult](t, call(t, session, "get_transaction", map[string]any{"transactionId": createdID}))
	if !detail.Editable || detail.ImportID != committed.ImportID || detail.ExternalID != "etica-2026-09-17-interest" {
		t.Fatalf("detail = %+v", detail)
	}
	reader := connect(t, endpoint, apiKey(t, db, owner.userID, webauth.ScopePortfolioRead))
	if hidden := structured[TransactionDetailResult](t, call(t, reader, "get_transaction", map[string]any{"transactionId": createdID})); hidden.ExternalID != "" || hidden.ImportID != committed.ImportID {
		t.Fatalf("read-only detail exposes the source ID: %+v", hidden)
	}
	if stale := call(t, session, "update_transaction", map[string]any{"transactionId": createdID, "amount": "1", "expectedUpdatedAt": "2020-01-01T00:00:00Z"}); !stale.IsError || !strings.Contains(text(stale), "changed after it was read") {
		t.Fatalf("stale update = %s", text(stale))
	}
	if invalidAmount := call(t, session, "update_transaction", map[string]any{"transactionId": createdID, "amount": "1.005"}); !invalidAmount.IsError || !strings.Contains(text(invalidAmount), "decimal places") {
		t.Fatalf("invalid amount = %s", text(invalidAmount))
	}
	updated := structured[TransactionWriteResult](t, call(t, session, "update_transaction", map[string]any{"transactionId": createdID, "amount": "100.00", "expectedUpdatedAt": detail.UpdatedAt}))
	if updated.Transactions[0].Amount.Minor != "10000" || updated.Accounts[0].Balance.Minor != fmt.Sprint(wantAfter-2_261) {
		t.Fatalf("update = %+v", updated)
	}
	if rollback := call(t, session, "rollback_import", map[string]any{"importId": committed.ImportID}); !rollback.IsError || !strings.Contains(text(rollback), "edited after the import") {
		t.Fatalf("rollback of edited import = %s", text(rollback))
	}
	deleted := structured[DeleteResult](t, call(t, session, "delete_transaction", map[string]any{"transactionId": createdID}))
	if deleted.Accounts[0].Balance.Minor != fmt.Sprint(wantAfter-12_261) {
		t.Fatalf("delete = %+v", deleted)
	}
	rolledBack := structured[RollbackOutput](t, call(t, session, "rollback_import", map[string]any{"importId": committed.ImportID}))
	if rolledBack.DeletedTransactions != 52 || rolledBack.BalanceAfter != before {
		t.Fatalf("rollback = %+v", rolledBack)
	}

	// Cross-user access fails as not found without revealing anything.
	otherDetail, err := service.NewLedgerService(db).GetTransaction(ctx, other.userID, mustTransaction(t, db, other.accountID))
	if err != nil {
		t.Fatal(err)
	}
	for name, arguments := range map[string]map[string]any{
		"get_transaction":          {"transactionId": otherDetail.ID.String()},
		"update_transaction":       {"transactionId": otherDetail.ID.String(), "amount": "1"},
		"delete_transaction":       {"transactionId": otherDetail.ID.String()},
		"bulk_delete_transactions": {"transactionIds": []string{otherDetail.ID.String()}},
		"preview_import":           {"accountId": other.accountID.String(), "transactions": rows[:1]},
		"update_account":           {"accountId": other.accountID.String(), "name": "Mine"},
		"bulk_upsert_positions":    {"accountId": other.accountID.String(), "asOf": "2026-11-05", "cash": map[string]string{"KES": "1"}},
		"get_tax_report":           {"year": 2026, "accountId": other.accountID.String()},
	} {
		result := call(t, session, name, arguments)
		if !result.IsError || !strings.Contains(text(result), "No matching record") {
			t.Fatalf("%s with another user's ID = %s", name, text(result))
		}
	}
	if stored, err := service.NewLedgerService(db).GetTransaction(ctx, other.userID, otherDetail.ID); err != nil || stored.AmountMinor != otherDetail.AmountMinor {
		t.Fatalf("another user's record changed: %+v, %v", stored, err)
	}

	// An investment account synced from a broker snapshot, then trades.
	category := structured[CatalogResult](t, call(t, session, "list_categories", nil)).Categories[0].ID
	brokerage := structured[AccountWriteResult](t, call(t, session, "create_account", map[string]any{"name": "IBKR", "categoryId": category, "currency": "USD",
		"trackingMode": "positions", "openedAt": "2026-01-01", "idempotencyKey": uuid.NewString()})).Account
	synced := structured[PositionSyncOutput](t, call(t, session, "bulk_upsert_positions", map[string]any{
		"accountId": brokerage.ID, "asOf": "2026-11-05", "source": "interactive_brokers", "createMissingInstruments": true,
		"positions": []map[string]any{
			{"instrument": map[string]any{"isin": "IE00BK5BQT80", "symbol": "VWRA", "exchangeMic": "XLON", "name": "Vanguard FTSE All-World", "assetType": "etf", "quoteCurrency": "USD"}, "quantity": "50.9006", "unitPrice": "184.98", "currency": "USD"},
			{"instrument": map[string]any{"isin": "IE00BKM4GZ66", "symbol": "EIMI", "exchangeMic": "XLON", "name": "iShares Core MSCI EM IMI", "assetType": "etf", "quoteCurrency": "USD"}, "quantity": "14", "unitPrice": "48.91"},
		},
		"cash": map[string]string{"USD": "96.39"},
	}))
	if synced.Status != "completed" || synced.InstrumentsCreated != 2 || synced.Cash.Target.Decimal != "96.39" {
		t.Fatalf("sync = %+v", synced)
	}
	trades := structured[TradeImportOutput](t, call(t, session, "bulk_import_trades", map[string]any{"accountId": brokerage.ID, "source": "interactive_brokers", "trades": []map[string]any{
		{"instrument": map[string]any{"isin": "IE00BK5BQT80"}, "externalId": "ibkr-exec-1", "tradeDate": "2026-10-01", "side": "buy", "quantity": "1", "price": "180", "commission": "1.25"},
		{"instrument": map[string]any{"symbol": "EIMI", "exchangeMic": "XLON"}, "externalId": "ibkr-exec-2", "tradeDate": "2026-11-06", "side": "buy", "quantity": "0.5", "price": "49"},
	}}))
	if trades.Created != 2 || trades.CashAfter.Decimal != "71.89" {
		t.Fatalf("trades = %+v", trades)
	}
	holdings := structured[HoldingsResult](t, call(t, session, "get_holdings", map[string]any{"accountId": brokerage.ID}))
	quantities := map[string]string{}
	for _, position := range holdings.Accounts[0].Positions {
		quantities[position.Symbol] = position.Quantity
	}
	if quantities["VWRA"] != "50.9006" || quantities["EIMI"] != "14.5" || holdings.Accounts[0].Cash.Decimal != "71.89" {
		t.Fatalf("holdings = %+v", holdings)
	}
	prices := structured[PriceHistoryOutput](t, call(t, session, "get_price_history", map[string]any{"instrumentId": synced.Positions[0].InstrumentID}))
	if len(prices.Prices) != 1 || prices.Prices[0].Source != "interactive_brokers" || prices.Prices[0].Category == "" {
		t.Fatalf("prices = %+v", prices)
	}
}

func mustTransaction(t *testing.T, db *sql.DB, accountID uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := db.QueryRow(`SELECT id FROM transactions WHERE account_id=$1 AND type='deposit' LIMIT 1`, accountID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func containsName(names []string, name string) bool {
	for _, candidate := range names {
		if candidate == name {
			return true
		}
	}
	return false
}

func TestPostgreSQLManagementPlanningRatesAndReports(t *testing.T) {
	db := openTestDatabase(t)
	ctx := context.Background()
	owner := seedUser(t, ctx, db, "owner", 100_000, 50_000, "Salary")
	session := connect(t, newManagementServer(t, db), apiKey(t, db, owner.userID, webauth.ScopePortfolioRead, webauth.ScopePortfolioWrite))
	category := structured[CatalogResult](t, call(t, session, "list_categories", nil)).Categories[0].ID
	second := structured[AccountWriteResult](t, call(t, session, "create_account", map[string]any{"name": "Wallet", "category": "Cash", "currency": "KES",
		"openingBalance": "10.00", "openedAt": "2026-01-01", "idempotencyKey": uuid.NewString()})).Account
	if second.Balance.Decimal != "10.00" || category == "" {
		t.Fatalf("created account = %+v", second)
	}
	renamed := structured[AccountWriteResult](t, call(t, session, "update_account", map[string]any{"accountId": second.ID, "name": "Pocket", "includedInNetWorth": false}))
	if renamed.Account.Name != "Pocket" || renamed.Account.IncludedInNetWorth {
		t.Fatalf("updated account = %+v", renamed)
	}
	transfer := structured[TransferResult](t, call(t, session, "transfer_between_accounts", map[string]any{"fromAccountId": owner.accountID.String(), "toAccountId": second.ID,
		"amount": "5.00", "date": "2026-10-01", "idempotencyKey": uuid.NewString()}))
	if transfer.To.Balance.Decimal != "15.00" || transfer.From.Balance.Decimal != "1495.00" {
		t.Fatalf("transfer = %+v", transfer)
	}
	valuation := structured[RecordValuationResult](t, call(t, session, "record_valuation", map[string]any{"accountId": second.ID, "value": "20", "date": "2026-10-02", "idempotencyKey": uuid.NewString()}))
	listed := structured[ValuationsResult](t, call(t, session, "list_valuations", map[string]any{"accountId": second.ID}))
	if len(listed.Valuations) != 1 || listed.Valuations[0].ID != valuation.Valuation.ID {
		t.Fatalf("valuations = %+v", listed)
	}
	if changed := structured[RecordValuationResult](t, call(t, session, "update_valuation", map[string]any{"valuationId": valuation.Valuation.ID, "value": "25.50"})); changed.Account.Balance.Decimal != "25.50" {
		t.Fatalf("valuation update = %+v", changed)
	}
	if removed := structured[DeleteResult](t, call(t, session, "delete_valuation", map[string]any{"valuationId": valuation.Valuation.ID})); removed.Accounts[0].Balance.Decimal != "15.00" {
		t.Fatalf("valuation delete = %+v", removed)
	}
	if archived := structured[AccountWriteResult](t, call(t, session, "archive_account", map[string]any{"accountId": second.ID})); archived.Account.ArchivedAt == "" {
		t.Fatalf("archive = %+v", archived)
	}
	structured[AccountHistoryResult](t, call(t, session, "get_account_history", map[string]any{"accountId": owner.accountID.String(), "interval": "day"}))

	goal := structured[GoalDetail](t, call(t, session, "create_goal", map[string]any{"name": "House", "target": "5000000", "currency": "KES", "targetDate": "2030-12-31",
		"assumedAnnualReturnPercent": "7.5", "contribution": map[string]any{"amount": "20000", "frequency": "monthly"}, "milestones": []map[string]any{{"name": "Half", "target": "2500000"}}}))
	if goal.AssumedReturnBPS != 750 || len(goal.Milestones) != 1 || goal.Plan == nil || goal.Plan.PlannedContribution.Decimal != "20000.00" {
		t.Fatalf("goal = %+v", goal)
	}
	simulated := structured[GoalSimulation](t, call(t, session, "simulate_goal", map[string]any{"goalId": goal.Goal.ID, "monthlyContribution": "50000", "annualReturnPercent": "10"}))
	if simulated.Simulated.MonthlyContribution.Decimal != "50000.00" || simulated.Simulated.AnnualReturnBPS != 1000 || simulated.Saved {
		t.Fatalf("simulation = %+v", simulated)
	}
	unchanged := structured[GoalDetail](t, call(t, session, "get_goal", map[string]any{"goalId": goal.Goal.ID}))
	if unchanged.Plan.PlannedContribution.Decimal != "20000.00" || unchanged.AssumedReturnBPS != 750 {
		t.Fatalf("simulation changed the goal: %+v", unchanged)
	}
	updatedGoal := structured[GoalDetail](t, call(t, session, "update_goal", map[string]any{"goalId": goal.Goal.ID, "priority": 5, "removeMilestoneIds": []string{goal.Milestones[0].ID},
		"addMilestones": []map[string]any{{"name": "Deposit", "target": "1000000"}}}))
	if updatedGoal.Goal.Priority != 5 || len(updatedGoal.Milestones) != 1 || updatedGoal.Milestones[0].Name != "Deposit" || updatedGoal.Plan.PlannedContribution.Decimal != "20000.00" {
		t.Fatalf("goal update = %+v", updatedGoal)
	}
	goalsBefore := len(structured[ListGoalsResult](t, call(t, session, "list_goals", nil)).Goals)
	if result := call(t, session, "create_goal", map[string]any{"name": "Car", "target": "100", "currency": "KES", "targetDate": "2030-12-31",
		"milestones": []map[string]any{{"name": "Too much", "target": "200"}}}); !result.IsError || !strings.Contains(text(result), "milestone 1") {
		t.Fatalf("invalid milestone = %s", text(result))
	}
	if after := len(structured[ListGoalsResult](t, call(t, session, "list_goals", nil)).Goals); after != goalsBefore {
		t.Fatalf("a rejected create_goal left a goal behind: %d goals, want %d", after, goalsBefore)
	}
	if result := call(t, session, "update_goal", map[string]any{"goalId": goal.Goal.ID, "priority": 9, "removeMilestoneIds": []string{uuid.NewString()}}); !result.IsError {
		t.Fatalf("unknown milestone removal = %s", text(result))
	}
	if kept := structured[GoalDetail](t, call(t, session, "get_goal", map[string]any{"goalId": goal.Goal.ID})); kept.Goal.Priority != 5 {
		t.Fatalf("a rejected update_goal changed the goal: %+v", kept.Goal)
	}
	structured[DeleteResult](t, call(t, session, "delete_goal", map[string]any{"goalId": goal.Goal.ID}))

	rate := structured[RateUpdateOutput](t, call(t, session, "upsert_exchange_rate", map[string]any{"baseCurrency": "USD", "quoteCurrency": "KES", "rate": "129.25", "effectiveDate": "2026-11-01", "source": "cbk"}))
	if rate.Created != 1 {
		t.Fatalf("rate = %+v", rate)
	}
	rates := structured[RatesResult](t, call(t, session, "get_exchange_rates", map[string]any{"currency": "USD"}))
	if len(rates.Rates) != 1 || rates.Rates[0].Rate != "129.25" || !rates.Rates[0].Latest {
		t.Fatalf("rates = %+v", rates)
	}
	structured[DeleteResult](t, call(t, session, "delete_exchange_rate", map[string]any{"rateId": rates.Rates[0].ID}))

	performance := structured[PerformanceReport](t, call(t, session, "get_performance_report", map[string]any{"range": "all"}))
	if performance.Methodology == "" || performance.InvestmentReturn.Currency != "KES" {
		t.Fatalf("performance = %+v", performance)
	}
	structured[PortfolioHistory](t, call(t, session, "get_portfolio_history", map[string]any{"range": "all", "interval": "week"}))
	structured[TaxReport](t, call(t, session, "get_tax_report", map[string]any{"year": 2026}))
	structured[ReconciliationStatusResult](t, call(t, session, "get_reconciliation_status", nil))
	structured[InstrumentsResult](t, call(t, session, "list_instruments", nil))
	if result := call(t, session, "get_portfolio_history", map[string]any{"interval": "hour"}); !result.IsError || !strings.Contains(text(result), "interval must be") {
		t.Fatalf("bad interval = %s", text(result))
	}
}
