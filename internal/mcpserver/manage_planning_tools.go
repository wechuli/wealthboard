package mcpserver

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/wechuli/wealthboard/internal/domain"
	"github.com/wechuli/wealthboard/internal/service"
)

func (tools *toolset) registerPlanningReads(server *mcp.Server) {
	addTool(server, &mcp.Tool{
		Name:        "simulate_goal",
		Description: "Project a goal with a different monthly contribution and annual return without changing it, using Wealthboard's goal forecast. Also returns the pace needed to reach the target and a lower-return case. Use update_goal to save a plan.",
		Annotations: readOnly("Simulate a goal"),
	}, handle(tools, tools.simulateGoal))
	addTool(server, &mcp.Tool{
		Name:        "get_exchange_rates",
		Description: "Recorded exchange rates, newest first per pair, with source and whether each is the latest for its pair. A pair's inverse is calculated automatically.",
		Annotations: readOnly("Exchange rates"),
	}, handle(tools, tools.exchangeRates))
	addTool(server, &mcp.Tool{
		Name:        "get_performance_report",
		Description: "Investment performance for a period in the base currency: contributions and withdrawals separated from investment return (income, fees, and growth), time-weighted and money-weighted returns by month and for the period, and each account's annualized return.",
		Annotations: readOnly("Performance report"),
	}, handle(tools, tools.performanceReport))
	addTool(server, &mcp.Tool{
		Name:        "get_tax_report",
		Description: "A calendar year's recorded interest, dividends, recorded realized gains and losses, fees, withholding tax, and sale proceeds by account, with the underlying records. These are recorded amounts, not a tax calculation or what is owed.",
		Annotations: readOnly("Tax report"),
	}, handle(tools, tools.taxReport))
	addTool(server, &mcp.Tool{
		Name:        "get_portfolio_history",
		Description: "Net worth, assets, liabilities, and investible value over time in the base currency, by month (default), week, or day.",
		Annotations: readOnly("Portfolio history"),
	}, handle(tools, tools.portfolioHistory))
	addTool(server, &mcp.Tool{
		Name:        "get_audit_log",
		Description: "Financial changes made through this assistant connection and other MCP connections, newest first: time, tool, action, affected record IDs, and import ID.",
		Annotations: readOnly("Audit log"),
	}, handle(tools, tools.auditLog))
}

func (tools *toolset) registerPlanningWrites(server *mcp.Server) {
	goalAudit := func(out GoalDetail) auditRef {
		return auditRef{recordType: "goal", ids: mustIDs(out.Goal.ID)}
	}
	addTool(server, &mcp.Tool{
		Name:        "create_goal",
		Description: "Create a savings goal with a target, date, optional linked account (whose value becomes the goal's progress), contribution plan, assumed return, priority, and milestones.",
		Annotations: writeAnnotations("Create a goal"),
	}, handleWrite(tools, "create", tools.createGoal, func(_ createGoalInput, out GoalDetail) auditRef { return goalAudit(out) }))
	addTool(server, &mcp.Tool{
		Name:        "update_goal",
		Description: "Change a goal's details, status, linked account, contribution plan, assumed return, or priority, and add or remove milestones. Omitted fields are unchanged.",
		Annotations: writeAnnotations("Update a goal"),
	}, handleWrite(tools, "update", tools.updateGoal, func(_ updateGoalInput, out GoalDetail) auditRef { return goalAudit(out) }))
	addTool(server, &mcp.Tool{
		Name:        "delete_goal",
		Description: "Delete a goal with its plan and milestones. Linked accounts and their records are not affected. Confirm with the user first.",
		Annotations: destructive("Delete a goal"),
	}, handleWrite(tools, "delete", tools.deleteGoal, func(_ goalInput, out DeleteResult) auditRef {
		return auditRef{recordType: "goal", ids: mustIDs(out.DeletedIDs...)}
	}))
	rateAudit := func(out RateUpdateOutput) auditRef {
		ids := []string{}
		for _, row := range out.Rows {
			if row.RateID != "" {
				ids = append(ids, row.RateID)
			}
		}
		return auditRef{skip: len(ids) == 0, recordType: "exchange_rate", ids: mustIDs(ids...)}
	}
	addTool(server, &mcp.Tool{
		Name:        "upsert_exchange_rate",
		Description: "Record an exchange rate effective on a date: 1 base = rate quote. A rate on a date that already has one replaces it. Reports convert each date at the latest rate effective then; investment account values are recalculated.",
		Annotations: writeAnnotations("Record an exchange rate"),
	}, handleWrite(tools, "upsert", tools.upsertRate, func(_ rateInput, out RateUpdateOutput) auditRef { return rateAudit(out) }))
	addTool(server, &mcp.Tool{
		Name:        "bulk_upsert_exchange_rates",
		Description: "Record up to 1,000 exchange rates atomically, each like upsert_exchange_rate.",
		Annotations: writeAnnotations("Record exchange rates"),
	}, handleWrite(tools, "upsert", tools.bulkUpsertRates, func(_ bulkRateInput, out RateUpdateOutput) auditRef { return rateAudit(out) }))
	addTool(server, &mcp.Tool{
		Name:        "delete_exchange_rate",
		Description: "Delete an incorrect exchange rate (rateId from get_exchange_rates). Confirm with the user first.",
		Annotations: destructive("Delete an exchange rate"),
	}, handleWrite(tools, "delete", tools.deleteRate, func(_ rateIDInput, out DeleteResult) auditRef {
		return auditRef{recordType: "exchange_rate", ids: mustIDs(out.DeletedIDs...)}
	}))
}

