import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import {
  DEFAULT_BASE_CURRENCY,
  DEFAULT_ENABLED_CURRENCIES,
} from "../lib/currencies";

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

export const accountTrackingModes = ["balance", "positions"] as const;
export const investmentIdentifierTypes = [
  "isin",
  "ticker_exchange",
  "custom",
] as const;
export const investmentAssetTypes = ["stock", "etf", "fund"] as const;
export const positionEventTypes = [
  "opening_position",
  "buy",
  "sell",
  "quantity_adjustment",
] as const;

export const goalStatuses = [
  "active",
  "paused",
  "completed",
  "cancelled",
] as const;
export const contributionFrequencies = [
  "weekly",
  "monthly",
  "quarterly",
  "annually",
  "custom",
] as const;

export const userStatuses = ["active", "disabled"] as const;
export const institutionTypes = [
  "bank",
  "credit_union",
  "brokerage",
  "asset_manager",
  "pension_provider",
  "insurer",
  "lender",
  "digital_wallet",
  "government",
  "employer",
  "other",
] as const;
export const aiProviders = ["openai", "deepseek", "custom"] as const;
export const aiRequestStatuses = [
  "started",
  "success",
  "error",
  "rate_limited",
  "budget_exceeded",
] as const;
export const beneficiaryKinds = ["person", "organization", "trust"] as const;
export const estateTransferContexts = [
  "estate",
  "joint_survivorship",
  "provider_designation",
  "trust_entity",
  "unknown",
] as const;
export const estateDistributionMethods = [
  "transfer_asset",
  "sell_and_divide",
  "cash_equivalent",
  "undecided",
] as const;
export const estateAllocationTiers = ["primary", "contingent"] as const;

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    passwordHash: text("password_hash"),
    status: text("status", { enum: userStatuses }).notNull().default("active"),
    sessionVersion: integer("session_version").notNull().default(1),
    lastLoginAt: text("last_login_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("users_username_unique").on(table.username)],
);

export const oidcIdentities = sqliteTable(
  "oidc_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    lastLoginAt: text("last_login_at").notNull(),
  },
  (table) => [
    index("oidc_identities_user_idx").on(table.userId),
    uniqueIndex("oidc_identities_issuer_subject_unique").on(
      table.issuer,
      table.subject,
    ),
    uniqueIndex("oidc_identities_user_issuer_unique").on(
      table.userId,
      table.issuer,
    ),
  ],
);

export const userSettings = sqliteTable(
  "user_settings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    baseCurrency: text("base_currency")
      .notNull()
      .default(DEFAULT_BASE_CURRENCY),
    supportedCurrencies: text("supported_currencies")
      .notNull()
      .default(JSON.stringify(DEFAULT_ENABLED_CURRENCIES)),
    timezone: text("timezone").notNull().default("Africa/Nairobi"),
    preferredDateFormat: text("preferred_date_format")
      .notNull()
      .default("dd MMM yyyy"),
    appName: text("app_name").notNull().default("Wealthboard"),
    defaultDashboardPeriod: text("default_dashboard_period")
      .notNull()
      .default("1y"),
    sessionTimeoutMinutes: integer("session_timeout_minutes")
      .notNull()
      .default(10080),
    defaultGoalReturnBps: integer("default_goal_return_bps")
      .notNull()
      .default(800),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("user_settings_user_unique").on(table.userId)],
);

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
    isLiquid: integer("is_liquid", { mode: "boolean" })
      .notNull()
      .default(false),
    isInvestible: integer("is_investible", { mode: "boolean" })
      .notNull()
      .default(true),
    isArchived: integer("is_archived", { mode: "boolean" })
      .notNull()
      .default(false),
    isSystem: integer("is_system", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("categories_user_id_unique").on(table.userId, table.id),
    uniqueIndex("categories_user_slug_unique").on(table.userId, table.slug),
  ],
);

