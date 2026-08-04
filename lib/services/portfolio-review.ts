import "server-only";

import Decimal from "decimal.js";
import { count, eq } from "drizzle-orm";

import {
  accounts,
  exchangeRates,
  goals as goalsTable,
  transactions,
  valuationSnapshots,
} from "@/db/schema";
import {
  AI_REVIEW_MAX_ACCOUNTS,
  AI_REVIEW_MAX_EVENTS,
  AI_REVIEW_MAX_GOALS,
} from "@/lib/ai/config";
import {
  portfolioReviewOptionsSchema,
  portfolioReviewSnapshotSchema,
  type PortfolioAiReview,
  type PortfolioReviewOptions,
  type PortfolioReviewSnapshot,
} from "@/lib/ai/schemas";
import { endOfUtcDay } from "@/lib/dates";
import { getDatabase } from "@/lib/db";
import {
  MissingExchangeRateError,
  convertMinor,
  minorToDecimalString,
} from "@/lib/money";
import { listAccounts } from "@/lib/services/accounts";
import { getDashboardData } from "@/lib/services/analytics";
import { listGoals } from "@/lib/services/goals";

function percent(part: number | bigint, whole: number | bigint) {
  const denominator = new Decimal(whole.toString()).abs();
  if (denominator.isZero()) return "0.0";
  return new Decimal(part.toString())
    .abs()
    .div(denominator)
    .mul(100)
    .toDecimalPlaces(1, Decimal.ROUND_HALF_UP)
    .toFixed(1);
}

function signedPercent(part: number | bigint, whole: number | bigint) {
  const denominator = new Decimal(whole.toString()).abs();
  if (denominator.isZero()) return null;
  return new Decimal(part.toString())
    .div(denominator)
    .mul(100)
    .toDecimalPlaces(1, Decimal.ROUND_HALF_UP)
    .toFixed(1);
}

function money(amount: number | bigint, currency: string) {
  return {
    currency,
    amount: minorToDecimalString(amount, currency),
  };
}

function cleanLabel(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 100);
}

function reviewTracking(value: string) {
  if (value === "ahead" || value === "on_track" || value === "behind") {
    return value;
  }
  throw new Error("Goal tracking status is unavailable for review.");
}

export function assertPortfolioReviewWorkload(input: {
  accounts: number;
  goals: number;
  transactions: number;
  valuations: number;
}) {
  if (input.accounts > AI_REVIEW_MAX_ACCOUNTS) {
    throw new Error("This portfolio has too many accounts for an AI review.");
  }
  if (input.goals > AI_REVIEW_MAX_GOALS) {
    throw new Error("This portfolio has too many goals for an AI review.");
  }
  if (input.transactions + input.valuations > AI_REVIEW_MAX_EVENTS) {
    throw new Error("This portfolio has too much activity for an AI review.");
  }
}