func (tools *toolset) registerManagementReads(server *mcp.Server) {
	tools.registerLedgerReads(server)
	tools.registerImportReads(server)
	tools.registerInvestmentReads(server)
	tools.registerPlanningReads(server)
}

func (tools *toolset) registerManagementWrites(server *mcp.Server) {
	tools.registerLedgerWrites(server)
	tools.registerImportWrites(server)
	tools.registerInvestmentWrites(server)
	tools.registerPlanningWrites(server)
}

type contributionInput struct {
	Amount    string `json:"amount" jsonschema:"Planned contribution per period in the goal currency."`
	Frequency string `json:"frequency,omitempty" jsonschema:"weekly, monthly (default), quarterly, annually, or custom."`
	StartDate string `json:"startDate,omitempty" jsonschema:"YYYY-MM-DD; defaults to today. Must be before the target date."`
	EndDate   string `json:"endDate,omitempty"`
}

type milestoneInput struct {
	Name       string `json:"name"`
	Target     string `json:"target" jsonschema:"Milestone amount in the goal currency."`
	TargetDate string `json:"targetDate,omitempty"`
}

type createGoalInput struct {
	Name                       string             `json:"name"`
	Description                string             `json:"description,omitempty"`
	Target                     string             `json:"target" jsonschema:"Target amount as a plain decimal."`
	Currency                   string             `json:"currency"`
	TargetDate                 string             `json:"targetDate" jsonschema:"YYYY-MM-DD."`
	LinkedAccountID            string             `json:"linkedAccountId,omitempty" jsonschema:"The account whose value is the goal's progress."`
	CurrentAmount              string             `json:"currentAmount,omitempty" jsonschema:"Progress so far, only for goals without a linked account."`
	Priority                   int                `json:"priority,omitempty" jsonschema:"0 to 100."`
	AssumedAnnualReturnPercent string             `json:"assumedAnnualReturnPercent,omitempty" jsonschema:"Such as 8 or 7.5. Defaults to the user's setting."`
	Contribution               *contributionInput `json:"contribution,omitempty"`
	Milestones                 []milestoneInput   `json:"milestones,omitempty"`
	IdempotencyKey             string             `json:"idempotencyKey,omitempty"`
}

func (tools *toolset) today(ctx context.Context, userID uuid.UUID) (string, service.Settings, error) {
	settings, err := tools.readers.Core.Settings(ctx, userID)
	if err != nil {
		return "", service.Settings{}, err
	}
	location, err := time.LoadLocation(settings.Timezone)
	if err != nil {
		location = time.UTC
	}
	return time.Now().In(location).Format(time.DateOnly), settings, nil
}

func (tools *toolset) createGoal(ctx context.Context, userID uuid.UUID, input createGoalInput) (GoalDetail, error) {
	key, err := idempotencyArg(input.IdempotencyKey, false)
	if err != nil {
		return GoalDetail{}, err
	}
	today, settings, err := tools.today(ctx, userID)
	if err != nil {
		return GoalDetail{}, err
	}
	linked, err := optionalUUIDArg("linkedAccountId", input.LinkedAccountID)
	if err != nil {
		return GoalDetail{}, err
	}
	mutation := service.GoalMutationInput{IdempotencyKey: key, Name: input.Name, TargetAmount: input.Target, CurrentAmount: input.CurrentAmount,
		Currency: input.Currency, TargetDate: input.TargetDate, LinkedAccountID: linked, Status: "active", Priority: input.Priority,
		AssumedAnnualReturn: input.AssumedAnnualReturnPercent, PlannedContribution: "0", Frequency: "monthly", PlanStartDate: today}
	if strings.TrimSpace(input.Description) != "" {
		mutation.Description = &input.Description
	}
	if mutation.AssumedAnnualReturn == "" {
		mutation.AssumedAnnualReturn = decimalPercent(int32(settings.DefaultGoalReturnBPS))
	}
	applyContribution(&mutation, input.Contribution)
	if err := validateMilestones(input.Milestones, mutation); err != nil {
		return GoalDetail{}, err
	}
	created, err := tools.readers.Manage.Goals.CreateGoal(ctx, userID, mutation)
	if err != nil {
		return GoalDetail{}, err
	}
	if !created.Replayed {
		for _, milestone := range input.Milestones {
			if _, err := tools.readers.Manage.Goals.CreateMilestone(ctx, userID, created.ID, milestoneArgs(milestone)); err != nil {
				// Milestones were validated first, so this is unexpected; don't leave a partial goal.
				if deleteErr := tools.readers.Manage.Goals.DeleteGoal(ctx, userID, created.ID); deleteErr != nil {
					tools.logger.ErrorContext(ctx, "remove partially created goal", "error", deleteErr)
				}
				return GoalDetail{}, err
			}
		}
	}
	return tools.getGoal(ctx, userID, goalInput{GoalID: created.ID.String()})
}

