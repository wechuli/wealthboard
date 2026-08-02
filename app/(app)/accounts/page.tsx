import Link from "next/link";
import { Plus } from "lucide-react";

import { AccountsList } from "@/components/accounts-list";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { exchangeRates, goals } from "@/db/schema";
import { addUtcDays } from "@/lib/dates";
import { getSettings } from "@/lib/bootstrap";
import { getDatabase } from "@/lib/db";
import {
  convertMinor,
  MissingExchangeRateError,
  safeChartNumber,
} from "@/lib/money";
import { accountBalanceAt, listAccounts } from "@/lib/services/accounts";

export const metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const [accountRows, settings, rates, goalRows] = await Promise.all([
    listAccounts({ includeArchived: true }),
    getSettings(),
    getDatabase().select().from(exchangeRates),
    getDatabase().select({ id: goals.id, name: goals.name }).from(goals),
  ]);
  const monthAgo = addUtcDays(new Date(), -30).toISOString();
  const currentAsOf = new Date();
  currentAsOf.setUTCHours(23, 59, 59, 999);
  const goalNames = new Map(goalRows.map((goal) => [goal.id, goal.name]));
  const items = accountRows.map((account) => {
    let convertedValueMinor: number | null = null;
    let monthlyChangeMinor: number | null = null;
    try {
      const converted = convertMinor(
        account.currentValueMinor,
        account.currency,
        settings.baseCurrency,
        rates,
        currentAsOf.toISOString(),
      );
      const previous = convertMinor(
        accountBalanceAt(account.id, monthAgo),
        account.currency,
        settings.baseCurrency,
        rates,
        monthAgo,
      );
      convertedValueMinor = safeChartNumber(converted);
      monthlyChangeMinor = safeChartNumber(converted - previous);
    } catch (error) {
      if (!(error instanceof MissingExchangeRateError)) throw error;
    }
    return {
      id: account.id,
      name: account.name,
      institution: account.institution,
      categoryName: account.categoryName,
      categoryIcon: account.categoryIcon,
      currency: account.currency,
      currentValueMinor: account.currentValueMinor,
      convertedValueMinor,
      monthlyChangeMinor,
      isLiability: account.isLiability,
      archivedAt: account.archivedAt,
      updatedAt: account.updatedAt,
      goalName: account.goalId ? goalNames.get(account.goalId) ?? null : null,
    };
  });
  return (
    <>
      <PageHeader
        title="Accounts & assets"
        description="Everything you own and owe, organized in one clear view."
        actions={<Button asChild><Link href="/accounts/new"><Plus size={17} />Add account</Link></Button>}
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
