import { describe, expect, it } from "vitest";

import {
  calculateFlowMetrics,
  calculateNetWorthTotals,
  forecastCompletionDate,
  forecastCompletionWithContributionWindow,
  futureValueMinor,
  futureValueWithContributionWindow,
  goalTrackingStatus,
  monthlyPlanAmount,
  projectGoalScenario,
  replayBalance,
  requiredMonthlyContribution,
  transactionEffect,
  type FinancialEvent,
} from "@/lib/finance";

describe("transaction balance effects", () => {
  it.each([
    ["deposit", 10_000],
    ["interest", 10_000],
    ["dividend", 10_000],
    ["capital_gain", 10_000],
    ["purchase", 10_000],
    ["liability_increase", 10_000],
    ["withdrawal", -10_000],
    ["capital_loss", -10_000],
    ["fee", -10_000],
    ["sale", -10_000],
    ["liability_payment", -10_000],
    ["manual_adjustment", 10_000],
    ["transfer", -10_000],
  ] as const)("%s applies the correct signed effect", (type, expected) => {
    expect(
      transactionEffect(type, type === "transfer" ? -10_000 : 10_000),
    ).toBe(BigInt(expected));
  });

  it("replays transactions and lets valuations reset value without becoming cash flow", () => {
    const events: FinancialEvent[] = [
      {
        kind: "transaction",
        type: "opening_balance",
        amountMinor: 100_000,
        date: "2026-01-01",
        createdAt: "1",
      },
      {
        kind: "transaction",
        type: "deposit",
        amountMinor: 20_000,
        date: "2026-02-01",
        createdAt: "2",
      },
      {
        kind: "valuation",
        valueMinor: 150_000,
        date: "2026-03-01",
        createdAt: "3",
      },
      {
        kind: "transaction",
        type: "fee",
        amountMinor: 1_000,
        date: "2026-04-01",
        createdAt: "4",
      },
    ];
    expect(replayBalance(events)).toBe(149_000n);
    expect(replayBalance(events, "2026-02-15")).toBe(120_000n);
  });

  it("replaying edited or deleted history produces the correct balance", () => {
    const opening: FinancialEvent = {
      kind: "transaction",
      type: "opening_balance",
      amountMinor: 100,
      date: "2026-01-01",
      createdAt: "1",
    };
    const deposit: FinancialEvent = {
      kind: "transaction",
      type: "deposit",
      amountMinor: 50,
      date: "2026-01-02",
      createdAt: "2",
    };
    expect(replayBalance([opening, deposit])).toBe(150n);
    expect(replayBalance([opening, { ...deposit, amountMinor: 80 }])).toBe(
      180n,
    );
    expect(replayBalance([opening])).toBe(100n);
  });

  it("separates contributions, withdrawals, income, growth, and fees", () => {
    const metrics = calculateFlowMetrics([
      { type: "opening_balance", amountMinor: 100 },
      { type: "deposit", amountMinor: 50 },
      { type: "withdrawal", amountMinor: 20 },
      { type: "interest", amountMinor: 5 },
      { type: "dividend", amountMinor: 4 },
      { type: "capital_gain", amountMinor: 8 },
      { type: "capital_loss", amountMinor: 3 },
      { type: "fee", amountMinor: 2 },
    ]);
    expect(metrics).toEqual({
      contributions: 150n,
      withdrawals: 20n,
      transfersIn: 0n,
      transfersOut: 0n,
      interest: 5n,
      dividends: 4n,
      fees: 2n,
      realizedGrowth: 5n,
    });
  });
});

describe("portfolio totals", () => {
  it("subtracts liabilities and excludes opted-out holdings", () => {
    expect(
      calculateNetWorthTotals([
        { valueMinor: 1_000_000, isLiability: false },
        { valueMinor: 250_000, isLiability: true },
        { valueMinor: 500_000, isLiability: false, included: false },
      ]),
    ).toEqual({
      assets: 1_000_000n,
      liabilities: 250_000n,
      netWorth: 750_000n,
    });
  });
});