func milestoneArgs(milestone milestoneInput) service.GoalMilestoneInput {
	return service.GoalMilestoneInput{Name: milestone.Name, TargetAmount: milestone.Target, TargetDate: milestone.TargetDate}
}

// validateMilestones checks new milestones against the goal as it will be saved, so the
// goal isn't written when a milestone would be rejected.
func validateMilestones(milestones []milestoneInput, goal service.GoalMutationInput) error {
	if len(milestones) == 0 {
		return nil
	}
	currency := domain.NormalizeCurrency(goal.Currency)
	target, err := domain.ParseDecimalAmount(goal.TargetAmount, currency)
	if err != nil {
		return invalid("target must be a plain decimal in the goal currency")
	}
	for index, milestone := range milestones {
		if err := service.ValidateGoalMilestone(milestoneArgs(milestone), currency, target, goal.TargetDate); err != nil {
			if detail, ok := sentinelDetail(err, service.ErrGoalMutationValidation); ok {
				return invalid("milestone %d: %s", index+1, detail)
			}
			return err
		}
	}
	return nil
}

func applyContribution(mutation *service.GoalMutationInput, contribution *contributionInput) {
	if contribution == nil {
		return
	}
	mutation.PlannedContribution = contribution.Amount
	if contribution.Frequency != "" {
		mutation.Frequency = contribution.Frequency
	}
	if contribution.StartDate != "" {
		mutation.PlanStartDate = contribution.StartDate
	}
	if contribution.EndDate != "" {
		mutation.PlanEndDate = contribution.EndDate
	}
}

type updateGoalInput struct {
	GoalID                     string             `json:"goalId"`
	Name                       *string            `json:"name,omitempty"`
	Description                *string            `json:"description,omitempty" jsonschema:"An empty string clears it."`
	Target                     string             `json:"target,omitempty"`
	TargetDate                 string             `json:"targetDate,omitempty"`
	LinkedAccountID            string             `json:"linkedAccountId,omitempty"`
	ClearLinkedAccount         bool               `json:"clearLinkedAccount,omitempty"`
	CurrentAmount              string             `json:"currentAmount,omitempty"`
	Status                     string             `json:"status,omitempty" jsonschema:"active, paused, completed, or cancelled."`
	Priority                   *int               `json:"priority,omitempty"`
	AssumedAnnualReturnPercent string             `json:"assumedAnnualReturnPercent,omitempty"`
	Contribution               *contributionInput `json:"contribution,omitempty" jsonschema:"Replaces the given plan fields."`
	AddMilestones              []milestoneInput   `json:"addMilestones,omitempty"`
	RemoveMilestoneIDs         []string           `json:"removeMilestoneIds,omitempty"`
}

func formatMinor(minor, currency string) string {
	text, _ := domain.FormatMinorUnits(minor, currency)
	return text
}

