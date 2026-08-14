import { notFound } from "next/navigation";

import { recordInvestmentCommandAction } from "@/app/(app)/actions";
import { InvestmentCommandForm } from "@/components/forms/investment-command-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { getSettings } from "@/lib/bootstrap";
import { requireSession } from "@/lib/auth/session";
import { dateInputForTimezone } from "@/lib/dates";
import { listAccounts, getAccount } from "@/lib/services/accounts";
import { listInvestmentInstruments } from "@/lib/services/investments";
import { getCurrencyConfiguration } from "@/lib/services/settings";

const commands = [
  "reinvestment",
  "in_kind_transfer",
  "split",
  "spinoff",
  "merger",
] as const;

export default async function InvestmentActionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ command?: string }>;
}) {
  const { userId } = await requireSession();
  const { id } = await params;
  const query = await searchParams;
  const [account, accountRows, instruments, settings, currencies] =
    await Promise.all([
      getAccount(userId, id),
      listAccounts(userId),
      listInvestmentInstruments(userId),
      getSettings(userId),
      getCurrencyConfiguration(userId),
    ]);
  if (!account || account.archivedAt || account.trackingMode !== "positions") {
    notFound();
  }
  const initialCommand = commands.includes(
    query.command as (typeof commands)[number],
  )
    ? (query.command as (typeof commands)[number])
    : "reinvestment";
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Investment action"
        description={`Record grouped and non-cash position changes for ${account.name}.`}
      />
      <Card>
        <CardHeader>
          <CardTitle>Authoritative source activity</CardTitle>
        </CardHeader>
        <CardContent>
          <InvestmentCommandForm
            action={recordInvestmentCommandAction}
            accountId={account.id}
            accountCurrency={account.currency}
            positionAccounts={accountRows
              .filter(
                (candidate) =>
                  candidate.trackingMode === "positions" &&
                  !candidate.archivedAt,
              )
              .map((candidate) => ({
                id: candidate.id,
                name: candidate.name,
              }))}
            instruments={instruments}
            currencies={currencies.enabledCurrencies}
            today={dateInputForTimezone(settings.timezone)}
            initialCommand={initialCommand}
          />
        </CardContent>
      </Card>
    </div>
  );
}
