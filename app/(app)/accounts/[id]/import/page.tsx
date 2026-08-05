import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";

import { AccountHistoryImport } from "@/components/account-history-import";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { requireSession } from "@/lib/auth/session";
import { getAccount } from "@/lib/services/accounts";

export default async function AccountHistoryImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await requireSession();
  const { id } = await params;
  const account = await getAccount(userId, id);
  if (!account || account.archivedAt) notFound();

  return (
    <>
      <PageHeader
        title="Import account history"
        description="Preview a prepared Account History Import v1 file before changing this account."
        actions={
          <Button asChild variant="secondary">
            <Link href={`/accounts/${id}`}>
              <ArrowLeft size={16} />
              Back to account
            </Link>
          </Button>
        }
      />
      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Account History Import v1</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-6 text-slate-400">
          <p>
            Each row requires a stable, case-sensitive external ID. Amounts use{" "}
            {account.currency} precision. Dates must be non-future YYYY-MM-DD
            values. Opening balances and transfers use their dedicated
            workflows.
          </p>
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
      <AccountHistoryImport accountId={id} />
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