func (tools *toolset) updateGoal(ctx context.Context, userID uuid.UUID, input updateGoalInput) (GoalDetail, error) {
	goalID, err := parseID("goalId", input.GoalID)
	if err != nil {
		return GoalDetail{}, err
	}
	removals, err := parseUUIDs("removeMilestoneIds", input.RemoveMilestoneIDs)
	if err != nil {
		return GoalDetail{}, err
	}
	goal, err := tools.readers.Reports.GetGoal(ctx, userID, goalID)
	if err != nil {
		return GoalDetail{}, err
	}
	mutation := service.GoalMutationInput{Name: goal.Name, Description: goal.Description, TargetAmount: formatMinor(goal.TargetAmountMinor, goal.Currency),
		Currency: goal.Currency, TargetDate: goal.TargetDate, Icon: goal.Icon, Status: goal.Status, Priority: int(goal.Priority),
		AssumedAnnualReturn: decimalPercent(goal.AssumedAnnualReturnBPS), PlannedContribution: "0", Frequency: "monthly"}
	if goal.LinkedAccount != nil {
		id := goal.LinkedAccount.ID
		mutation.LinkedAccountID = &id
	} else {
		mutation.CurrentAmount = formatMinor(goal.CurrentAmountMinor, goal.Currency)
	}
	if goal.Plan != nil {
		mutation.PlannedContribution, mutation.Frequency, mutation.PlanStartDate = formatMinor(goal.Plan.PlannedContributionMinor, goal.Currency), goal.Plan.Frequency, goal.Plan.StartDate
		if goal.Plan.EndDate != nil {
			mutation.PlanEndDate = *goal.Plan.EndDate
		}
	} else if mutation.PlanStartDate, _, err = tools.today(ctx, userID); err != nil {
		return GoalDetail{}, err
	}
	if input.Name != nil {
		mutation.Name = *input.Name
	}
	if input.Description != nil {
		mutation.Description = input.Description
	}
	for target, value := range map[*string]string{&mutation.TargetAmount: input.Target, &mutation.TargetDate: input.TargetDate, &mutation.Status: input.Status,
		&mutation.AssumedAnnualReturn: input.AssumedAnnualReturnPercent} {
		if strings.TrimSpace(value) != "" {
			*target = strings.TrimSpace(value)
		}
	}
	if input.Priority != nil {
		mutation.Priority = *input.Priority
	}
	if input.ClearLinkedAccount {
		mutation.LinkedAccountID = nil
	} else if input.LinkedAccountID != "" {
		if mutation.LinkedAccountID, err = optionalUUIDArg("linkedAccountId", input.LinkedAccountID); err != nil {
			return GoalDetail{}, err
		}
	}
	if input.CurrentAmount != "" {
		mutation.CurrentAmount = input.CurrentAmount
	}
	applyContribution(&mutation, input.Contribution)
	if err := validateMilestones(input.AddMilestones, mutation); err != nil {
		return GoalDetail{}, err
	}
	if len(removals) > 0 {
		existing, err := tools.readers.Reports.ListMilestones(ctx, userID, goalID)
		if err != nil {
			return GoalDetail{}, err
		}
		for _, milestoneID := range removals {
			found := false
			for _, milestone := range existing {
				found = found || milestone.ID == milestoneID
			}
			if !found {
				return GoalDetail{}, invalid("removeMilestoneIds contains an ID that isn't one of this goal's milestones")
			}
		}
	}
	if err := tools.readers.Manage.Goals.UpdateGoal(ctx, userID, goalID, mutation); err != nil {
		return GoalDetail{}, err
	}
	for _, milestoneID := range removals {
		if err := tools.readers.Manage.Goals.DeleteMilestone(ctx, userID, goalID, milestoneID); err != nil {
			return GoalDetail{}, err
		}
	}
	for _, milestone := range input.AddMilestones {
		if _, err := tools.readers.Manage.Goals.CreateMilestone(ctx, userID, goalID, milestoneArgs(milestone)); err != nil {
			return GoalDetail{}, err
		}
	}
	return tools.getGoal(ctx, userID, goalInput{GoalID: goalID.String()})
}

func (tools *toolset) deleteGoal(ctx context.Context, userID uuid.UUID, input goalInput) (DeleteResult, error) {
	goalID, err := parseID("goalId", input.GoalID)
	if err != nil {
		return DeleteResult{}, err
	}
	if err := tools.readers.Manage.Goals.DeleteGoal(ctx, userID, goalID); err != nil {
		return DeleteResult{}, err
	}
	return DeleteResult{DeletedIDs: []string{goalID.String()}, Accounts: []AccountSummary{}}, nil
}

type simulateGoalInput struct {
	GoalID              string `json:"goalId"`
	MonthlyContribution string `json:"monthlyContribution" jsonschema:"Monthly contribution to test, in the goal currency."`
	AnnualReturnPercent string `json:"annualReturnPercent,omitempty" jsonschema:"Annual return to assume, such as 8; defaults to the goal's assumption."`
}

type GoalSimulation struct {
	GoalID       string       `json:"goalId"`
	Simulated    GoalScenario `json:"simulated" jsonschema:"The goal with the given contribution and return."`
	RequiredPace GoalScenario `json:"requiredPace" jsonschema:"The monthly contribution needed to reach the target by its date at that return."`
	LowerReturn  GoalScenario `json:"lowerReturn" jsonschema:"The given contribution with a return 2 percentage points lower."`
	Saved        bool         `json:"saved" jsonschema:"Always false: simulations never change the goal."`
}

func (tools *toolset) simulateGoal(ctx context.Context, userID uuid.UUID, input simulateGoalInput) (GoalSimulation, error) {
	goalID, err := parseID("goalId", input.GoalID)
	if err != nil {
		return GoalSimulation{}, err
	}
	goal, err := tools.readers.Reports.GetGoal(ctx, userID, goalID)
	if err != nil {
		return GoalSimulation{}, err
	}
	contribution, err := parseAmount("monthlyContribution", input.MonthlyContribution, goal.Currency)
	if err != nil {
		return GoalSimulation{}, err
	}
	bps := goal.AssumedAnnualReturnBPS
	if strings.TrimSpace(input.AnnualReturnPercent) != "" {
		value, err := domain.ParseDecimalAmount(input.AnnualReturnPercent, "USD")
		if err != nil || value < 0 || value > 10000 {
			return GoalSimulation{}, invalid("annualReturnPercent must be between 0 and 100 with at most 2 decimal places")
		}
		bps = int32(value)
	}
	scenarios, err := tools.readers.Manage.Simulator.CalculateGoalScenarios(ctx, userID, goalID, service.GoalScenarioInput{MonthlyContributionMinor: strconv.FormatInt(contribution, 10), AnnualReturnBPS: bps})
	if err != nil {
		return GoalSimulation{}, err
	}
	return GoalSimulation{GoalID: goalID.String(), Simulated: scenario(scenarios.SavedPlan, goal.Currency), RequiredPace: scenario(scenarios.RequiredPace, goal.Currency),
		LowerReturn: scenario(scenarios.LowerReturn, goal.Currency)}, nil
}