export async function buildPortfolioReviewSnapshot(
  userId: string,
  input: Partial<PortfolioReviewOptions> = {},
  now = new Date(),
) {
  const options = portfolioReviewOptionsSchema.parse(input);
  const db = getDatabase();
  const [accountCount, goalCount, transactionCount, valuationCount] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(accounts)
        .where(eq(accounts.userId, userId))
        .get(),
      db
        .select({ value: count() })
        .from(goalsTable)
        .where(eq(goalsTable.userId, userId))
        .get(),
      db
        .select({ value: count() })
        .from(transactions)
        .where(eq(transactions.userId, userId))
        .get(),
      db
        .select({ value: count() })
        .from(valuationSnapshots)
        .where(eq(valuationSnapshots.userId, userId))
        .get(),
    ]);
  assertPortfolioReviewWorkload({
    accounts: accountCount?.value ?? 0,
    goals: goalCount?.value ?? 0,
    transactions: transactionCount?.value ?? 0,
    valuations: valuationCount?.value ?? 0,
  });
  const [dashboard, goals, accountRows, rateRows] = await Promise.all([
    getDashboardData(userId, options.period),
    listGoals(userId, now),
    listAccounts(userId),
    db.select().from(exchangeRates).where(eq(exchangeRates.userId, userId)),
  ]);
  const currency = dashboard.settings.baseCurrency;
  const exact = options.includeExactAmounts;
  const periodStart = dashboard.history[0]?.netWorth ?? 0;
  const periodEnd = dashboard.history.at(-1)?.netWorth ?? 0;
  const periodChange = Math.round(periodEnd - periodStart);
  const currentAsOf = endOfUtcDay(now).toISOString();
  const missingCurrencies = new Set(dashboard.missingRates);

  const convertedAccounts: Array<{
    name: string;
    category: string;
    currency: string;
    value: bigint;
  }> = [];
  for (const account of accountRows) {
    if (account.isLiability || !account.isIncludedInNetWorth) continue;
    try {
      convertedAccounts.push({
        name: account.name,
        category: account.categoryName,
        currency: account.currency,
        value: convertMinor(
          account.currentValueMinor,
          account.currency,
          currency,
          rateRows,
          currentAsOf,
        ),
      });
    } catch (error) {
      if (!(error instanceof MissingExchangeRateError)) throw error;
      missingCurrencies.add(account.currency);
    }
  }
  convertedAccounts.sort((left, right) =>
    left.value === right.value ? 0 : left.value > right.value ? -1 : 1,
  );

  const allocationItems = (
    items: Array<{ name: string; value: number }>,
    prefix: string,
  ) =>
    items.slice(0, 12).map((item, index) => ({
      evidenceId: `${prefix}.${index + 1}`,
      label: cleanLabel(item.name),
      sharePercent: percent(item.value, dashboard.totals.assets),
      ...(exact ? { amount: money(Math.round(item.value), currency) } : {}),
    }));

  const dataQuality: PortfolioReviewSnapshot["dataQuality"] = [];
  if (missingCurrencies.size) {
    dataQuality.push({
      evidenceId: "quality.missing-exchange-rates",
      code: "missing_exchange_rates",
      severity: "critical",
      message: `Converted totals exclude holdings without effective-dated rates for ${[
        ...missingCurrencies,
      ]
        .sort()
        .join(", ")}.`,
    });
  }
  if (!dashboard.historyComplete) {
    dataQuality.push({
      evidenceId: "quality.incomplete-history",
      code: "incomplete_history",
      severity: "warning",
      message:
        "At least one historical point is incomplete because conversion data is missing.",
    });
  }
  if (dashboard.accountCount === 0) {
    dataQuality.push({
      evidenceId: "quality.empty-portfolio",
      code: "empty_portfolio",
      severity: "warning",
      message: "No active financial accounts are available for review.",
    });
  }

  const snapshot: PortfolioReviewSnapshot = {
    schemaVersion: 1,
    asOf: now.toISOString(),
    period: options.period,
    focus: options.focus,
    baseCurrency: currency,
    sharing: {
      exactAmounts: exact,
      accountNames: options.includeAccountNames,
    },
    completeness: {
      complete: missingCurrencies.size === 0 && dashboard.historyComplete,
      missingCurrencies: [...missingCurrencies].sort(),
      omittedMetrics: [
        "Annualized account returns are omitted until a cash-flow-aware methodology is implemented.",
        "Account freshness is omitted until financial-event freshness rules are implemented.",
        "Movement attribution is omitted until deterministic period attribution is implemented.",
      ],
    },
    portfolio: {
      accountCount: dashboard.accountCount,
      goalCount: dashboard.goalCount,
      totals: exact
        ? {
            evidenceId: "portfolio.totals",
            assets: money(dashboard.totals.assets, currency),
            liabilities: money(dashboard.totals.liabilities, currency),
            netWorth: money(dashboard.totals.netWorth, currency),
          }
        : { evidenceId: "portfolio.totals" },
      ratios: {
        evidenceId: "portfolio.ratios",
        liabilitiesToAssetsPercent: percent(
          dashboard.totals.liabilities,
          dashboard.totals.assets,
        ),
        liquidAssetsPercent: percent(
          dashboard.totals.liquid,
          dashboard.totals.assets,
        ),
        investibleAssetsPercent: percent(
          dashboard.totals.investible,
          dashboard.totals.assets,
        ),
      },
      periodChange: {
        evidenceId: "portfolio.period-change",
        percent: signedPercent(periodChange, Math.round(periodStart)),
        ...(exact ? { amount: money(periodChange, currency) } : {}),
      },
    },
    allocations: {
      categories: allocationItems(dashboard.allocation, "allocation.category"),
      currencies: allocationItems(
        dashboard.currencyAllocation,
        "allocation.currency",
      ),
    },
    topAccounts: convertedAccounts.slice(0, 10).map((account, index) => ({
      evidenceId: `account.${index + 1}`,
      alias: `Account ${index + 1}`,
      ...(options.includeAccountNames
        ? { name: cleanLabel(account.name) }
        : {}),
      category: cleanLabel(account.category),
      currency: account.currency,
      sharePercent: percent(account.value, dashboard.totals.assets),
      ...(exact ? { amount: money(account.value, currency) } : {}),
    })),
    cashFlow: {
      evidenceId: "cash-flow.summary",
      contributionsAsPercentOfAssets: percent(
        dashboard.totals.contributions,
        dashboard.totals.assets,
      ),
      withdrawalsAsPercentOfAssets: percent(
        dashboard.totals.withdrawals,
        dashboard.totals.assets,
      ),
      incomeAsPercentOfAssets: percent(
        dashboard.totals.income,
        dashboard.totals.assets,
      ),
      feesAsPercentOfAssets: percent(
        dashboard.totals.fees,
        dashboard.totals.assets,
      ),
      ...(exact
        ? {
            contributions: money(dashboard.totals.contributions, currency),
            withdrawals: money(dashboard.totals.withdrawals, currency),
            income: money(dashboard.totals.income, currency),
            fees: money(dashboard.totals.fees, currency),
          }
        : {}),
    },
    goals: goals.slice(0, 10).map((goal, index) => ({
      evidenceId: `goal.${index + 1}`,
      alias: `Goal ${index + 1}`,
      ...(options.includeAccountNames ? { name: cleanLabel(goal.name) } : {}),
      status: goal.status,
      tracking: reviewTracking(goal.tracking),
      progressPercent: new Decimal(goal.progressPercent)
        .toDecimalPlaces(1, Decimal.ROUND_HALF_UP)
        .toFixed(1),
      plannedToRequiredPercent:
        goal.requiredMonthly > 0n
          ? percent(goal.currentPlannedMonthly, goal.requiredMonthly)
          : null,
      targetDate: goal.targetDate,
      missingExchangeRate: goal.missingExchangeRate,
      ...(exact
        ? {
            currentAmount: money(goal.currentAmountCalculated, goal.currency),
            targetAmount: money(goal.targetAmountMinor, goal.currency),
            requiredMonthly: money(goal.requiredMonthly, goal.currency),
          }
        : {}),
    })),
    dataQuality,
    methodology: [
      "All balances, flows, goal calculations, and currency conversions were calculated by Wealthboard before this snapshot was created.",
      "The model receives bounded aggregates and cannot query the database or mutate financial records.",
      "Missing effective-dated exchange rates are reported explicitly; unavailable holdings are not silently estimated.",
      "Account and goal labels are pseudonymized unless the user explicitly includes names.",
    ],
  };

  return portfolioReviewSnapshotSchema.parse(snapshot);
}

export function portfolioReviewEvidenceIds(snapshot: PortfolioReviewSnapshot) {
  return new Set([
    snapshot.portfolio.totals.evidenceId,
    snapshot.portfolio.ratios.evidenceId,
    snapshot.portfolio.periodChange.evidenceId,
    snapshot.cashFlow.evidenceId,
    ...snapshot.allocations.categories.map((item) => item.evidenceId),
    ...snapshot.allocations.currencies.map((item) => item.evidenceId),
    ...snapshot.topAccounts.map((item) => item.evidenceId),
    ...snapshot.goals.map((item) => item.evidenceId),
    ...snapshot.dataQuality.map((item) => item.evidenceId),
  ]);
}

export function validatePortfolioReviewEvidence(
  review: PortfolioAiReview,
  snapshot: PortfolioReviewSnapshot,
) {
  const allowed = portfolioReviewEvidenceIds(snapshot);
  const findings = [
    ...review.dataQuality,
    ...review.strengths,
    ...review.attentionItems,
    ...review.goalObservations,
  ];
  for (const finding of findings) {
    if (finding.evidenceRefs.some((reference) => !allowed.has(reference))) {
      throw new Error(
        "The provider response cited unavailable portfolio evidence.",
      );
    }
  }
  return review;
}
