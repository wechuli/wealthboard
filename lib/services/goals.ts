import "server-only";

import { and, asc, eq, getTableColumns, ne } from "drizzle-orm";

import {
  accounts,
  exchangeRates,
  goalAlertDismissals,
  goalContributionPlans,
  goalMilestones,
  goals,
  idempotencyKeys,
  userSettings,
  type GoalStatus,
} from "@/db/schema";
import {
  addUtcMonths,
  dateInputForTimezone,
  endOfUtcDay,
  dateInputToUtc,
  nowIso,
} from "@/lib/dates";
import { getDatabase } from "@/lib/db";
import {
  forecastCompletionWithContributionWindow,
  futureValueWithContributionWindow,
  goalTrackingStatus,
  monthlyPlanAmount,
  requiredMonthlyContribution,
} from "@/lib/finance";
import {
  convertMinor,
  MissingExchangeRateError,
  parseMoney,
  percentage,
} from "@/lib/money";
import { requireEnabledCurrency } from "@/lib/services/settings";

type GoalInput = {
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
};

export async function listGoals(userId: string, now = new Date()) {
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
    .leftJoin(
      accounts,
      and(
        eq(goals.linkedAccountId, accounts.id),
        eq(goals.userId, accounts.userId),
      ),
    )
    .leftJoin(
      goalContributionPlans,
      and(
        eq(goals.id, goalContributionPlans.goalId),
        eq(goals.userId, goalContributionPlans.userId),
      ),
    )
    .where(eq(goals.userId, userId))
    .orderBy(asc(goals.priority), asc(goals.targetDate));
  const rates = await db
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.userId, userId));

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
      ? monthlyPlanAmount(
          goal.plannedContributionMinor,
          goal.frequency ?? "monthly",
        )
      : 0n;
    const planStart = goal.planStartDate
      ? new Date(goal.planStartDate)
      : undefined;
    const planEnd = goal.planEndDate ? new Date(goal.planEndDate) : null;
    const planActive =
      (!planStart || now >= planStart) && (!planEnd || now <= planEnd);
    const currentPlannedMonthly = planActive ? plannedMonthly : 0n;
    const targetDate = new Date(goal.targetDate);
    const requiredMonthly = requiredMonthlyContribution(
      current,
      goal.targetAmountMinor,
      targetDate,
      goal.assumedAnnualReturnBps,
      now,
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

export async function getGoal(userId: string, id: string, now = new Date()) {
  const items = await listGoals(userId, now);
  return items.find((goal) => goal.id === id);
}

export async function listGoalMilestones(
  userId: string,
  goalId: string,
  now = new Date(),
) {
  const goal = await getGoal(userId, goalId, now);
  if (!goal) return [];
  const rows = await getDatabase()
    .select()
    .from(goalMilestones)
    .where(
      and(eq(goalMilestones.userId, userId), eq(goalMilestones.goalId, goalId)),
    )
    .orderBy(
      asc(goalMilestones.targetAmountMinor),
      asc(goalMilestones.targetDate),
    );
  const current = goal.currentAmountCalculated;
  const timezone = getUserTimezone(userId);
  const today = dateInputForTimezone(timezone, now);

  return rows.map((milestone) => {
    const target = BigInt(milestone.targetAmountMinor);
    if (goal.missingExchangeRate) {
      return {
        ...milestone,
        status: "rate_needed" as const,
        progressPercent: "0",
        remainingMinor: null,
      };
    }
    const reached = current >= target;
    const overdue = Boolean(
      !reached &&
        milestone.targetDate &&
        milestone.targetDate.slice(0, 10) < today,
    );
    return {
      ...milestone,
      status: reached
        ? ("reached" as const)
        : overdue
          ? ("overdue" as const)
          : ("upcoming" as const),
      progressPercent: percentage(current > target ? target : current, target),
      remainingMinor: current >= target ? 0n : target - current,
    };
  });
}

export function createGoalMilestone(
  userId: string,
  goalId: string,
  input: { name: string; targetAmount: string; targetDate?: string },
) {
  const db = getDatabase();
  return db.transaction((tx) => {
    const goal = tx.query.goals
      .findFirst({
        where: and(eq(goals.userId, userId), eq(goals.id, goalId)),
      })
      .sync();
    if (!goal) throw new Error("Goal not found.");
    const targetAmountMinor = parseMoney(input.targetAmount, goal.currency);
    if (targetAmountMinor <= 0) {
      throw new Error("Milestone amount must be greater than zero.");
    }
    if (targetAmountMinor > goal.targetAmountMinor) {
      throw new Error("Milestone amount cannot exceed the goal target.");
    }
    const targetDate = input.targetDate
      ? dateInputToUtc(input.targetDate)
      : null;
    if (targetDate && targetDate > goal.targetDate) {
      throw new Error("Milestone date cannot be after the goal target date.");
    }
    const timestamp = nowIso();
    const id = crypto.randomUUID();
    tx.insert(goalMilestones)
      .values({
        id,
        userId,
        goalId,
        name: input.name,
        targetAmountMinor,
        targetDate,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    return id;
  });
}

export function deleteGoalMilestone(
  userId: string,
  goalId: string,
  milestoneId: string,
) {
  const result = getDatabase()
    .delete(goalMilestones)
    .where(
      and(
        eq(goalMilestones.userId, userId),
        eq(goalMilestones.goalId, goalId),
        eq(goalMilestones.id, milestoneId),
      ),
    )
    .run();
  if (result.changes === 0) throw new Error("Milestone not found.");
}

function getUserTimezone(userId: string) {
  const settings = getDatabase()
    .query.userSettings.findFirst({
      where: eq(userSettings.userId, userId),
      columns: { timezone: true },
    })
    .sync();
  if (!settings) throw new Error("User settings are unavailable.");
  return settings.timezone;
}

function goalAlertKey(userId: string, now: Date) {
  return `behind:${dateInputForTimezone(getUserTimezone(userId), now).slice(0, 7)}`;
}

export async function listGoalAlerts(userId: string, now = new Date()) {
  const alertKey = goalAlertKey(userId, now);
  const [goalRows, dismissals] = await Promise.all([
    listGoals(userId, now),
    getDatabase()
      .select({ goalId: goalAlertDismissals.goalId })
      .from(goalAlertDismissals)
      .where(
        and(
          eq(goalAlertDismissals.userId, userId),
          eq(goalAlertDismissals.alertKey, alertKey),
        ),
      ),
  ]);
  const dismissedGoalIds = new Set(dismissals.map((row) => row.goalId));

  return goalRows
    .filter(
      (goal) =>
        goal.status === "active" &&
        goal.tracking === "behind" &&
        !goal.missingExchangeRate &&
        !dismissedGoalIds.has(goal.id),
    )
    .map((goal) => ({
      goalId: goal.id,
      goalName: goal.name,
      currency: goal.currency,
      requiredMonthly: goal.requiredMonthly,
      plannedMonthly: goal.currentPlannedMonthly,
      annualReturnBps: goal.assumedAnnualReturnBps,
      targetDate: goal.targetDate,
      alertKey,
    }));
}

export function dismissGoalAlert(
  userId: string,
  goalId: string,
  now = new Date(),
) {
  const db = getDatabase();
  const goal = db.query.goals
    .findFirst({
      where: and(eq(goals.userId, userId), eq(goals.id, goalId)),
      columns: { id: true },
    })
    .sync();
  if (!goal) throw new Error("Goal not found.");
  const alertKey = goalAlertKey(userId, now);
  db.insert(goalAlertDismissals)
    .values({ userId, goalId, alertKey, dismissedAt: nowIso() })
    .onConflictDoNothing()
    .run();
}

export function createGoal(userId: string, input: GoalInput) {
  const db = getDatabase();
  input = {
    ...input,
    currency: requireEnabledCurrency(userId, input.currency, db),
  };
  const { targetAmountMinor, currentAmountMinor, plannedContributionMinor } =
    validateGoalInput(input);
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  return db.transaction((tx) => {
    if (input.idempotencyKey) {
      const duplicate = tx.query.idempotencyKeys
        .findFirst({
          where: and(
            eq(idempotencyKeys.userId, userId),
            eq(idempotencyKeys.key, input.idempotencyKey),
          ),
        })
        .sync();
      if (duplicate?.operation === "create-goal" && duplicate.resultId)
        return duplicate.resultId;
      if (duplicate) throw new Error("This request key was already used.");
    }
    assertLinkedAccountAvailable(tx, userId, input.linkedAccountId);
    tx.insert(goals)
      .values({
        id,
        userId,
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
        userId,
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
        .where(
          and(
            eq(accounts.userId, userId),
            eq(accounts.id, input.linkedAccountId),
          ),
        )
        .run();
    }
    if (input.idempotencyKey) {
      tx.insert(idempotencyKeys)
        .values({
          userId,
          key: input.idempotencyKey,
          operation: "create-goal",
          resultId: id,
          createdAt: timestamp,
        })
        .run();
    }
    return id;
  });
}

export function updateGoal(userId: string, id: string, input: GoalInput) {
  const db = getDatabase();
  input = {
    ...input,
    currency: requireEnabledCurrency(userId, input.currency, db),
  };
  const { targetAmountMinor, currentAmountMinor, plannedContributionMinor } =
    validateGoalInput(input);
  const timestamp = nowIso();
  db.transaction((tx) => {
    const existing = tx.query.goals
      .findFirst({ where: and(eq(goals.userId, userId), eq(goals.id, id)) })
      .sync();
    if (!existing) throw new Error("Goal not found.");
    assertLinkedAccountAvailable(tx, userId, input.linkedAccountId, id);
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
      .where(and(eq(goals.userId, userId), eq(goals.id, id)))
      .run();
    tx.update(goalContributionPlans)
      .set({
        plannedContributionMinor,
        frequency: input.frequency,
        startDate: dateInputToUtc(input.planStartDate),
        endDate: input.planEndDate ? dateInputToUtc(input.planEndDate) : null,
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(goalContributionPlans.userId, userId),
          eq(goalContributionPlans.goalId, id),
        ),
      )
      .run();
    tx.update(accounts)
      .set({ goalId: null, updatedAt: timestamp })
      .where(and(eq(accounts.userId, userId), eq(accounts.goalId, id)))
      .run();
    if (input.linkedAccountId) {
      tx.update(accounts)
        .set({ goalId: id, updatedAt: timestamp })
        .where(
          and(
            eq(accounts.userId, userId),
            eq(accounts.id, input.linkedAccountId),
          ),
        )
        .run();
    }
  });
}

export function setGoalStatus(userId: string, id: string, status: GoalStatus) {
  const result = getDatabase()
    .update(goals)
    .set({ status, updatedAt: nowIso() })
    .where(and(eq(goals.userId, userId), eq(goals.id, id)))
    .run();
  if (result.changes === 0) throw new Error("Goal not found.");
}

export function deleteGoal(userId: string, id: string) {
  const db = getDatabase();
  db.transaction((tx) => {
    tx.update(accounts)
      .set({ goalId: null, updatedAt: nowIso() })
      .where(and(eq(accounts.userId, userId), eq(accounts.goalId, id)))
      .run();
    const result = tx
      .delete(goals)
      .where(and(eq(goals.userId, userId), eq(goals.id, id)))
      .run();
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
  for (
    let month = 0;
    month <= months;
    month += Math.max(1, Math.ceil(months / 24))
  ) {
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

function validateGoalInput(input: GoalInput) {
  const targetAmountMinor = parseMoney(input.targetAmount, input.currency);
  const currentAmountMinor = input.currentAmount
    ? parseMoney(input.currentAmount, input.currency)
    : 0;
  const plannedContributionMinor = parseMoney(
    input.plannedContribution,
    input.currency,
  );
  if (targetAmountMinor <= 0)
    throw new Error("Target amount must be greater than zero.");
  if (currentAmountMinor < 0 || plannedContributionMinor < 0) {
    throw new Error("Goal amounts cannot be negative.");
  }
  if (new Date(input.targetDate) <= new Date(input.planStartDate)) {
    throw new Error("Target date must be after the contribution start date.");
  }
  if (
    input.planEndDate &&
    new Date(input.planEndDate) < new Date(input.planStartDate)
  ) {
    throw new Error("Contribution plan end date must be after its start date.");
  }
  return { targetAmountMinor, currentAmountMinor, plannedContributionMinor };
}

function assertLinkedAccountAvailable(
  tx: Parameters<
    Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
  >[0],
  userId: string,
  linkedAccountId?: string,
  goalId?: string,
) {
  if (!linkedAccountId) return;
  const account = tx.query.accounts
    .findFirst({
      where: and(eq(accounts.userId, userId), eq(accounts.id, linkedAccountId)),
    })
    .sync();
  if (!account) throw new Error("Linked account not found.");
  const linkedGoal = tx.query.goals
    .findFirst({
      where: goalId
        ? and(
            eq(goals.userId, userId),
            eq(goals.linkedAccountId, linkedAccountId),
            ne(goals.id, goalId),
          )
        : and(
            eq(goals.userId, userId),
            eq(goals.linkedAccountId, linkedAccountId),
          ),
    })
    .sync();
  if (linkedGoal)
    throw new Error(`This account is already linked to ${linkedGoal.name}.`);
}

function projectionContributions(
  input: Parameters<typeof goalProjectionPoints>[0],
  startDate: Date,
  months: number,
) {
  let total = BigInt(input.currentMinor);
  for (let month = 1; month <= months; month += 1) {
    const date = addUtcMonths(startDate, month);
    const afterStart =
      !input.contributionStart || date >= input.contributionStart;
    const beforeEnd = !input.contributionEnd || date <= input.contributionEnd;
    if (afterStart && beforeEnd)
      total += BigInt(input.monthlyContributionMinor);
  }
  return total;
}
