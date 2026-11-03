package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

type insightsFixtureUser struct {
	userID, savings, broker, dollar, archived, instrument, goal uuid.UUID
}

func TestInsightsReadsAreOwnerScopedAcrossTwoUsers(t *testing.T) {
	db := openServiceTestDatabase(t)
	ctx := context.Background()
	seed := func(label, instrumentName string, openingMinor int64) insightsFixtureUser {
		user := insightsFixtureUser{userID: uuid.New(), savings: uuid.New(), broker: uuid.New(), dollar: uuid.New(),
			archived: uuid.New(), instrument: uuid.New(), goal: uuid.New()}
		category := uuid.New()
		for _, statement := range []struct {
			query string
			args  []any
		}{
			{`INSERT INTO users (id,username,created_at,updated_at) VALUES ($1,$2,now(),now())`, []any{user.userID, "insights-" + label + "-" + user.userID.String()}},
			{`INSERT INTO user_settings (id,user_id,display_name,base_currency,supported_currencies,timezone,created_at,updated_at) VALUES ($1,$2,$3,'KES','["USD","EUR"]','UTC',now(),now())`, []any{uuid.New(), user.userID, label}},
			{`INSERT INTO categories (id,user_id,name,slug,is_liquid,created_at,updated_at) VALUES ($1,$2,'Savings','savings',true,now(),now())`, []any{category, user.userID}},
			{`INSERT INTO accounts (id,user_id,name,category_id,currency,tracking_mode,created_at,updated_at) VALUES ($1,$2,$3,$4,'KES','balance','2026-01-01T08:00:00Z','2026-01-01T08:00:00Z')`, []any{user.savings, user.userID, label + " savings", category}},
			{`INSERT INTO accounts (id,user_id,name,category_id,currency,tracking_mode,created_at,updated_at) VALUES ($1,$2,$3,$4,'KES','positions','2026-01-01T08:00:00Z','2026-01-01T08:00:00Z')`, []any{user.broker, user.userID, label + " broker", category}},
			{`INSERT INTO accounts (id,user_id,name,category_id,currency,created_at,updated_at) VALUES ($1,$2,$3,$4,'USD','2026-01-01T08:00:00Z','2026-01-01T08:00:00Z')`, []any{user.dollar, user.userID, label + " dollars", category}},
			{`INSERT INTO accounts (id,user_id,name,category_id,currency,archived_at,created_at,updated_at) VALUES ($1,$2,$3,$4,'KES','2026-02-01T00:00:00Z','2026-01-01T08:00:00Z','2026-01-01T08:00:00Z')`, []any{user.archived, user.userID, label + " closed", category}},
			{`INSERT INTO transactions (id,user_id,account_id,type,amount_minor,currency,transaction_date,description,created_at,updated_at) VALUES ($1,$2,$3,'opening_balance',$4,'KES','2026-01-05','Opening balance','2026-01-05T09:00:00Z','2026-01-05T09:00:00Z')`, []any{uuid.New(), user.userID, user.savings, openingMinor}},
			{`INSERT INTO transactions (id,user_id,account_id,type,amount_minor,currency,transaction_date,description,created_at,updated_at) VALUES ($1,$2,$3,'withdrawal',2500,'KES','2026-02-10','ATM','2026-02-10T09:00:00Z','2026-02-11T09:00:00Z')`, []any{uuid.New(), user.userID, user.savings}},
			{`INSERT INTO transactions (id,user_id,account_id,type,amount_minor,currency,transaction_date,created_at,updated_at) VALUES ($1,$2,$3,'deposit',50000,'KES','2026-01-06',now(),now())`, []any{uuid.New(), user.userID, user.broker}},
			{`INSERT INTO transactions (id,user_id,account_id,type,amount_minor,currency,transaction_date,created_at,updated_at) VALUES ($1,$2,$3,'opening_balance',100,'USD','2026-01-07',now(),now())`, []any{uuid.New(), user.userID, user.dollar}},
			{`INSERT INTO transactions (id,user_id,account_id,type,amount_minor,currency,transaction_date,created_at,updated_at) VALUES ($1,$2,$3,'opening_balance',700,'KES','2026-01-08',now(),now())`, []any{uuid.New(), user.userID, user.archived}},
			{`INSERT INTO investment_instruments (id,user_id,name,symbol,identifier_type,asset_type,quote_currency,created_at,updated_at) VALUES ($1,$2,$3,$4,'custom','fund','KES',now(),now())`, []any{user.instrument, user.userID, instrumentName, strings.ToUpper(label)}},
			{`INSERT INTO position_events (id,user_id,account_id,instrument_id,type,quantity,trade_currency,trade_date,description,created_at,updated_at) VALUES ($1,$2,$3,$4,'opening_position',4,'KES','2026-01-06','Initial units','2026-01-06T10:00:00Z','2026-01-06T10:00:00Z')`, []any{uuid.New(), user.userID, user.broker, user.instrument}},
			{`INSERT INTO position_events (id,user_id,account_id,instrument_id,type,quantity,trade_currency,trade_date,created_at,updated_at) VALUES ($1,$2,$3,$4,'opening_position',1,'KES','2026-01-08',now(),now())`, []any{uuid.New(), user.userID, user.archived, user.instrument}},
			{`INSERT INTO security_prices (id,user_id,instrument_id,price,currency,effective_date,source,created_at,updated_at) VALUES ($1,$2,$3,125,'KES','2026-02-20','manual',now(),now())`, []any{uuid.New(), user.userID, user.instrument}},
			{`INSERT INTO valuation_snapshots (id,user_id,account_id,value_minor,currency,valuation_date,created_at) VALUES ($1,$2,$3,$4,'KES','2026-02-15','2026-02-15T12:00:00Z')`, []any{uuid.New(), user.userID, user.savings, openingMinor}},
			{`INSERT INTO goals (id,user_id,name,target_amount_minor,currency,target_date,linked_account_id,created_at,updated_at) VALUES ($1,$2,$3,1000000,'KES','2030-01-01',$4,now(),now())`, []any{user.goal, user.userID, label + " goal", user.savings}},
		} {
			if _, err := db.ExecContext(ctx, statement.query, statement.args...); err != nil {
				t.Fatalf("seed %s insights fixture: %v", label, err)
			}
		}
		return user
	}
	owner := seed("owner", "Owner Growth Fund", 100000)
	foreign := seed("foreign", "Foreign Income Fund", 999999)

	now := func() time.Time { return time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC) }
	insights := NewInsightsService(NewSQLGoalsReportsRepository(db))
	insights.now = now
	coreReads := NewCoreReadService(NewSQLCoreReadRepository(db))
	coreReads.now = now

	for _, user := range []insightsFixtureUser{owner, foreign} {
		other := foreign
		if user.userID == foreign.userID {
			other = owner
		}
		ownAccounts := map[uuid.UUID]bool{user.savings: true, user.broker: true, user.dollar: true, user.archived: true}
		summaries, err := insights.AccountSummaries(ctx, user.userID)
		if err != nil {
			t.Fatalf("summaries: %v", err)
		}
		if len(summaries) != 4 {
			t.Fatalf("summaries must include active and archived owner accounts only: %+v", summaries)
		}
		for _, summary := range summaries {
			if !ownAccounts[summary.AccountID] {
				t.Fatalf("summary leaked another user's account %s", summary.AccountID)
			}
			if summary.AccountID == user.savings && (len(summary.LinkedGoals) != 1 || summary.LinkedGoals[0].ID != user.goal ||
				summary.LastUpdatedAt != "2026-02-15T12:00:00Z" || summary.AsOfDate != "2026-02-15" || summary.Freshness != "fresh") {
				t.Fatalf("savings summary = %+v", summary)
			}
			if summary.AccountID == user.broker && (summary.PositionCount == nil || *summary.PositionCount != 1 || summary.AsOfDate != "2026-02-20" || summary.Freshness != "fresh") {
				t.Fatalf("broker summary = %+v", summary)
			}
			if summary.AccountID == user.dollar && (summary.ValueComplete || len(summary.MissingCurrencies) != 1) {
				t.Fatalf("dollar summary = %+v", summary)
			}
		}

		attention, err := insights.Attention(ctx, user.userID)
		if err != nil {
			t.Fatalf("attention: %v", err)
		}
		foundMissingRate := false
		for _, item := range attention.Items {
			for _, accountID := range item.AccountIDs {
				if !ownAccounts[accountID] {
					t.Fatalf("attention leaked account %s: %+v", accountID, item)
				}
			}
			if item.InstrumentID != nil && *item.InstrumentID == other.instrument || item.GoalID != nil && *item.GoalID == other.goal {
				t.Fatalf("attention leaked another user's resource: %+v", item)
			}
			if item.ID == "missing_rate:USD" && len(item.AccountIDs) == 1 && item.AccountIDs[0] == user.dollar {
				foundMissingRate = true
			}
		}
		if !foundMissingRate || attention.TotalsComplete {
			t.Fatalf("attention = %+v", attention)
		}

		extras, err := insights.AccountExtras(ctx, user.userID, user.broker)
		if err != nil || len(extras.Weights) != 1 || extras.Weights[0].InstrumentID != user.instrument || extras.Weights[0].WeightPercent == nil ||
			*extras.Weights[0].WeightPercent != "50.0" || len(extras.PriceHistory) != 1 || extras.PriceHistory[0].StaleThresholdDays != 31 {
			t.Fatalf("owner extras = %+v err=%v", extras, err)
		}
		if _, err := insights.AccountExtras(ctx, user.userID, other.broker); !errors.Is(err, ErrGoalsReportsNotFound) {
			t.Fatalf("foreign account extras error = %v", err)
		}
		holdings, err := insights.InstrumentHoldings(ctx, user.userID, user.instrument)
		if err != nil || len(holdings.Holdings) != 1 || holdings.Holdings[0].AccountID != user.broker || *holdings.Holdings[0].ValueMinor != "50000" {
			t.Fatalf("owner holdings = %+v err=%v", holdings, err)
		}
		if _, err := insights.InstrumentHoldings(ctx, user.userID, other.instrument); !errors.Is(err, ErrGoalsReportsNotFound) {
			t.Fatalf("foreign instrument holdings error = %v", err)
		}

		comparison, err := insights.AccountComparison(ctx, user.userID, "all")
		if err != nil || len(comparison.Rows) != 3 {
			t.Fatalf("comparison = %+v err=%v", comparison, err)
		}
		for _, row := range comparison.Rows {
			if !ownAccounts[row.AccountID] || row.AccountID == user.archived {
				t.Fatalf("comparison row outside active owner accounts: %+v", row)
			}
		}
		flows, err := insights.FlowsReport(ctx, user.userID, "")
		if err != nil || flows.Range != "1y" || flows.From != "2026-01-05" || flows.Complete {
			t.Fatalf("flows = %+v err=%v", flows, err)
		}
		if _, err := insights.IncomeReport(ctx, user.userID, "all"); err != nil {
			t.Fatalf("income: %v", err)
		}
		if _, err := insights.NetWorthStats(ctx, user.userID); err != nil {
			t.Fatalf("net worth stats: %v", err)
		}
		if _, err := insights.FlowsReport(ctx, user.userID, "5y"); !errors.Is(err, ErrInsightsInvalidRange) {
			t.Fatalf("invalid range error = %v", err)
		}

		feed, err := coreReads.ActivityFeed(ctx, user.userID, ActivityFilter{})
		if err != nil || len(feed.Items) == 0 {
			t.Fatalf("activity feed = %+v err=%v", feed, err)
		}
		kinds := map[string]int{}
		for _, item := range feed.Items {
			if !ownAccounts[item.AccountID] {
				t.Fatalf("activity feed leaked account %s: %+v", item.AccountID, item)
			}
			kinds[item.Kind]++
			if (item.Kind == "transaction" || item.Kind == "position") != (item.EffectMinor != nil) {
				t.Fatalf("activity effect presence = %+v", item)
			}
			if item.Kind == "transaction" && item.Type == "withdrawal" && *item.EffectMinor != "-2500" {
				t.Fatalf("withdrawal effect = %+v", item)
			}
		}
		// Price rows are emitted once per position account that holds or held the instrument (broker and the
		// archived account), with one valuation, five transactions, and two position events.
		if kinds["transaction"] != 5 || kinds["valuation"] != 1 || kinds["position"] != 2 || kinds["price"] != 2 {
			t.Fatalf("activity kinds = %v", kinds)
		}
		if _, err := coreReads.ActivityFeed(ctx, user.userID, ActivityFilter{AccountID: &other.savings}); !errors.Is(err, ErrCoreReadNotFound) {
			t.Fatalf("foreign activity account error = %v", err)
		}
		// Case-insensitive search on the instrument name matches both position events and both price rows.
		searched, err := coreReads.ActivityFeed(ctx, user.userID, ActivityFilter{Query: strings.ToUpper(strings.Split(insightsFixtureInstrumentName(user, owner), " ")[1])})
		if err != nil || len(searched.Items) != 4 {
			t.Fatalf("instrument search = %+v err=%v", searched, err)
		}
		filtered, err := coreReads.ActivityFeed(ctx, user.userID, ActivityFilter{AccountID: &user.savings, Kind: "transaction", Type: "withdrawal",
			Page: ReadPage{Limit: 1}})
		if err != nil || len(filtered.Items) != 1 || filtered.HasMore || filtered.Items[0].Description != "ATM" {
			t.Fatalf("filtered feed = %+v err=%v", filtered, err)
		}
		accountActivity, err := coreReads.Activity(ctx, user.userID, ActivityFilter{AccountID: &user.broker})
		if err != nil {
			t.Fatalf("account activity: %v", err)
		}
		for _, item := range accountActivity.Items {
			if item.Kind == "transaction" && (item.EffectMinor == nil || *item.EffectMinor != "50000") {
				t.Fatalf("position cash effect = %+v", item)
			}
		}
	}
}

func insightsFixtureInstrumentName(user, owner insightsFixtureUser) string {
	if user.userID == owner.userID {
		return "Owner Growth Fund"
	}
	return "Foreign Income Fund"
}
