import Decimal from "decimal.js";

import type { TransactionType } from "@/db/schema";
import { addUtcMonths, monthsBetween, utcToDateInput } from "@/lib/dates";

export type FinancialEvent =
  | {
      kind: "transaction";
      date: string;
      createdAt: string;
      type: TransactionType;
      amountMinor: number;
    }
  | {
      kind: "valuation";
      date: string;
      createdAt: string;
      valueMinor: number;
    };

const POSITIVE_TYPES = new Set<TransactionType>([
  "opening_balance",
  "deposit",
  "interest",
  "dividend",
  "capital_gain",
  "purchase",
  "liability_increase",
]);

const NEGATIVE_TYPES = new Set<TransactionType>([
  "withdrawal",
  "capital_loss",
  "fee",
  "sale",
  "liability_payment",
]);

export function transactionEffect(
  type: TransactionType,
  amountMinor: number,
): bigint {
  const amount = BigInt(amountMinor);
  if (type === "manual_adjustment" || type === "transfer") return amount;
  if (POSITIVE_TYPES.has(type)) return amount < 0n ? -amount : amount;
  if (NEGATIVE_TYPES.has(type)) return amount > 0n ? -amount : amount;
  return 0n;
}

export function replayBalance(
  events: FinancialEvent[],
  throughDate?: string,
): bigint {
  const ordered = [...events]
    .filter((event) => !throughDate || event.date <= throughDate)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.createdAt.localeCompare(b.createdAt) ||
        (a.kind === "transaction" ? -1 : 1),
    );

  let balance = 0n;
  for (const event of ordered) {
    if (event.kind === "valuation") {
      balance = BigInt(event.valueMinor);
    } else {
      balance += transactionEffect(event.type, event.amountMinor);
    }
  }
  return balance;
}

export type AccountFlowMetrics = {
  contributions: bigint;
  withdrawals: bigint;
  transfersIn: bigint;
  transfersOut: bigint;
  interest: bigint;
  dividends: bigint;
  fees: bigint;
  realizedGrowth: bigint;
};

export function calculateFlowMetrics(
  entries: Array<{ type: TransactionType; amountMinor: number | bigint }>,
): AccountFlowMetrics {
  const metrics: AccountFlowMetrics = {
    contributions: 0n,
    withdrawals: 0n,
    transfersIn: 0n,
    transfersOut: 0n,
    interest: 0n,
    dividends: 0n,
    fees: 0n,
    realizedGrowth: 0n,
  };

  for (const entry of entries) {
    const rawAmount = BigInt(entry.amountMinor);
    const amount = rawAmount < 0n ? -rawAmount : rawAmount;
    switch (entry.type) {
      case "opening_balance":
      case "deposit":
      case "purchase":
        metrics.contributions += amount;
        break;
      case "withdrawal":
      case "sale":
        metrics.withdrawals += amount;
        break;
      case "interest":
        metrics.interest += amount;
        break;
      case "dividend":
        metrics.dividends += amount;
        break;
      case "fee":
        metrics.fees += amount;
        break;
      case "capital_gain":
        metrics.realizedGrowth += amount;
        break;
      case "capital_loss":
        metrics.realizedGrowth -= amount;
        break;
      case "transfer":
        if (rawAmount >= 0n) metrics.transfersIn += amount;
        else metrics.transfersOut += amount;
        break;
      default:
        break;
    }
  }
  return metrics;
}

export function calculateNetWorthTotals(
  holdings: Array<{
    valueMinor: number | bigint;
    isLiability: boolean;
    included?: boolean;
  }>,
) {
  let assets = 0n;
  let liabilities = 0n;
  for (const holding of holdings) {
    if (holding.included === false) continue;
    const value = BigInt(holding.valueMinor);
    if (holding.isLiability) liabilities += value;
    else assets += value;
  }
  return { assets, liabilities, netWorth: assets - liabilities };
}