type ratesInput struct {
	Currency string `json:"currency,omitempty" jsonschema:"Only pairs that include this currency."`
	From     string `json:"from,omitempty"`
	To       string `json:"to,omitempty"`
	Limit    int    `json:"limit,omitempty"`
	Offset   int    `json:"offset,omitempty"`
}

type RateItem struct {
	ID            string `json:"id"`
	BaseCurrency  string `json:"baseCurrency"`
	QuoteCurrency string `json:"quoteCurrency"`
	Rate          string `json:"rate" jsonschema:"1 base = rate quote, as an exact decimal string."`
	EffectiveDate string `json:"effectiveDate"`
	Source        string `json:"source"`
	Latest        bool   `json:"latest" jsonschema:"The newest rate for its pair, used for current values."`
}

type RatesResult struct {
	Rates      []RateItem `json:"rates"`
	Limit      int        `json:"limit"`
	Offset     int        `json:"offset"`
	HasMore    bool       `json:"hasMore"`
	NextOffset *int       `json:"nextOffset,omitempty"`
}

func (tools *toolset) exchangeRates(ctx context.Context, userID uuid.UUID, input ratesInput) (RatesResult, error) {
	page, err := pageArgs(input.Limit, input.Offset)
	if err != nil {
		return RatesResult{}, err
	}
	from, to, err := dateRange(input.From, input.To)
	if err != nil {
		return RatesResult{}, err
	}
	listed, err := tools.readers.Manage.Features.ExchangeRates(ctx, userID, service.ExchangeRateFilter{Currency: input.Currency, From: from, To: to, Page: page})
	if err != nil {
		return RatesResult{}, err
	}
	result := RatesResult{Rates: []RateItem{}, Limit: listed.Limit, Offset: listed.Offset, HasMore: listed.HasMore, NextOffset: nextOffset(page, len(listed.Items), listed.HasMore)}
	for _, rate := range listed.Items {
		result.Rates = append(result.Rates, RateItem{ID: rate.ID.String(), BaseCurrency: rate.BaseCurrency, QuoteCurrency: rate.QuoteCurrency, Rate: rate.Rate,
			EffectiveDate: rate.EffectiveDate.Format(time.DateOnly), Source: rate.Source, Latest: rate.Latest})
	}
	return result, nil
}

type rateInput struct {
	BaseCurrency  string `json:"baseCurrency"`
	QuoteCurrency string `json:"quoteCurrency"`
	Rate          string `json:"rate" jsonschema:"Positive decimal: 1 base = rate quote."`
	EffectiveDate string `json:"effectiveDate" jsonschema:"YYYY-MM-DD."`
	Source        string `json:"source,omitempty" jsonschema:"Such as cbk or interactive_brokers."`
}

type bulkRateInput struct {
	Rates []rateInput `json:"rates" jsonschema:"Up to 1,000 rates."`
}

type rateIDInput struct {
	RateID string `json:"rateId"`
}

type RateRowItem struct {
	Index         int    `json:"index"`
	BaseCurrency  string `json:"baseCurrency"`
	QuoteCurrency string `json:"quoteCurrency"`
	Rate          string `json:"rate"`
	EffectiveDate string `json:"effectiveDate"`
	Status        string `json:"status" jsonschema:"created, updated, unchanged, or rejected."`
	Message       string `json:"message"`
	RateID        string `json:"rateId,omitempty"`
	Historical    bool   `json:"historical" jsonschema:"True when a newer rate exists for the pair."`
}

type RateUpdateOutput struct {
	Status    string        `json:"status"`
	Created   int           `json:"created"`
	Updated   int           `json:"updated"`
	Unchanged int           `json:"unchanged"`
	Rejected  int           `json:"rejected"`
	Rows      []RateRowItem `json:"rows"`
	Warnings  []string      `json:"warnings"`
}

func (tools *toolset) upsertRates(ctx context.Context, userID uuid.UUID, rates []rateInput) (RateUpdateOutput, error) {
	if len(rates) == 0 || len(rates) > service.MaxPositionSyncRecords {
		return RateUpdateOutput{}, invalid("send between 1 and %d rates", service.MaxPositionSyncRecords)
	}
	request := make([]service.ExchangeRateUpsert, 0, len(rates))
	for _, rate := range rates {
		request = append(request, service.ExchangeRateUpsert{BaseCurrency: rate.BaseCurrency, QuoteCurrency: rate.QuoteCurrency, Rate: rate.Rate, EffectiveDate: rate.EffectiveDate, Source: rate.Source})
	}
	result, err := tools.readers.Manage.Rates.UpsertExchangeRates(ctx, userID, request)
	if err != nil {
		return RateUpdateOutput{}, err
	}
	output := RateUpdateOutput{Status: result.Status, Created: result.Created, Updated: result.Updated, Unchanged: result.Unchanged, Rejected: result.Rejected,
		Rows: []RateRowItem{}, Warnings: nonNil(result.Warnings)}
	for _, row := range result.Rows {
		output.Rows = append(output.Rows, RateRowItem{Index: row.Index, BaseCurrency: row.BaseCurrency, QuoteCurrency: row.QuoteCurrency, Rate: row.Rate,
			EffectiveDate: row.EffectiveDate, Status: row.Status, Message: row.Message, RateID: optionalID(row.RateID), Historical: row.Historical})
	}
	return output, nil
}