export const institutions = sqliteTable(
  "institutions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    type: text("type", { enum: institutionTypes }).notNull().default("other"),
    websiteUrl: text("website_url"),
    countryCode: text("country_code"),
    address: text("address"),
    notes: text("notes"),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("institutions_user_id_unique").on(table.userId, table.id),
    uniqueIndex("institutions_user_name_unique").on(
      table.userId,
      table.normalizedName,
    ),
    index("institutions_user_archived_idx").on(table.userId, table.archivedAt),
  ],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    categoryId: text("category_id").notNull(),
    institutionId: text("institution_id"),
    accountReference: text("account_reference"),
    currency: text("currency").notNull(),
    trackingMode: text("tracking_mode", { enum: accountTrackingModes })
      .notNull()
      .default("balance"),
    currentValueMinor: integer("current_value_minor").notNull().default(0),
    costBasisMinor: integer("cost_basis_minor"),
    isLiability: integer("is_liability", { mode: "boolean" })
      .notNull()
      .default(false),
    isIncludedInNetWorth: integer("is_included_in_net_worth", {
      mode: "boolean",
    })
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
    uniqueIndex("accounts_user_id_unique").on(table.userId, table.id),
    index("accounts_user_category_idx").on(table.userId, table.categoryId),
    index("accounts_user_goal_idx").on(table.userId, table.goalId),
    index("accounts_user_archived_idx").on(table.userId, table.archivedAt),
    foreignKey({
      columns: [table.userId, table.categoryId],
      foreignColumns: [categories.userId, categories.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.userId, table.institutionId],
      foreignColumns: [institutions.userId, institutions.id],
    }).onDelete("restrict"),
  ],
);

export const investmentInstruments = sqliteTable(
  "investment_instruments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    externalId: text("external_id"),
    name: text("name").notNull(),
    symbol: text("symbol"),
    identifierType: text("identifier_type", {
      enum: investmentIdentifierTypes,
    }).notNull(),
    identifier: text("identifier"),
    exchangeMic: text("exchange_mic"),
    assetType: text("asset_type", { enum: investmentAssetTypes }).notNull(),
    quoteCurrency: text("quote_currency").notNull(),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("investment_instruments_user_id_unique").on(
      table.userId,
      table.id,
    ),
    uniqueIndex("investment_instruments_user_external_unique").on(
      table.userId,
      table.externalId,
    ),
    uniqueIndex("investment_instruments_user_identifier_unique").on(
      table.userId,
      table.identifierType,
      table.identifier,
      table.exchangeMic,
    ),
    index("investment_instruments_user_archived_idx").on(
      table.userId,
      table.archivedAt,
    ),
  ],
);

export const positionEvents = sqliteTable(
  "position_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    instrumentId: text("instrument_id").notNull(),
    type: text("type", { enum: positionEventTypes }).notNull(),
    quantity: text("quantity").notNull(),
    unitPrice: text("unit_price"),
    tradeCurrency: text("trade_currency").notNull(),
    grossAmountMinor: integer("gross_amount_minor"),
    feeAmountMinor: integer("fee_amount_minor"),
    feeCurrency: text("fee_currency"),
    cashEffectMinor: integer("cash_effect_minor").notNull().default(0),
    appliedExchangeRate: text("applied_exchange_rate"),
    openingCostBasisMinor: integer("opening_cost_basis_minor"),
    tradeDate: text("trade_date").notNull(),
    settlementDate: text("settlement_date"),
    externalId: text("external_id"),
    eventGroupId: text("event_group_id"),
    idempotencyKey: text("idempotency_key"),
    description: text("description"),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("position_events_user_id_unique").on(table.userId, table.id),
    uniqueIndex("position_events_user_account_external_unique").on(
      table.userId,
      table.accountId,
      table.externalId,
    ),
    uniqueIndex("position_events_user_idempotency_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
    index("position_events_user_account_date_idx").on(
      table.userId,
      table.accountId,
      table.tradeDate,
      table.createdAt,
      table.id,
    ),
    index("position_events_user_instrument_date_idx").on(
      table.userId,
      table.instrumentId,
      table.tradeDate,
    ),
    foreignKey({
      columns: [table.userId, table.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId, table.instrumentId],
      foreignColumns: [investmentInstruments.userId, investmentInstruments.id],
    }).onDelete("restrict"),
  ],
);