export function requiredMonthlyContribution(
  currentMinor: number | bigint,
  targetMinor: number | bigint,
  targetDate: Date,
  annualReturnBps = 0,
  fromDate = new Date(),
): bigint {
  const current = new Decimal(currentMinor.toString());
  const target = new Decimal(targetMinor.toString());
  if (current.greaterThanOrEqualTo(target)) return 0n;
  const months = Math.max(1, monthsBetween(fromDate, targetDate));
  const monthlyRate = new Decimal(annualReturnBps).div(10000).div(12);

  if (monthlyRate.isZero()) {
    return decimalToBigInt(
      target.minus(current).div(months),
      Decimal.ROUND_CEIL,
    );
  }

  const growthFactor = monthlyRate.plus(1).pow(months);
  const remainingAfterPrincipalGrowth = target.minus(current.mul(growthFactor));
  if (remainingAfterPrincipalGrowth.lessThanOrEqualTo(0)) return 0n;

  const contributionGrowthFactor = growthFactor.minus(1).div(monthlyRate);
  return decimalToBigInt(
    remainingAfterPrincipalGrowth.div(contributionGrowthFactor),
    Decimal.ROUND_CEIL,
  );
}

function decimalToBigInt(
  value: Decimal,
  rounding: Decimal.Rounding = Decimal.ROUND_HALF_UP,
) {
  return BigInt(value.toDecimalPlaces(0, rounding).toFixed(0));
}

export function monthlyPlanAmount(
  amountMinor: number | bigint,
  frequency: "weekly" | "monthly" | "quarterly" | "annually" | "custom",
): bigint {
  const amount = new Decimal(amountMinor.toString());
  switch (frequency) {
    case "weekly":
      return decimalToBigInt(amount.mul(52).div(12));
    case "quarterly":
      return decimalToBigInt(amount.div(3));
    case "annually":
      return decimalToBigInt(amount.div(12));
    case "monthly":
    case "custom":
      return BigInt(amountMinor);
  }
}

export function futureValueMinor(
  currentMinor: number | bigint,
  monthlyContributionMinor: number | bigint,
  annualReturnBps: number,
  months: number,
): bigint {
  if (months <= 0) return BigInt(currentMinor);
  const current = new Decimal(currentMinor.toString());
  const contribution = new Decimal(monthlyContributionMinor.toString());
  const monthlyRate = new Decimal(annualReturnBps).div(10000).div(12);

  if (monthlyRate.isZero()) {
    return decimalToBigInt(current.plus(contribution.mul(months)));
  }

  const growthFactor = monthlyRate.plus(1).pow(months);
  const principalGrowth = current.mul(growthFactor);
  const contributionGrowth = contribution
    .mul(growthFactor.minus(1))
    .div(monthlyRate);
  return decimalToBigInt(principalGrowth.plus(contributionGrowth));
}

export function futureValueWithContributionWindow(input: {
  currentMinor: number | bigint;
  monthlyContributionMinor: number | bigint;
  annualReturnBps: number;
  months: number;
  fromDate?: Date;
  contributionStart?: Date;
  contributionEnd?: Date | null;
}): bigint {
  let value = new Decimal(input.currentMinor.toString());
  const contribution = new Decimal(input.monthlyContributionMinor.toString());
  const monthlyRate = new Decimal(input.annualReturnBps).div(10000).div(12);
  const fromDate = input.fromDate ?? new Date();

  for (let month = 1; month <= input.months; month += 1) {
    value = value.mul(monthlyRate.plus(1));
    const contributionDate = addUtcMonths(fromDate, month);
    const contributionDay = utcToDateInput(contributionDate);
    const afterStart =
      !input.contributionStart ||
      contributionDay >= utcToDateInput(input.contributionStart);
    const beforeEnd =
      !input.contributionEnd ||
      contributionDay <= utcToDateInput(input.contributionEnd);
    if (afterStart && beforeEnd) value = value.plus(contribution);
  }
  return decimalToBigInt(value);
}