describe("goal calculations", () => {
  it("calculates monthly equivalents for every supported schedule", () => {
    expect(monthlyPlanAmount(1_200, "monthly")).toBe(1_200n);
    expect(monthlyPlanAmount(1_200, "quarterly")).toBe(400n);
    expect(monthlyPlanAmount(1_200, "annually")).toBe(100n);
    expect(monthlyPlanAmount(1_200, "weekly")).toBe(5_200n);
  });

  it("calculates required contributions using remaining periods", () => {
    expect(
      requiredMonthlyContribution(
        100_000,
        220_000,
        new Date("2027-01-01T00:00:00Z"),
        0,
        new Date("2026-01-01T00:00:00Z"),
      ),
    ).toBe(10_000n);
  });

  it("reduces required contributions using the configured compound return", () => {
    const targetDate = new Date("2027-01-01T00:00:00Z");
    const fromDate = new Date("2026-01-01T00:00:00Z");
    const required = requiredMonthlyContribution(
      100_000,
      220_000,
      targetDate,
      1_200,
      fromDate,
    );

    expect(required).toBeLessThan(10_000n);
    expect(
      futureValueMinor(100_000, required, 1_200, 12),
    ).toBeGreaterThanOrEqual(220_000n);
    expect(futureValueMinor(100_000, required - 1n, 1_200, 12)).toBeLessThan(
      220_000n,
    );
  });

  it("uses a future-value calculation for principal and monthly contributions", () => {
    expect(futureValueMinor(100_000, 10_000, 0, 12)).toBe(220_000n);
    expect(futureValueMinor(100_000, 10_000, 800, 12)).toBeGreaterThan(
      220_000n,
    );
  });

  it("forecasts a completion date and handles impossible plans", () => {
    expect(
      forecastCompletionDate(
        0,
        120_000,
        10_000,
        0,
        new Date("2026-01-01T00:00:00Z"),
      )
        ?.toISOString()
        .slice(0, 7),
    ).toBe("2027-01");
    expect(forecastCompletionDate(0, 120_000, 0, 0)).toBeNull();
  });

  it("applies contributions only inside the configured plan window", () => {
    const fromDate = new Date("2026-01-01T00:00:00Z");
    expect(
      futureValueWithContributionWindow({
        currentMinor: 0,
        monthlyContributionMinor: 10_000,
        annualReturnBps: 0,
        months: 12,
        fromDate,
        contributionStart: new Date("2026-04-01T00:00:00Z"),
        contributionEnd: new Date("2026-09-01T00:00:00Z"),
      }),
    ).toBe(60_000n);
    expect(
      forecastCompletionWithContributionWindow({
        currentMinor: 0,
        targetMinor: 60_000,
        monthlyContributionMinor: 10_000,
        annualReturnBps: 0,
        fromDate,
        contributionStart: new Date("2026-04-01T00:00:00Z"),
        contributionEnd: new Date("2026-09-01T00:00:00Z"),
      })
        ?.toISOString()
        .slice(0, 7),
    ).toBe("2026-09");
  });

  it("includes a final contribution on the plan-end calendar date", () => {
    const fromDate = new Date("2026-08-03T20:00:00.000Z");
    const targetDate = new Date("2028-08-03T12:00:00.000Z");
    const required = requiredMonthlyContribution(
      30_000_000,
      400_000_000,
      targetDate,
      800,
      fromDate,
    );
    const planned = 14_200_000;

    expect(required).toBe(14_067_432n);
    expect(BigInt(planned)).toBeGreaterThan(required);
    expect(
      futureValueWithContributionWindow({
        currentMinor: 30_000_000,
        monthlyContributionMinor: planned,
        annualReturnBps: 800,
        months: 24,
        fromDate,
        contributionStart: new Date("2026-08-03T12:00:00.000Z"),
        contributionEnd: targetDate,
      }),
    ).toBeGreaterThanOrEqual(400_000_000n);
    expect(
      forecastCompletionWithContributionWindow({
        currentMinor: 30_000_000,
        targetMinor: 400_000_000,
        monthlyContributionMinor: planned,
        annualReturnBps: 800,
        fromDate,
        contributionStart: new Date("2026-08-03T12:00:00.000Z"),
        contributionEnd: targetDate,
      })
        ?.toISOString()
        .slice(0, 10),
    ).toBe("2028-08-03");
  });

  it("compares goal scenarios without changing their saved assumptions", () => {
    const saved = {
      currentMinor: 100_000,
      targetMinor: 500_000,
      monthlyContributionMinor: 20_000,
      annualReturnBps: 0,
      fromDate: new Date("2026-01-01T00:00:00Z"),
      targetDate: new Date("2027-01-01T00:00:00Z"),
    };
    const baseline = projectGoalScenario(saved);
    const higherReturn = projectGoalScenario({
      ...saved,
      annualReturnBps: 1_200,
    });
    const higherContribution = projectGoalScenario({
      ...saved,
      monthlyContributionMinor: 30_000,
    });

    expect(baseline).toMatchObject({
      monthsToTarget: 12,
      projectedAtTarget: 340_000n,
      futureContributions: 240_000n,
      investmentGrowth: 0n,
      reachesTarget: false,
    });
    expect(higherReturn.projectedAtTarget).toBeGreaterThan(
      baseline.projectedAtTarget,
    );
    expect(higherReturn.investmentGrowth).toBeGreaterThan(0n);
    expect(higherContribution.projectedAtTarget).toBe(460_000n);
    expect(saved).toMatchObject({
      monthlyContributionMinor: 20_000,
      annualReturnBps: 0,
    });
  });

  it("applies the saved contribution window to scenario projections", () => {
    const saved = projectGoalScenario({
      currentMinor: 0,
      targetMinor: 50_000,
      monthlyContributionMinor: 10_000,
      annualReturnBps: 0,
      fromDate: new Date("2026-01-01T12:00:00Z"),
      targetDate: new Date("2026-12-01T12:00:00Z"),
      contributionStart: new Date("2026-04-01T12:00:00Z"),
      contributionEnd: new Date("2026-06-01T12:00:00Z"),
    });

    expect(saved).toMatchObject({
      monthsToTarget: 11,
      projectedAtTarget: 30_000n,
      futureContributions: 30_000n,
      reachesTarget: false,
      forecastDate: null,
    });
  });

  it("classifies goal tracking status without relying only on colour", () => {
    const base = {
      targetMinor: 120_000,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      targetDate: new Date("2027-01-01T00:00:00Z"),
      now: new Date("2026-07-01T00:00:00Z"),
    };
    expect(
      goalTrackingStatus({
        ...base,
        currentMinor: 80_000,
        monthlyPlannedMinor: 10_000,
      }),
    ).toBe("ahead");
    expect(
      goalTrackingStatus({
        ...base,
        currentMinor: 60_000,
        monthlyPlannedMinor: 10_000,
      }),
    ).toBe("on_track");
    expect(
      goalTrackingStatus({
        ...base,
        currentMinor: 20_000,
        monthlyPlannedMinor: 1_000,
      }),
    ).toBe("behind");
  });

  it("uses the configured return when comparing a plan with required pace", () => {
    const currentMinor = 150_000;
    const targetMinor = 300_000;
    const targetDate = new Date("2028-01-01T12:00:00Z");
    const now = new Date("2027-01-01T12:00:00Z");
    const requiredWithReturn = requiredMonthlyContribution(
      currentMinor,
      targetMinor,
      targetDate,
      1_200,
      now,
    );

    expect(
      goalTrackingStatus({
        currentMinor,
        targetMinor,
        createdAt: new Date("2026-01-01T12:00:00Z"),
        targetDate,
        monthlyPlannedMinor: requiredWithReturn + 1n,
        annualReturnBps: 1_200,
        now,
      }),
    ).toBe("ahead");
  });
});
