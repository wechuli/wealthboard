import "server-only";

import { and, asc, eq, getTableColumns, ne } from "drizzle-orm";

import {
  accounts,
  exchangeRates,
  goalContributionPlans,
  goals,
  idempotencyKeys,
  type GoalStatus,
} from "@/db/schema";
import {
  addUtcMonths,
  endOfUtcDay,
  dateInputToUtc,
  nowIso,
} from "@/lib/dates";
import {
  forecastCompletionWithContributionWindow,
  futureValueWithContributionWindow,
  goalTrackingStatus,
  monthlyPlanAmount,
  requiredMonthlyContribution,
} from "@/lib/finance";
import { getDatabase } from "@/lib/db";
import {
  convertMinor,
  MissingExchangeRateError,
  parseMoney,
  percentage,
} from "@/lib/money";

export async function listGoals() {
  const db = getDatabase();
  const rows = await db
    .select({
      ...getTableColumns(goals),
      accountName: accounts.name,
      accountCurrency: accounts.currency,
      accountValueMinor: accounts.currentValueMinor,
      planId: goalContributionPlans.id,
      plannedContributionMinor: goalContributionPlans.plannedContributionMinor,
      frequency: goalContributionPlans.frequency,
      planStartDate: goalContributionPlans.startDate,
      planEndDate: goalContributionPlans.endDate,
    })
    .from(goals)
    .leftJoin(accounts, eq(goals.linkedAccountId, accounts.id))
    .leftJoin(goalContributionPlans, eq(goals.id, goalContributionPlans.goalId))
    .orderBy(asc(goals.priority), asc(goals.targetDate));
  const rates = await db.select().from(exchangeRates);

  return rows.map((goal) => {
    let missingExchangeRate = false;
    let current = BigInt(goal.currentAmountMinor);
    if (goal.accountValueMinor !== null && goal.accountCurrency) {
      try {
        current = convertMinor(
          goal.accountValueMinor,
          goal.accountCurrency,
          goal.currency,
          rates,
          endOfUtcDay(new Date()).toISOString(),
        );
      } catch (error) {
        if (!(error instanceof MissingExchangeRateError)) throw error;
        missingExchangeRate = true;
        current = 0n;
      }
    }
    const plannedMonthly = goal.plannedContributionMinor
      ? monthlyPlanAmount(goal.plannedContributionMinor, goal.frequency ?? "monthly")
      : 0n;
    const now = new Date();
    const planStart = goal.planStartDate ? new Date(goal.planStartDate) : undefined;
    const planEnd = goal.planEndDate ? new Date(goal.planEndDate) : null;
    const planActive =
      (!planStart || now >= planStart) && (!planEnd || now <= planEnd);
    const currentPlannedMonthly = planActive ? plannedMonthly : 0n;
    const targetDate = new Date(goal.targetDate);
    const requiredMonthly = requiredMonthlyContribution(
      current,
      goal.targetAmountMinor,
      targetDate,
    );
    const forecast = forecastCompletionWithContributionWindow({
      currentMinor: current,
      targetMinor: goal.targetAmountMinor,
      monthlyContributionMinor: plannedMonthly,
      annualReturnBps: goal.assumedAnnualReturnBps,
      fromDate: now,
      contributionStart: planStart,
      contributionEnd: planEnd,
    });
    const linearTracking = goalTrackingStatus({
      currentMinor: current,
      targetMinor: goal.targetAmountMinor,
      createdAt: new Date(goal.createdAt),
      targetDate,
      monthlyPlannedMinor: currentPlannedMonthly,
    });
    const tracking =
      goal.status === "completed"
        ? "ahead"
        : !forecast || forecast > targetDate
          ? "behind"
          : linearTracking === "ahead"
            ? "ahead"
            : "on_track";
    return {
      ...goal,
      currentAmountCalculated: current,
      plannedMonthly,
      currentPlannedMonthly,
      requiredMonthly,
      forecastDate: forecast?.toISOString() ?? null,
      tracking,
      progressPercent: percentage(current, goal.targetAmountMinor),
      missingExchangeRate,
    };
  });
}

export async function getGoal(id: string) {
  const items = await listGoals();
  return items.find((goal) => goal.id === id);
}

