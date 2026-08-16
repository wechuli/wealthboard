import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";

import { AccountHistoryAiPrompt } from "@/components/account-history-ai-prompt";
import { AccountHistoryImport } from "@/components/account-history-import";
import { InvestmentHistoryAiPrompt } from "@/components/investment-history-ai-prompt";
import { InvestmentHistoryImport } from "@/components/investment-history-import";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { requireSession } from "@/lib/auth/session";
import { currencyDigits } from "@/lib/money";
import { getAccount } from "@/lib/services/accounts";
import { getCurrencyConfiguration } from "@/lib/services/settings";

export default async function AccountHistoryImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await requireSession();
  const { id } = await params;
  const account = await getAccount(userId, id);
  if (!account || account.archivedAt) notFound();
  const currencyConfiguration =
    account.trackingMode === "positions"
      ? getCurrencyConfiguration(userId)
      : null;

  return (
    <>
      <PageHeader
        title={`Import history for ${account.name}`}
        description={`${account.institutionName || "No institution"} · ${account.currency} · Preview a prepared ${account.trackingMode === "positions" ? "Investment History" : "Account History"} v1 file before changing this account.`}
        actions={
          <Button asChild variant="secondary">
            <Link href={`/accounts/${id}`}>
              <ArrowLeft size={16} />
              Back to account
            </Link>
          </Button>
        }
      />
      {account.trackingMode === "positions" ? (
        <>
          <Card className="mb-5">
            <CardHeader>
              <CardTitle>Investment History v1</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-slate-400">
              <p>
                Import instruments, opening holdings, trades, cash, and
                effective-dated prices. Every record uses a stable external ID.
                Any invalid interdependent event blocks the complete commit.
              </p>
              <div className="flex flex-wrap gap-2">
                <TemplateLink href="/templates/investment-history-v1.json">
                  JSON example
                </TemplateLink>
                <TemplateLink href="/templates/investment-holdings-v1.csv">
                  Opening holdings CSV
                </TemplateLink>
                <TemplateLink href="/templates/investment-trades-v1.csv">
                  Trades CSV
                </TemplateLink>
                <TemplateLink href="/templates/investment-cash-v1.csv">
                  Cash CSV
                </TemplateLink>
                <TemplateLink href="/templates/investment-prices-v1.csv">
                  Prices CSV
                </TemplateLink>
              </div>
            </CardContent>
          </Card>
          <InvestmentHistoryAiPrompt
            accountCurrency={account.currency}
            accountFractionDigits={currencyDigits(account.currency)}
            enabledCurrencies={currencyConfiguration!.enabledCurrencies}
          />
          <InvestmentHistoryImport accountId={id} />
        </>
      ) : (
        <>
          <Card className="mb-5">
            <CardHeader>
              <CardTitle>Account History Import v1</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-slate-400">
              <p>
                Each row requires a stable, case-sensitive external ID. Amounts
                use {account.currency} precision. Dates must be non-future
                YYYY-MM-DD values. Opening balances and transfers use their
                dedicated workflows.
              </p>
              <div className="border-t border-white/[0.06] pt-3">
                <p className="text-xs font-semibold uppercase text-slate-500">
                  Required CSV columns
                </p>
                <code className="mt-1 block overflow-x-auto text-sm text-emerald-300">
                  external_id,type,amount,date,description,notes
                </code>
                <p className="mt-2 text-xs text-slate-500">
                  JSON uses the same fields inside a strict version 1 envelope.
                  Report row numbers refer to CSV file lines or 1-based JSON
                  array positions.
                </p>
              </div>
              <dl className="grid gap-3 border-t border-white/[0.06] pt-3 md:grid-cols-3">
                <div>
                  <dt className="text-xs font-semibold uppercase text-slate-500">
                    Adds to balance
                  </dt>
                  <dd className="mt-1 text-xs">
                    deposit, interest, dividend, capital_gain, purchase,
                    liability_increase
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase text-slate-500">
                    Subtracts from balance
                  </dt>
                  <dd className="mt-1 text-xs">
                    withdrawal, capital_loss, fee, sale, liability_payment
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase text-slate-500">
                    Signed adjustment
                  </dt>
                  <dd className="mt-1 text-xs">
                    manual_adjustment accepts a positive or negative non-zero
                    amount. Every other type requires a positive amount.
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <TemplateLink href="/templates/account-history-v1.csv">
                  CSV template
                </TemplateLink>
                <TemplateLink href="/templates/account-history-v1.json">
                  JSON example
                </TemplateLink>
                <TemplateLink href="/templates/account-history-v1.schema.json">
                  JSON Schema
                </TemplateLink>
              </div>
            </CardContent>
          </Card>
          <AccountHistoryAiPrompt
            currency={account.currency}
            fractionDigits={currencyDigits(account.currency)}
          />
          <AccountHistoryImport accountId={id} />
        </>
      )}
    </>
  );
}

function TemplateLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Button asChild variant="secondary">
      <a href={href} download>
        <Download size={16} />
        {children}
      </a>
    </Button>
  );
}