export const securityPrices = sqliteTable(
  "security_prices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    instrumentId: text("instrument_id").notNull(),
    externalId: text("external_id"),
    price: text("price").notNull(),
    currency: text("currency").notNull(),
    effectiveDate: text("effective_date").notNull(),
    source: text("source").notNull().default("manual"),
    provenance: text("provenance"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("security_prices_user_id_unique").on(table.userId, table.id),
    uniqueIndex("security_prices_user_instrument_date_unique").on(
      table.userId,
      table.instrumentId,
      table.effectiveDate,
    ),
    uniqueIndex("security_prices_user_instrument_external_unique").on(
      table.userId,
      table.instrumentId,
      table.externalId,
    ),
    index("security_prices_user_instrument_lookup_idx").on(
      table.userId,
      table.instrumentId,
      table.effectiveDate,
    ),
    foreignKey({
      columns: [table.userId, table.instrumentId],
      foreignColumns: [investmentInstruments.userId, investmentInstruments.id],
    }).onDelete("cascade"),
  ],
);

export const positionReconciliations = sqliteTable(
  "position_reconciliations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    observationDate: text("observation_date").notNull(),
    reportedCashMinor: integer("reported_cash_minor"),
    reportedTotalMinor: integer("reported_total_minor").notNull(),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("position_reconciliations_user_id_unique").on(
      table.userId,
      table.id,
    ),
    index("position_reconciliations_user_account_date_idx").on(
      table.userId,
      table.accountId,
      table.observationDate,
    ),
    foreignKey({
      columns: [table.userId, table.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }).onDelete("cascade"),
  ],
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    type: text("type", { enum: transactionTypes }).notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    transactionDate: text("transaction_date").notNull(),
    description: text("description"),
    notes: text("notes"),
    externalId: text("external_id"),
    transferGroupId: text("transfer_group_id"),
    idempotencyKey: text("idempotency_key"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("transactions_user_date_created_id_idx").on(
      table.userId,
      table.transactionDate,
      table.createdAt,
      table.id,
    ),
    index("transactions_user_account_date_created_id_idx").on(
      table.userId,
      table.accountId,
      table.transactionDate,
      table.createdAt,
      table.id,
    ),
    index("transactions_user_type_date_created_id_idx").on(
      table.userId,
      table.type,
      table.transactionDate,
      table.createdAt,
      table.id,
    ),
    index("transactions_user_transfer_group_idx").on(
      table.userId,
      table.transferGroupId,
    ),
    uniqueIndex("transactions_user_idempotency_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
    uniqueIndex("transactions_user_account_external_unique").on(
      table.userId,
      table.accountId,
      table.externalId,
    ),
    foreignKey({
      columns: [table.userId, table.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }).onDelete("cascade"),
  ],
);

export const valuationSnapshots = sqliteTable(
  "valuation_snapshots",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    valueMinor: integer("value_minor").notNull(),
    currency: text("currency").notNull(),
    valuationDate: text("valuation_date").notNull(),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("valuations_user_account_date_idx").on(
      table.userId,
      table.accountId,
      table.valuationDate,
    ),
    foreignKey({
      columns: [table.userId, table.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }).onDelete("cascade"),
  ],
);

export const exchangeRates = sqliteTable(
  "exchange_rates",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    baseCurrency: text("base_currency").notNull(),
    quoteCurrency: text("quote_currency").notNull(),
    rate: text("rate").notNull(),
    effectiveDate: text("effective_date").notNull(),
    source: text("source").notNull().default("manual"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("exchange_rate_user_pair_date_unique").on(
      table.userId,
      table.baseCurrency,
      table.quoteCurrency,
      table.effectiveDate,
    ),
    index("exchange_rate_user_lookup_idx").on(
      table.userId,
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
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    targetAmountMinor: integer("target_amount_minor").notNull(),
    currentAmountMinor: integer("current_amount_minor").notNull().default(0),
    currency: text("currency").notNull(),
    targetDate: text("target_date").notNull(),
    linkedAccountId: text("linked_account_id"),
    icon: text("icon").notNull().default("Target"),
    status: text("status", { enum: goalStatuses }).notNull().default("active"),
    priority: integer("priority").notNull().default(0),
    assumedAnnualReturnBps: integer("assumed_annual_return_bps")
      .notNull()
      .default(800),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("goals_user_id_unique").on(table.userId, table.id),
    index("goals_user_status_idx").on(table.userId, table.status),
    uniqueIndex("goals_user_account_unique").on(
      table.userId,
      table.linkedAccountId,
    ),
    foreignKey({
      columns: [table.userId, table.linkedAccountId],
      foreignColumns: [accounts.userId, accounts.id],
    }).onDelete("set null"),
  ],
);

export const goalContributionPlans = sqliteTable(
  "goal_contribution_plans",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    goalId: text("goal_id").notNull(),
    plannedContributionMinor: integer("planned_contribution_minor").notNull(),
    frequency: text("frequency", { enum: contributionFrequencies }).notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("goal_plans_user_goal_idx").on(table.userId, table.goalId),
    foreignKey({
      columns: [table.userId, table.goalId],
      foreignColumns: [goals.userId, goals.id],
    }).onDelete("cascade"),
  ],
);

export const goalMilestones = sqliteTable(
  "goal_milestones",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    goalId: text("goal_id").notNull(),
    name: text("name").notNull(),
    targetAmountMinor: integer("target_amount_minor").notNull(),
    targetDate: text("target_date"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("goal_milestones_user_goal_target_idx").on(
      table.userId,
      table.goalId,
      table.targetAmountMinor,
    ),
    foreignKey({
      columns: [table.userId, table.goalId],
      foreignColumns: [goals.userId, goals.id],
    }).onDelete("cascade"),
  ],
);

export const goalAlertDismissals = sqliteTable(
  "goal_alert_dismissals",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    goalId: text("goal_id").notNull(),
    alertKey: text("alert_key").notNull(),
    dismissedAt: text("dismissed_at").notNull(),
  },
  (table) => [
    uniqueIndex("goal_alert_dismissals_user_goal_key_unique").on(
      table.userId,
      table.goalId,
      table.alertKey,
    ),
    index("goal_alert_dismissals_user_dismissed_idx").on(
      table.userId,
      table.dismissedAt,
    ),
    foreignKey({
      columns: [table.userId, table.goalId],
      foreignColumns: [goals.userId, goals.id],
    }).onDelete("cascade"),
  ],
);

export const beneficiaries = sqliteTable(
  "beneficiaries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: beneficiaryKinds }).notNull(),
    name: text("name").notNull(),
    relationship: text("relationship"),
    contactSummary: text("contact_summary"),
    notes: text("notes"),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("beneficiaries_user_id_unique").on(table.userId, table.id),
    index("beneficiaries_user_archived_idx").on(table.userId, table.archivedAt),
  ],
);