func (tools *toolset) upsertRate(ctx context.Context, userID uuid.UUID, input rateInput) (RateUpdateOutput, error) {
	return tools.upsertRates(ctx, userID, []rateInput{input})
}

func (tools *toolset) bulkUpsertRates(ctx context.Context, userID uuid.UUID, input bulkRateInput) (RateUpdateOutput, error) {
	return tools.upsertRates(ctx, userID, input.Rates)
}

func (tools *toolset) deleteRate(ctx context.Context, userID uuid.UUID, input rateIDInput) (DeleteResult, error) {
	rateID, err := parseID("rateId", input.RateID)
	if err != nil {
		return DeleteResult{}, err
	}
	if err := tools.readers.Manage.Rates.DeleteExchangeRate(ctx, userID, rateID); err != nil {
		return DeleteResult{}, err
	}
	return DeleteResult{DeletedIDs: []string{rateID.String()}, Accounts: []AccountSummary{}}, nil
}

type PerformanceMonth struct {
	Month         string  `json:"month"`
	Start         Money   `json:"start"`
	End           Money   `json:"end"`
	NetFlow       Money   `json:"netFlow" jsonschema:"Contributions minus withdrawals."`
	Return        Money   `json:"return" jsonschema:"Change in value minus net flow."`
	ReturnPercent *string `json:"returnPercent,omitempty"`
	Complete      bool    `json:"complete"`
}

type AccountReturn struct {
	AccountID               string  `json:"accountId"`
	Name                    string  `json:"name"`
	Currency                string  `json:"currency"`
	Start                   *Money  `json:"start,omitempty"`
	End                     *Money  `json:"end,omitempty"`
	Deposits                Money   `json:"deposits"`
	Withdrawals             Money   `json:"withdrawals"`
	NetIncome               Money   `json:"netIncome"`
	AnnualizedReturnPercent *string `json:"annualizedReturnPercent,omitempty"`
	ReturnStatus            string  `json:"returnStatus"`
}

type PerformanceReport struct {
	BaseCurrency               string             `json:"baseCurrency"`
	Range                      string             `json:"range"`
	From                       string             `json:"from"`
	To                         string             `json:"to"`
	StartValue                 Money              `json:"startValue"`
	EndValue                   Money              `json:"endValue"`
	Contributions              Money              `json:"contributions"`
	Withdrawals                Money              `json:"withdrawals"`
	NetContributions           Money              `json:"netContributions"`
	Income                     Money              `json:"income"`
	Fees                       Money              `json:"fees"`
	Growth                     Money              `json:"growth"`
	InvestmentReturn           Money              `json:"investmentReturn" jsonschema:"Change in value not explained by contributions or withdrawals."`
	TimeWeightedReturnPercent  *string            `json:"timeWeightedReturnPercent,omitempty"`
	MoneyWeightedReturnPercent *string            `json:"moneyWeightedReturnPercent,omitempty"`
	Methodology                string             `json:"methodology"`
	Complete                   bool               `json:"complete"`
	Notes                      []string           `json:"notes"`
	Months                     []PerformanceMonth `json:"months"`
	MonthsTruncated            bool               `json:"monthsTruncated"`
	Accounts                   []AccountReturn    `json:"accounts"`
}

func (tools *toolset) performanceReport(ctx context.Context, userID uuid.UUID, input rangeInput) (PerformanceReport, error) {
	rangeName, err := parseRange(input.Range)
	if err != nil {
		return PerformanceReport{}, err
	}
	report, err := tools.readers.Manage.Performance.PerformanceReport(ctx, userID, rangeName)
	if err != nil {
		return PerformanceReport{}, err
	}
	base := report.BaseCurrency
	result := PerformanceReport{BaseCurrency: base, Range: report.Range, From: report.From, To: report.To, StartValue: money(report.StartValueMinor, base),
		EndValue: money(report.EndValueMinor, base), Contributions: money(report.ContributionsMinor, base), Withdrawals: money(report.WithdrawalsMinor, base),
		NetContributions: money(report.NetContributionsMinor, base), Income: money(report.IncomeMinor, base), Fees: money(report.FeesMinor, base),
		Growth: money(report.GrowthMinor, base), InvestmentReturn: money(report.InvestmentReturnMinor, base), TimeWeightedReturnPercent: report.TimeWeightedReturnPercent,
		MoneyWeightedReturnPercent: report.MoneyWeightedReturnPercent, Methodology: report.Methodology, Complete: report.Complete, Notes: nonNil(report.Notes),
		Months: []PerformanceMonth{}, Accounts: []AccountReturn{}}
	months, truncated := lastN(report.Months, maxSeriesMonths)
	result.MonthsTruncated = truncated
	for _, month := range months {
		result.Months = append(result.Months, PerformanceMonth{Month: month.Month, Start: money(month.StartMinor, base), End: money(month.EndMinor, base),
			NetFlow: money(month.NetFlowMinor, base), Return: money(month.ReturnMinor, base), ReturnPercent: month.ReturnPercent, Complete: month.Complete})
	}
	for _, row := range report.Accounts {
		item := AccountReturn{AccountID: row.AccountID.String(), Name: row.Name, Currency: row.Currency, Start: optionalMoney(row.StartMinor, row.Currency),
			End: optionalMoney(row.EndMinor, row.Currency), Deposits: money(row.DepositsMinor, row.Currency), Withdrawals: money(row.WithdrawalsMinor, row.Currency),
			NetIncome: money(row.NetIncomeMinor, row.Currency), ReturnStatus: row.ReturnStatus}
		if row.AnnualizedReturnBPS != nil {
			text, _ := domain.FormatMinorUnits(strconv.FormatInt(*row.AnnualizedReturnBPS, 10), "USD")
			item.AnnualizedReturnPercent = &text
		}
		result.Accounts = append(result.Accounts, item)
	}
	return result, nil
}

