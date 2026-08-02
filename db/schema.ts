import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const transactionTypes = [
  "opening_balance",
  "deposit",
  "withdrawal",
  "interest",
  "dividend",
  "capital_gain",
  "capital_loss",
  "fee",
  "purchase",
  "sale",
  "manual_adjustment",
  "liability_payment",
  "liability_increase",
  "transfer",
] as const;

export const goalStatuses = ["active", "paused", "completed", "cancelled"] as const;
export const contributionFrequencies = [
  "weekly",
  "monthly",
  "quarterly",
  "annually",
  "custom",
] as const;

export const userSettings = sqliteTable("user_settings", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  baseCurrency: text("base_currency").notNull().default("KES"),
  supportedCurrencies: text("supported_currencies").notNull().default('["KES","USD"]'),
  timezone: text("timezone").notNull().default("Africa/Nairobi"),
  preferredDateFormat: text("preferred_date_format").notNull().default("dd MMM yyyy"),
  appName: text("app_name").notNull().default("Worthboard"),
  defaultDashboardPeriod: text("default_dashboard_period").notNull().default("1y"),
  sessionTimeoutMinutes: integer("session_timeout_minutes").notNull().default(10080),
  sessionVersion: integer("session_version").notNull().default(1),
  defaultGoalReturnBps: integer("default_goal_return_bps").notNull().default(800),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    icon: text("icon").notNull().default("CircleDollarSign"),
    displayOrder: integer("display_order").notNull().default(0),
    assetOrLiability: text("asset_or_liability", {
      enum: ["asset", "liability"],
    })
      .notNull()
      .default("asset"),
    description: text("description"),
    isLiquid: integer("is_liquid", { mode: "boolean" }).notNull().default(false),
    isInvestible: integer("is_investible", { mode: "boolean" }).notNull().default(true),
    isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("categories_slug_unique").on(table.slug)],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    institution: text("institution"),
    accountReference: text("account_reference"),
    currency: text("currency").notNull(),
    currentValueMinor: integer("current_value_minor").notNull().default(0),
    costBasisMinor: integer("cost_basis_minor"),
    isLiability: integer("is_liability", { mode: "boolean" }).notNull().default(false),
    isIncludedInNetWorth: integer("is_included_in_net_worth", { mode: "boolean" })
      .notNull()
      .default(true),
    goalId: text("goal_id"),
    notes: text("notes"),
    openedAt: text("opened_at"),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("accounts_category_idx").on(table.categoryId),
    index("accounts_goal_idx").on(table.goalId),
    index("accounts_archived_idx").on(table.archivedAt),
  ],
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    type: text("type", { enum: transactionTypes }).notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    transactionDate: text("transaction_date").notNull(),
    description: text("description"),
    notes: text("notes"),
    transferGroupId: text("transfer_group_id"),
    idempotencyKey: text("idempotency_key"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("transactions_account_date_idx").on(table.accountId, table.transactionDate),
    index("transactions_transfer_group_idx").on(table.transferGroupId),
    uniqueIndex("transactions_idempotency_unique").on(table.idempotencyKey),
  ],
);

export const valuationSnapshots = sqliteTable(
  "valuation_snapshots",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    valueMinor: integer("value_minor").notNull(),
    currency: text("currency").notNull(),
    valuationDate: text("valuation_date").notNull(),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("valuations_account_date_idx").on(table.accountId, table.valuationDate),
  ],
);

export const exchangeRates = sqliteTable(
  "exchange_rates",
  {
    id: text("id").primaryKey(),
    baseCurrency: text("base_currency").notNull(),
    quoteCurrency: text("quote_currency").notNull(),
    rate: text("rate").notNull(),
    effectiveDate: text("effective_date").notNull(),
    source: text("source").notNull().default("manual"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("exchange_rate_pair_date_unique").on(
      table.baseCurrency,
      table.quoteCurrency,
      table.effectiveDate,
    ),
    index("exchange_rate_lookup_idx").on(
      table.baseCurrency,
      table.quoteCurrency,
      table.effectiveDate,
    ),
  ],
);

export const goals = sqliteTable(
  "goals",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    targetAmountMinor: integer("target_amount_minor").notNull(),
    currentAmountMinor: integer("current_amount_minor").notNull().default(0),
    currency: text("currency").notNull(),
    targetDate: text("target_date").notNull(),
    linkedAccountId: text("linked_account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    icon: text("icon").notNull().default("Target"),
    status: text("status", { enum: goalStatuses }).notNull().default("active"),
    priority: integer("priority").notNull().default(0),
    assumedAnnualReturnBps: integer("assumed_annual_return_bps").notNull().default(800),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("goals_status_idx").on(table.status),
    uniqueIndex("goals_account_unique").on(table.linkedAccountId),
  ],
);

export const goalContributionPlans = sqliteTable(
  "goal_contribution_plans",
  {
    id: text("id").primaryKey(),
    goalId: text("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    plannedContributionMinor: integer("planned_contribution_minor").notNull(),
    frequency: text("frequency", { enum: contributionFrequencies }).notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("goal_plans_goal_idx").on(table.goalId)],
);

export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    id: text("id").primaryKey(),
    clientKey: text("client_key").notNull(),
    succeeded: integer("succeeded", { mode: "boolean" }).notNull().default(false),
    attemptedAt: text("attempted_at").notNull(),
  },
  (table) => [index("login_attempt_client_time_idx").on(table.clientKey, table.attemptedAt)],
);

export const idempotencyKeys = sqliteTable("idempotency_keys", {
  key: text("key").primaryKey(),
  operation: text("operation").notNull(),
  resultId: text("result_id"),
  createdAt: text("created_at").notNull(),
});

export type Account = typeof accounts.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type ValuationSnapshot = typeof valuationSnapshots.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type TransactionType = (typeof transactionTypes)[number];
export type GoalStatus = (typeof goalStatuses)[number];