export const estatePlans = sqliteTable(
  "estate_plans",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("My estate plan"),
    jurisdiction: text("jurisdiction"),
    lastReviewedDate: text("last_reviewed_date"),
    reviewReminderDate: text("review_reminder_date"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("estate_plans_user_id_unique").on(table.userId, table.id),
    uniqueIndex("estate_plans_user_unique").on(table.userId),
  ],
);

export const estateAccountDirectives = sqliteTable(
  "estate_account_directives",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    estatePlanId: text("estate_plan_id").notNull(),
    accountId: text("account_id").notNull(),
    isIncluded: integer("is_included", { mode: "boolean" })
      .notNull()
      .default(true),
    ownershipShareBps: integer("ownership_share_bps").notNull().default(10000),
    transferContext: text("transfer_context", {
      enum: estateTransferContexts,
    })
      .notNull()
      .default("unknown"),
    distributionMethod: text("distribution_method", {
      enum: estateDistributionMethods,
    })
      .notNull()
      .default("undecided"),
    documentReference: text("document_reference"),
    notes: text("notes"),
    reviewedAt: text("reviewed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("estate_directives_user_id_unique").on(table.userId, table.id),
    uniqueIndex("estate_directives_user_plan_account_unique").on(
      table.userId,
      table.estatePlanId,
      table.accountId,
    ),
    uniqueIndex("estate_directives_user_plan_id_unique").on(
      table.userId,
      table.estatePlanId,
      table.id,
    ),
    index("estate_directives_user_plan_idx").on(
      table.userId,
      table.estatePlanId,
    ),
    foreignKey({
      columns: [table.userId, table.estatePlanId],
      foreignColumns: [estatePlans.userId, estatePlans.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId, table.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }).onDelete("cascade"),
  ],
);

export const estateAllocations = sqliteTable(
  "estate_allocations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    estatePlanId: text("estate_plan_id").notNull(),
    directiveId: text("directive_id").notNull(),
    beneficiaryId: text("beneficiary_id").notNull(),
    tier: text("tier", { enum: estateAllocationTiers }).notNull(),
    allocationBps: integer("allocation_bps").notNull(),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("estate_allocations_user_id_unique").on(table.userId, table.id),
    uniqueIndex("estate_allocations_user_directive_beneficiary_tier_unique").on(
      table.userId,
      table.directiveId,
      table.beneficiaryId,
      table.tier,
    ),
    index("estate_allocations_user_plan_idx").on(
      table.userId,
      table.estatePlanId,
    ),
    foreignKey({
      columns: [table.userId, table.estatePlanId, table.directiveId],
      foreignColumns: [
        estateAccountDirectives.userId,
        estateAccountDirectives.estatePlanId,
        estateAccountDirectives.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId, table.beneficiaryId],
      foreignColumns: [beneficiaries.userId, beneficiaries.id],
    }).onDelete("restrict"),
  ],
);