type taxReportInput struct {
	Year      int    `json:"year" jsonschema:"Calendar year, such as 2026."`
	AccountID string `json:"accountId,omitempty"`
}

type TaxAccount struct {
	AccountID      string `json:"accountId"`
	AccountName    string `json:"accountName"`
	Interest       Money  `json:"interest"`
	Dividends      Money  `json:"dividends"`
	CapitalGains   Money  `json:"capitalGains" jsonschema:"Recorded capital_gain transactions only."`
	CapitalLosses  Money  `json:"capitalLosses"`
	Fees           Money  `json:"fees" jsonschema:"Fees other than withholding tax."`
	WithholdingTax Money  `json:"withholdingTax"`
	SaleProceeds   Money  `json:"saleProceeds" jsonschema:"Net cash from sells, in the account currency."`
	SaleCount      int    `json:"saleCount"`
}

type TaxRecord struct {
	ID          string `json:"id"`
	AccountID   string `json:"accountId"`
	AccountName string `json:"accountName"`
	Category    string `json:"category" jsonschema:"income, realized_gain, withholding_tax, or sale."`
	Type        string `json:"type"`
	Date        string `json:"date"`
	Amount      Money  `json:"amount"`
	Description string `json:"description,omitempty"`
	Instrument  string `json:"instrument,omitempty"`
	Quantity    string `json:"quantity,omitempty"`
	UnitPrice   string `json:"unitPrice,omitempty"`
}

type TaxReport struct {
	Year      int          `json:"year"`
	From      string       `json:"from"`
	To        string       `json:"to"`
	Accounts  []TaxAccount `json:"accounts"`
	Records   []TaxRecord  `json:"records"`
	Truncated bool         `json:"truncated"`
	Notes     []string     `json:"notes"`
	Notice    string       `json:"notice"`
}

func (tools *toolset) taxReport(ctx context.Context, userID uuid.UUID, input taxReportInput) (TaxReport, error) {
	if input.Year == 0 {
		input.Year = time.Now().Year()
	}
	accountID, err := optionalUUIDArg("accountId", input.AccountID)
	if err != nil {
		return TaxReport{}, err
	}
	report, err := tools.readers.Manage.Features.TaxReport(ctx, userID, input.Year, accountID)
	if err != nil {
		return TaxReport{}, err
	}
	result := TaxReport{Year: report.Year, From: report.From, To: report.To, Accounts: []TaxAccount{}, Records: []TaxRecord{}, Truncated: report.Truncated,
		Notes: nonNil(report.Notes), Notice: untrustedTextNotice}
	for _, line := range report.Accounts {
		currency := line.Currency
		result.Accounts = append(result.Accounts, TaxAccount{AccountID: line.AccountID.String(), AccountName: line.AccountName, Interest: money(line.InterestMinor, currency),
			Dividends: money(line.DividendsMinor, currency), CapitalGains: money(line.CapitalGainsMinor, currency), CapitalLosses: money(line.CapitalLossesMinor, currency),
			Fees: money(line.FeesMinor, currency), WithholdingTax: money(line.WithholdingTaxMinor, currency), SaleProceeds: money(line.SaleProceedsMinor, currency), SaleCount: line.SaleCount})
	}
	for _, record := range report.Records {
		result.Records = append(result.Records, TaxRecord{ID: record.ID.String(), AccountID: record.AccountID.String(), AccountName: record.AccountName, Category: record.Category,
			Type: record.Type, Date: record.Date, Amount: money(record.AmountMinor, record.Currency), Description: record.Description, Instrument: record.Instrument,
			Quantity: record.Quantity, UnitPrice: record.UnitPrice})
	}
	return result, nil
}

type portfolioHistoryInput struct {
	Range    string `json:"range,omitempty" jsonschema:"1m, 3m, 6m, 1y (default), or all."`
	Interval string `json:"interval,omitempty" jsonschema:"month (default), week, or day."`
}

