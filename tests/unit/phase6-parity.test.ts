// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { registerUser } from "@/lib/auth/users";
import { closeDatabase } from "@/lib/db";
import { getDashboardData } from "@/lib/services/analytics";
import { getEstatePlanSnapshot } from "@/lib/services/estate-planning";
import { listGoals } from "@/lib/services/goals";
import { getPositionAccountSnapshot } from "@/lib/services/investments";
import { exportData, restoreUserData } from "@/lib/services/portability";

const fixturePath = path.resolve("tests/fixtures/phase6-parity-v8.json");
const fixedNow = new Date("2026-01-02T23:59:59.000Z");
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "wealthboard-parity-"));
const databasePath = path.join(workspace, "legacy.db");

type Archive = Awaited<ReturnType<typeof exportData>>;

function namedId(rows: Array<{ id: string; name: string }>) {
  return new Map(rows.map((row) => [row.id, row.name]));
}

function exportProjection(archive: Archive) {
  const accountNames = namedId(archive.accounts);
  const instrumentNames = namedId(archive.investmentInstruments);
  return {
    format: archive.format,
    version: archive.version,
    settings: archive.settings,
    counts: {
      accounts: archive.accounts.length,
      transactions: archive.transactions.length,
      valuations: archive.valuations.length,
      goals: archive.goals.length,
      positionEvents: archive.positionEvents.length,
      snapshots: archive.estatePlanSnapshots.length,
    },
    accounts: archive.accounts
      .map((row) => ({
        name: row.name,
        currency: row.currency,
        trackingMode: row.trackingMode,
        currentValueMinor: String(row.currentValueMinor),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    transactions: archive.transactions
      .map((row) => ({
        account: accountNames.get(row.accountId),
        type: row.type,
        amountMinor: String(row.amountMinor),
        date: row.transactionDate.slice(0, 10),
        externalId: row.externalId,
      }))
      .sort((left, right) =>
        `${left.account}:${left.date}:${left.type}`.localeCompare(
          `${right.account}:${right.date}:${right.type}`,
        ),
      ),
    positionEvents: archive.positionEvents.map((row) => ({
      account: accountNames.get(row.accountId),
      instrument: instrumentNames.get(row.instrumentId),
      type: row.type,
      quantity: row.quantity,
      cashEffectMinor: String(row.cashEffectMinor),
      date: row.tradeDate.slice(0, 10),
    })),
    snapshots: archive.estatePlanSnapshots.map((row) => ({
      title: row.title,
      valueAsOfDate: row.valueAsOfDate.slice(0, 10),
      baseCurrency: row.baseCurrency,
      content: JSON.parse(row.content),
      contentHash: row.contentHash,
    })),
  };
}

describe.sequential("Phase 6 legacy parity observer", () => {
  let outcome: Record<string, unknown>;

  beforeAll(async () => {
    const sqlite = new Database(databasePath);
    sqlite.pragma("foreign_keys = OFF");
    migrate(drizzle(sqlite), { migrationsFolder: path.resolve("db/migrations") });
    sqlite.pragma("foreign_keys = ON");
    expect(sqlite.pragma("foreign_key_check")).toHaveLength(0);
    sqlite.close();
    process.env.DATABASE_PATH = databasePath;
    process.env.SESSION_SECRET =
      "phase-six-parity-session-secret-longer-than-32-characters";

    const userId = (
      await registerUser({
        username: "phase-six-legacy",
        displayName: "Phase Six Legacy",
        password: "phase-six-fictional-password",
      })
    ).userId;
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    restoreUserData(userId, fixture);

    const archive = await exportData(userId);
    const brokerage = archive.accounts.find((row) => row.name === "Brokerage");
    const snapshotRow = archive.estatePlanSnapshots[0];
    if (!brokerage || !snapshotRow) throw new Error("Parity fixture is incomplete.");

    const position = getPositionAccountSnapshot(
      userId,
      brokerage.id,
      fixedNow.toISOString(),
    );
    const goals = await listGoals(userId, fixedNow);
    const report = await getDashboardData(userId, "all");
    const snapshot = getEstatePlanSnapshot(userId, snapshotRow.id);
    if (!snapshot) throw new Error("Parity estate snapshot was not restored.");

    outcome = {
      export: exportProjection(archive),
      balances: archive.accounts
        .map((row) => ({
          name: row.name,
          currentValueMinor: String(row.currentValueMinor),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      positions: {
        account: brokerage.name,
        cashMinor: position.cashMinor.toString(),
        positionsMinor: position.positionsMinor.toString(),
        totalMinor: position.totalMinor.toString(),
        complete: position.complete,
        holdings: position.positions.map((holding) => ({
          instrument: holding.instrument.name,
          quantity: holding.quantity,
          price: holding.price?.price ?? null,
          valueMinor: holding.accountValueMinor?.toString() ?? null,
        })),
      },
      goals: goals.map((goal) => ({
        name: goal.name,
        targetAmountMinor: String(goal.targetAmountMinor),
        currentAmountMinor: goal.currentAmountCalculated.toString(),
        currency: goal.currency,
        targetDate: goal.targetDate.slice(0, 10),
        linkedAccount: goal.accountName,
        progressPercent: goal.progressPercent,
      })),
      reports: {
        baseCurrency: report.settings.baseCurrency,
        totals: Object.fromEntries(
          Object.entries(report.totals).map(([key, value]) => [
            key,
            String(value),
          ]),
        ),
        allocation: report.allocation.map((row) => ({
          name: row.name,
          valueMinor: String(row.value),
        })),
        institutionAllocation: report.institutionAllocation.map((row) => ({
          name: row.name,
          valueMinor: String(row.value),
        })),
        instrumentAllocation: report.instrumentAllocation.map((row) => ({
          name: row.name,
          valueMinor: String(row.value),
        })),
      },
      estateSnapshots: [
        {
          title: snapshot.title,
          valueAsOfDate: snapshot.valueAsOfDate.slice(0, 10),
          baseCurrency: snapshot.baseCurrency,
          content: snapshot.content,
          contentHash: snapshot.contentHash,
        },
      ],
    };

    if (process.env.PARITY_OUTPUT) {
      fs.writeFileSync(
        process.env.PARITY_OUTPUT,
        `${JSON.stringify(outcome, null, 2)}\n`,
        { mode: 0o600 },
      );
    }
  });

  afterAll(() => {
    closeDatabase();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  test("seeds and observes every required parity surface", () => {
    expect(outcome).toMatchObject({
      balances: [
        { name: "Brokerage", currentValueMinor: "25000" },
        { name: "Everyday Cash", currentValueMinor: "1250" },
      ],
      positions: {
        cashMinor: "0",
        positionsMinor: "25000",
        totalMinor: "25000",
      },
      goals: [{ name: "Reserve", currentAmountMinor: "1250" }],
      reports: { baseCurrency: "KES" },
      estateSnapshots: [{ title: "Family plan" }],
    });
  });
});