export const estateResiduaryAllocations = sqliteTable(
  "estate_residuary_allocations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    estatePlanId: text("estate_plan_id").notNull(),
    beneficiaryId: text("beneficiary_id").notNull(),
    tier: text("tier", { enum: estateAllocationTiers }).notNull(),
    allocationBps: integer("allocation_bps").notNull(),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("estate_residuary_user_id_unique").on(table.userId, table.id),
    uniqueIndex("estate_residuary_user_plan_beneficiary_tier_unique").on(
      table.userId,
      table.estatePlanId,
      table.beneficiaryId,
      table.tier,
    ),
    index("estate_residuary_user_plan_idx").on(
      table.userId,
      table.estatePlanId,
    ),
    foreignKey({
      columns: [table.userId, table.estatePlanId],
      foreignColumns: [estatePlans.userId, estatePlans.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId, table.beneficiaryId],
      foreignColumns: [beneficiaries.userId, beneficiaries.id],
    }).onDelete("restrict"),
  ],
);

export const estatePlanSnapshots = sqliteTable(
  "estate_plan_snapshots",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    estatePlanId: text("estate_plan_id").notNull(),
    version: integer("version").notNull().default(1),
    title: text("title").notNull(),
    valueAsOfDate: text("value_as_of_date").notNull(),
    baseCurrency: text("base_currency").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    generatedAt: text("generated_at").notNull(),
  },
  (table) => [
    uniqueIndex("estate_snapshots_user_id_unique").on(table.userId, table.id),
    index("estate_snapshots_user_plan_generated_idx").on(
      table.userId,
      table.estatePlanId,
      table.generatedAt,
    ),
    foreignKey({
      columns: [table.userId, table.estatePlanId],
      foreignColumns: [estatePlans.userId, estatePlans.id],
    }).onDelete("cascade"),
  ],
);