export function forecastCompletionWithContributionWindow(input: {
  currentMinor: number | bigint;
  targetMinor: number | bigint;
  monthlyContributionMinor: number | bigint;
  annualReturnBps: number;
  fromDate?: Date;
  contributionStart?: Date;
  contributionEnd?: Date | null;
}): Date | null {
  const fromDate = input.fromDate ?? new Date();
  if (BigInt(input.currentMinor) >= BigInt(input.targetMinor)) return fromDate;

  for (let month = 1; month <= 1200; month += 1) {
    if (
      futureValueWithContributionWindow({
        ...input,
        months: month,
        fromDate,
      }) >= BigInt(input.targetMinor)
    ) {
      return addUtcMonths(fromDate, month);
    }
  }
  return null;
}

export function forecastCompletionDate(
  currentMinor: number | bigint,
  targetMinor: number | bigint,
  monthlyContributionMinor: number | bigint,
  annualReturnBps: number,
  fromDate = new Date(),
): Date | null {
  if (BigInt(currentMinor) >= BigInt(targetMinor)) return fromDate;
  if (BigInt(monthlyContributionMinor) <= 0n && annualReturnBps <= 0)
    return null;

  for (let month = 1; month <= 1200; month += 1) {
    if (
      futureValueMinor(
        currentMinor,
        monthlyContributionMinor,
        annualReturnBps,
        month,
      ) >= BigInt(targetMinor)
    ) {
      return addUtcMonths(fromDate, month);
    }
  }
  return null;
}

export function projectGoalScenario(input: {
  currentMinor: number | bigint;
  targetMinor: number | bigint;
  monthlyContributionMinor: number | bigint;
  annualReturnBps: number;
  fromDate: Date;
  targetDate: Date;
}) {
  const monthsToTarget = Math.max(
    0,
    monthsBetween(input.fromDate, input.targetDate),
  );
  const current = BigInt(input.currentMinor);
  const monthlyContribution = BigInt(input.monthlyContributionMinor);
  const futureContributions = monthlyContribution * BigInt(monthsToTarget);
  const projectedAtTarget = futureValueMinor(
    current,
    monthlyContribution,
    input.annualReturnBps,
    monthsToTarget,
  );
  const forecastDate = forecastCompletionDate(
    current,
    input.targetMinor,
    monthlyContribution,
    input.annualReturnBps,
    input.fromDate,
  );

  return {
    monthsToTarget,
    projectedAtTarget,
    futureContributions,
    investmentGrowth: projectedAtTarget - current - futureContributions,
    forecastDate,
    reachesTarget: projectedAtTarget >= BigInt(input.targetMinor),
  };
}

export function goalTrackingStatus(input: {
  currentMinor: number | bigint;
  targetMinor: number | bigint;
  createdAt: Date;
  targetDate: Date;
  monthlyPlannedMinor: number | bigint;
  now?: Date;
}): "ahead" | "on_track" | "behind" {
  const now = input.now ?? new Date();
  if (BigInt(input.currentMinor) >= BigInt(input.targetMinor)) return "ahead";

  const totalMonths = Math.max(
    1,
    monthsBetween(input.createdAt, input.targetDate),
  );
  const elapsedMonths = Math.min(
    totalMonths,
    monthsBetween(input.createdAt, now),
  );
  const expected = new Decimal(input.targetMinor.toString())
    .mul(elapsedMonths)
    .div(totalMonths);
  const current = new Decimal(input.currentMinor.toString());
  const required = requiredMonthlyContribution(
    input.currentMinor,
    input.targetMinor,
    input.targetDate,
    0,
    now,
  );

  if (
    current.greaterThanOrEqualTo(expected.mul("1.05")) ||
    BigInt(input.monthlyPlannedMinor) > required
  ) {
    return "ahead";
  }
  if (
    current.lessThan(expected.mul("0.9")) ||
    BigInt(input.monthlyPlannedMinor) < required
  ) {
    return "behind";
  }
  return "on_track";
}
