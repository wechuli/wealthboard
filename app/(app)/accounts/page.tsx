import Link from "next/link";
import { Building2, Plus } from "lucide-react";

import { AccountsList } from "@/components/accounts-list";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { exchangeRates, goals } from "@/db/schema";
import { addUtcDays, endOfUtcDay } from "@/lib/dates";
import { getSettings } from "@/lib/bootstrap";
import { getDatabase } from "@/lib/db";
import {
  convertMinor,
  MissingExchangeRateError,
  safeChartNumber,
} from "@/lib/money";
import { accountBalanceAt, listAccounts } from "@/lib/services/accounts";
import { getPositionAccountSnapshot } from "@/lib/services/investments";
import { requireSession } from "@/lib/auth/session";
import { eq } from "drizzle-orm";

export const metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const { userId } = await requireSession();
  const [accountRows, settings, rates, goalRows] = await Promise.all([
    listAccounts(userId),
    getSettings(userId),
    getDatabase()
      .select()
      .from(exchangeRates)
      .where(eq(exchangeRates.userId, userId)),
    getDatabase()
      .select({ id: goals.id, name: goals.name })
      .from(goals)
      .where(eq(goals.userId, userId)),
  ]);
  const currentAsOf = endOfUtcDay(new Date());
  const monthAgo = addUtcDays(currentAsOf, -30).toISOString();
  const goalNames = new Map(goalRows.map((goal) => [goal.id, goal.name]));
  const items = accountRows.map((account) => {
    let convertedValueMinor: number | null = null;
    let monthlyChangeMinor: number | null = null;
    const positionSnapshot =
      account.trackingMode === "positions"
        ? getPositionAccountSnapshot(
            userId,
            account.id,
            currentAsOf.toISOString(),
          )
        : null;
    const currentValueMinor =
      positionSnapshot?.totalMinor ?? BigInt(account.currentValueMinor);
    const positionValueAsOf = positionSnapshot
      ? (positionSnapshot.positions
          .map((position) => position.price?.effectiveDate)
          .filter((value): value is string => Boolean(value))
          .sort()[0] ?? null)
      : null;
    try {
      const converted = convertMinor(
        currentValueMinor,
        account.currency,
        settings.baseCurrency,
        rates,
        currentAsOf.toISOString(),
      );
      convertedValueMinor = safeChartNumber(converted);
      const previousPosition = positionSnapshot
        ? getPositionAccountSnapshot(userId, account.id, monthAgo)
        : null;
      if (
        (positionSnapshot?.complete ?? true) &&
        (previousPosition?.complete ?? true)
      ) {
        const previousValueMinor =
          previousPosition?.totalMinor ??
          accountBalanceAt(userId, account.id, monthAgo);
        const previous =
          previousValueMinor === 0n
            ? 0n
            : convertMinor(
                previousValueMinor,
                account.currency,
                settings.baseCurrency,
                rates,
                monthAgo,
              );
        monthlyChangeMinor = safeChartNumber(converted - previous);
      }
    } catch (error) {
      if (!(error instanceof MissingExchangeRateError)) throw error;
    }
    return {
      id: account.id,
      name: account.name,
      institutionId: account.institutionId,
      institution: account.institutionName,
      institutionArchivedAt: account.institutionArchivedAt,
      categoryName: account.categoryName,
      categoryIcon: account.categoryIcon,
      currency: account.currency,
      currentValueMinor: safeChartNumber(currentValueMinor),
      convertedValueMinor,
      monthlyChangeMinor,
      isLiability: account.isLiability,
      archivedAt: account.archivedAt,
      updatedAt: account.updatedAt,
      goalName: account.goalId ? (goalNames.get(account.goalId) ?? null) : null,
      trackingMode: account.trackingMode,
      positionCount: positionSnapshot?.positions.length ?? 0,
      positionValueAsOf,
      priceState: positionSnapshot
        ? !positionSnapshot.complete
          ? ("missing" as const)
          : positionSnapshot.staleInstrumentIds.length
            ? ("stale" as const)
            : ("complete" as const)
        : ("not_applicable" as const),
    };
  });
  return (
    <>
      <PageHeader
        title="Accounts & assets"
        description="Everything you own and owe, organized in one clear view."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href="/institutions">
                <Building2 size={17} />
                Institutions
              </Link>
            </Button>
            <Button asChild>
              <Link href="/accounts/new">
                <Plus size={17} />
                Add account
              </Link>
            </Button>
          </>
        }
      />
      <AccountsList
        accounts={items}
        baseCurrency={settings.baseCurrency}
        timezone={settings.timezone}
        dateFormat={settings.preferredDateFormat}
      />
    </>
  );
}