export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    id: text("id").primaryKey(),
    clientKey: text("client_key").notNull(),
    succeeded: integer("succeeded", { mode: "boolean" })
      .notNull()
      .default(false),
    attemptedAt: text("attempted_at").notNull(),
  },
  (table) => [
    index("login_attempt_client_time_idx").on(
      table.clientKey,
      table.attemptedAt,
    ),
  ],
);

export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    operation: text("operation").notNull(),
    resultId: text("result_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idempotency_user_key_unique").on(table.userId, table.key),
    index("idempotency_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const aiProviderSettings = sqliteTable(
  "ai_provider_settings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: aiProviders }).notNull(),
    baseUrl: text("base_url").notNull(),
    model: text("model").notNull(),
    encryptedApiKey: text("encrypted_api_key"),
    apiKeyHint: text("api_key_hint"),
    includeExactAmounts: integer("include_exact_amounts", { mode: "boolean" })
      .notNull()
      .default(false),
    includeAccountNames: integer("include_account_names", { mode: "boolean" })
      .notNull()
      .default(false),
    monthlyTokenLimit: integer("monthly_token_limit").notNull().default(100000),
    maxOutputTokens: integer("max_output_tokens").notNull().default(1200),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("ai_provider_settings_user_unique").on(table.userId)],
);

export const aiUsageEvents = sqliteTable(
  "ai_usage_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: aiProviders }).notNull(),
    endpointHost: text("endpoint_host").notNull(),
    model: text("model").notNull(),
    requestType: text("request_type").notNull().default("portfolio_review"),
    status: text("status", { enum: aiRequestStatuses }).notNull(),
    billingMonth: text("billing_month").notNull(),
    chargedTokens: integer("charged_tokens").notNull().default(0),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("ai_usage_user_month_idx").on(table.userId, table.billingMonth),
    index("ai_usage_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export type Account = typeof accounts.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Institution = typeof institutions.$inferSelect;
export type InvestmentInstrument = typeof investmentInstruments.$inferSelect;
export type PositionEvent = typeof positionEvents.$inferSelect;
export type SecurityPrice = typeof securityPrices.$inferSelect;
export type PositionReconciliation =
  typeof positionReconciliations.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type ValuationSnapshot = typeof valuationSnapshots.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type GoalMilestone = typeof goalMilestones.$inferSelect;
export type Beneficiary = typeof beneficiaries.$inferSelect;
export type EstatePlan = typeof estatePlans.$inferSelect;
export type EstateAccountDirective =
  typeof estateAccountDirectives.$inferSelect;
export type EstateAllocation = typeof estateAllocations.$inferSelect;
export type EstateResiduaryAllocation =
  typeof estateResiduaryAllocations.$inferSelect;
export type EstatePlanSnapshot = typeof estatePlanSnapshots.$inferSelect;
export type User = typeof users.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type AiProviderSettings = typeof aiProviderSettings.$inferSelect;
export type TransactionType = (typeof transactionTypes)[number];
export type AccountTrackingMode = (typeof accountTrackingModes)[number];
export type InvestmentIdentifierType =
  (typeof investmentIdentifierTypes)[number];
export type InvestmentAssetType = (typeof investmentAssetTypes)[number];
export type PositionEventType = (typeof positionEventTypes)[number];
export type GoalStatus = (typeof goalStatuses)[number];
export type InstitutionType = (typeof institutionTypes)[number];
export type AiProvider = (typeof aiProviders)[number];
export type BeneficiaryKind = (typeof beneficiaryKinds)[number];
export type EstateTransferContext = (typeof estateTransferContexts)[number];
export type EstateDistributionMethod =
  (typeof estateDistributionMethods)[number];
export type EstateAllocationTier = (typeof estateAllocationTiers)[number];
