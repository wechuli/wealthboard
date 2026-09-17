import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ArchivedAccountActions } from "@/components/archived-account-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { requireSession } from "@/lib/auth/session";
import { getSettings } from "@/lib/bootstrap";
import { formatDate } from "@/lib/dates";
import { listArchivedAccounts } from "@/lib/services/accounts";

export const metadata = { title: "Archived accounts" };

export default async function ArchivedAccountsPage() {
  const { userId } = await requireSession();
  const [accounts, settings] = await Promise.all([
    listArchivedAccounts(userId),
    getSettings(userId),
  ]);
  return (
    <>
      <PageHeader
        title="Archived accounts"
        actions={
          <Button asChild variant="secondary">
            <Link href="/settings">
              <ArrowLeft size={16} />
              Settings
            </Link>
          </Button>
        }
      />
      {!accounts.length ? (
        <p className="py-10 text-sm text-slate-500">No archived accounts.</p>
      ) : (
        <div className="divide-y divide-white/10">
          {accounts.map((account) => (
            <section
              key={account.id}
              aria-label={account.name}
              className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <h2 className="break-words text-sm font-semibold text-slate-100">
                  {account.name}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Archived{" "}
                  {formatDate(
                    account.archivedAt!,
                    settings.timezone,
                    settings.preferredDateFormat,
                  )}
                </p>
                {account.convertedToId ? (
                  <Badge className="mt-2">Converted source</Badge>
                ) : null}
              </div>
              <ArchivedAccountActions
                accountId={account.id}
                name={account.name}
                canRestore={!account.convertedToId}
              />
            </section>
          ))}
        </div>
      )}
    </>
  );
}