export function createGoal(input: {
  idempotencyKey?: string;
  name: string;
  description?: string;
  targetAmount: string;
  currentAmount?: string;
  currency: string;
  targetDate: string;
  linkedAccountId?: string;
  icon: string;
  status: GoalStatus;
  priority: number;
  assumedAnnualReturn: number;
  plannedContribution: string;
  frequency: "weekly" | "monthly" | "quarterly" | "annually" | "custom";
  planStartDate: string;
  planEndDate?: string;
}) {
  const db = getDatabase();
  if (input.idempotencyKey) {
    const duplicate = db.query.idempotencyKeys
      .findFirst({ where: eq(idempotencyKeys.key, input.idempotencyKey) })
      .sync();
    if (duplicate?.operation === "create-goal" && duplicate.resultId) {
      return duplicate.resultId;
    }
    if (duplicate) throw new Error("This request key was already used.");
  }
  const { targetAmountMinor, currentAmountMinor, plannedContributionMinor } =
    validateGoalInput(input);
  assertLinkedAccountAvailable(input.linkedAccountId);

  const id = crypto.randomUUID();
  const timestamp = nowIso();
  db.transaction((tx) => {
    tx.insert(goals)
      .values({
        id,
        name: input.name,
        description: input.description,
        targetAmountMinor,
        currentAmountMinor,
        currency: input.currency,
        targetDate: dateInputToUtc(input.targetDate),
        linkedAccountId: input.linkedAccountId || null,
        icon: input.icon,
        status: input.status,
        priority: input.priority,
        assumedAnnualReturnBps: Math.round(input.assumedAnnualReturn * 100),
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    tx.insert(goalContributionPlans)
      .values({
        id: crypto.randomUUID(),
        goalId: id,
        plannedContributionMinor,
        frequency: input.frequency,
        startDate: dateInputToUtc(input.planStartDate),
        endDate: input.planEndDate ? dateInputToUtc(input.planEndDate) : null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    if (input.linkedAccountId) {
      tx.update(accounts)
        .set({ goalId: id, updatedAt: timestamp })
        .where(eq(accounts.id, input.linkedAccountId))
        .run();
    }
    if (input.idempotencyKey) {
      tx.insert(idempotencyKeys)
        .values({
          key: input.idempotencyKey,
          operation: "create-goal",
          resultId: id,
          createdAt: timestamp,
        })
        .run();
    }
  });
  return id;
}

export function updateGoal(id: string, input: Parameters<typeof createGoal>[0]) {
  const db = getDatabase();
  const existing = db.query.goals.findFirst({ where: eq(goals.id, id) }).sync();
  if (!existing) throw new Error("Goal not found.");
  const { targetAmountMinor, currentAmountMinor, plannedContributionMinor } =
    validateGoalInput(input);
  assertLinkedAccountAvailable(input.linkedAccountId, id);
  const timestamp = nowIso();

  db.transaction((tx) => {
    tx.update(goals)
      .set({
        name: input.name,
        description: input.description,
        targetAmountMinor,
        currentAmountMinor,
        currency: input.currency,
        targetDate: dateInputToUtc(input.targetDate),
        linkedAccountId: input.linkedAccountId || null,
        icon: input.icon,
        status: input.status,
        priority: input.priority,
        assumedAnnualReturnBps: Math.round(input.assumedAnnualReturn * 100),
        updatedAt: timestamp,
      })
      .where(eq(goals.id, id))
      .run();
    tx.update(goalContributionPlans)
      .set({
        plannedContributionMinor,
        frequency: input.frequency,
        startDate: dateInputToUtc(input.planStartDate),
        endDate: input.planEndDate ? dateInputToUtc(input.planEndDate) : null,
        updatedAt: timestamp,
      })
      .where(eq(goalContributionPlans.goalId, id))
      .run();
    tx.update(accounts)
      .set({ goalId: null, updatedAt: timestamp })
      .where(eq(accounts.goalId, id))
      .run();
    if (input.linkedAccountId) {
      tx.update(accounts)
        .set({ goalId: id, updatedAt: timestamp })
        .where(eq(accounts.id, input.linkedAccountId))
        .run();
    }
  });
}

export function setGoalStatus(id: string, status: GoalStatus) {
  const result = getDatabase()
    .update(goals)
    .set({ status, updatedAt: nowIso() })
    .where(eq(goals.id, id))
    .run();
  if (result.changes === 0) throw new Error("Goal not found.");
}

export function deleteGoal(id: string) {
  const db = getDatabase();
  db.transaction((tx) => {
    tx.update(accounts)
      .set({ goalId: null, updatedAt: nowIso() })
      .where(eq(accounts.goalId, id))
      .run();
    const result = tx.delete(goals).where(eq(goals.id, id)).run();
    if (result.changes === 0) throw new Error("Goal not found.");
  });
}

export function goalProjectionPoints(input: {
  currentMinor: number | bigint;
  targetMinor: number | bigint;
  monthlyContributionMinor: number | bigint;
  annualReturnBps: number;
  startDate?: Date;
  targetDate: Date;
  contributionStart?: Date;
  contributionEnd?: Date | null;
}) {
  const startDate = input.startDate ?? new Date();
  const months = Math.max(
    1,
    (input.targetDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
      input.targetDate.getUTCMonth() -
      startDate.getUTCMonth(),
  );
  const points = [];
  for (let month = 0; month <= months; month += Math.max(1, Math.ceil(months / 24))) {
    const date = addUtcMonths(startDate, month);
    points.push({
      date: date.toISOString(),
      projected: futureValueWithContributionWindow({
        currentMinor: input.currentMinor,
        monthlyContributionMinor: input.monthlyContributionMinor,
        annualReturnBps: input.annualReturnBps,
        months: month,
        fromDate: startDate,
        contributionStart: input.contributionStart,
        contributionEnd: input.contributionEnd,
      }),
      contributions: projectionContributions(input, startDate, month),
      target: BigInt(input.targetMinor),
    });
  }
  return points;
}

function validateGoalInput(input: Parameters<typeof createGoal>[0]) {
  const targetAmountMinor = parseMoney(input.targetAmount, input.currency);
  const currentAmountMinor = input.currentAmount
    ? parseMoney(input.currentAmount, input.currency)
    : 0;
  const plannedContributionMinor = parseMoney(
    input.plannedContribution,
    input.currency,
  );
  if (targetAmountMinor <= 0) {
    throw new Error("Target amount must be greater than zero.");
  }
  if (currentAmountMinor < 0 || plannedContributionMinor < 0) {
    throw new Error("Goal amounts cannot be negative.");
  }
  if (new Date(input.targetDate) <= new Date(input.planStartDate)) {
    throw new Error("Target date must be after the contribution start date.");
  }
  if (input.planEndDate && new Date(input.planEndDate) < new Date(input.planStartDate)) {
    throw new Error("Contribution plan end date must be after its start date.");
  }
  return { targetAmountMinor, currentAmountMinor, plannedContributionMinor };
}

function assertLinkedAccountAvailable(linkedAccountId?: string, goalId?: string) {
  if (!linkedAccountId) return;
  const db = getDatabase();
  const account = db.query.accounts
    .findFirst({ where: eq(accounts.id, linkedAccountId) })
    .sync();
  if (!account) throw new Error("Linked account not found.");
  const linkedGoal = db.query.goals
    .findFirst({
      where: goalId
        ? and(eq(goals.linkedAccountId, linkedAccountId), ne(goals.id, goalId))
        : eq(goals.linkedAccountId, linkedAccountId),
    })
    .sync();
  if (linkedGoal) {
    throw new Error(`This account is already linked to ${linkedGoal.name}.`);
  }
}

function projectionContributions(
  input: Parameters<typeof goalProjectionPoints>[0],
  startDate: Date,
  months: number,
) {
  let total = BigInt(input.currentMinor);
  for (let month = 1; month <= months; month += 1) {
    const date = addUtcMonths(startDate, month);
    const afterStart = !input.contributionStart || date >= input.contributionStart;
    const beforeEnd = !input.contributionEnd || date <= input.contributionEnd;
    if (afterStart && beforeEnd) total += BigInt(input.monthlyContributionMinor);
  }
  return total;
}