type PortfolioPoint struct {
	Date        string `json:"date"`
	NetWorth    Money  `json:"netWorth"`
	Assets      Money  `json:"assets"`
	Liabilities Money  `json:"liabilities"`
	Investible  Money  `json:"investible"`
	Complete    bool   `json:"complete"`
}

type PortfolioHistory struct {
	BaseCurrency string           `json:"baseCurrency"`
	Range        string           `json:"range"`
	Interval     string           `json:"interval"`
	Complete     bool             `json:"complete"`
	Points       []PortfolioPoint `json:"points"`
	Truncated    bool             `json:"truncated"`
}

func (tools *toolset) portfolioHistory(ctx context.Context, userID uuid.UUID, input portfolioHistoryInput) (PortfolioHistory, error) {
	rangeName, err := parseRange(input.Range)
	if err != nil {
		return PortfolioHistory{}, err
	}
	interval := input.Interval
	if interval == "" {
		interval = "month"
	}
	if interval != "month" && interval != "week" && interval != "day" {
		return PortfolioHistory{}, invalid("interval must be month, week, or day")
	}
	dashboard, err := tools.readers.Reports.Dashboard(ctx, userID, rangeName)
	if err != nil {
		return PortfolioHistory{}, err
	}
	base := dashboard.BaseCurrency
	bucket := func(date string) string {
		parsed, err := time.Parse(time.DateOnly, date)
		if err != nil {
			return date
		}
		switch interval {
		case "month":
			return date[:7]
		case "week":
			year, week := parsed.ISOWeek()
			return strconv.Itoa(year) + "-" + strconv.Itoa(week)
		}
		return date
	}
	points := []PortfolioPoint{}
	lastBucket := ""
	for _, point := range dashboard.History {
		item := PortfolioPoint{Date: point.Date, NetWorth: money(point.NetWorthMinor, base), Assets: money(point.AssetsMinor, base),
			Liabilities: money(point.LiabilitiesMinor, base), Investible: money(point.InvestibleMinor, base), Complete: point.Complete}
		key := bucket(point.Date)
		if len(points) > 0 && key == lastBucket {
			points[len(points)-1] = item
			continue
		}
		points, lastBucket = append(points, item), key
	}
	recent, truncated := lastN(points, maxHistoryPoints)
	return PortfolioHistory{BaseCurrency: base, Range: rangeName, Interval: interval, Complete: dashboard.HistoricalComplete, Points: recent, Truncated: truncated}, nil
}

type auditLogInput struct {
	AccountID string `json:"accountId,omitempty"`
	Tool      string `json:"tool,omitempty" jsonschema:"Only changes made by this tool, such as commit_import."`
	From      string `json:"from,omitempty"`
	To        string `json:"to,omitempty"`
	Limit     int    `json:"limit,omitempty"`
	Offset    int    `json:"offset,omitempty"`
}

type AuditItem struct {
	ID         string   `json:"id"`
	At         string   `json:"at"`
	Channel    string   `json:"channel"`
	Client     string   `json:"client,omitempty" jsonschema:"grant:<id> for an OAuth connection or key:<id> for an API key."`
	Tool       string   `json:"tool"`
	Action     string   `json:"action"`
	RecordType string   `json:"recordType"`
	RecordIDs  []string `json:"recordIds"`
	AccountID  string   `json:"accountId,omitempty"`
	ImportID   string   `json:"importId,omitempty"`
}

type AuditLogResult struct {
	Entries    []AuditItem `json:"entries"`
	Limit      int         `json:"limit"`
	Offset     int         `json:"offset"`
	HasMore    bool        `json:"hasMore"`
	NextOffset *int        `json:"nextOffset,omitempty"`
}

func (tools *toolset) auditLog(ctx context.Context, userID uuid.UUID, input auditLogInput) (AuditLogResult, error) {
	page, err := pageArgs(input.Limit, input.Offset)
	if err != nil {
		return AuditLogResult{}, err
	}
	filter := service.AuditFilter{Tool: input.Tool, Page: page}
	if filter.AccountID, err = optionalUUIDArg("accountId", input.AccountID); err != nil {
		return AuditLogResult{}, err
	}
	if filter.From, filter.To, err = dateRange(input.From, input.To); err != nil {
		return AuditLogResult{}, err
	}
	listed, err := tools.readers.Manage.Audit.List(ctx, userID, filter)
	if err != nil {
		return AuditLogResult{}, err
	}
	result := AuditLogResult{Entries: []AuditItem{}, Limit: listed.Limit, Offset: listed.Offset, HasMore: listed.HasMore, NextOffset: nextOffset(page, len(listed.Items), listed.HasMore)}
	for _, entry := range listed.Items {
		result.Entries = append(result.Entries, AuditItem{ID: entry.ID.String(), At: entry.CreatedAt.UTC().Format(time.RFC3339), Channel: entry.Channel, Client: entry.Client,
			Tool: entry.Tool, Action: entry.Action, RecordType: entry.RecordType, RecordIDs: idStrings(entry.RecordIDs), AccountID: optionalID(entry.AccountID), ImportID: optionalID(entry.ImportBatchID)})
	}
	return result, nil
}
