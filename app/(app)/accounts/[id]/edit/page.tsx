import { notFound } from "next/navigation";

import { updateAccountAction } from "@/app/(app)/actions";
import { AccountForm } from "@/components/forms/account-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { minorToDecimalString } from "@/lib/money";
import { getAccount } from "@/lib/services/accounts";
import { listCategories } from "@/lib/services/categories";
import { requireSession } from "@/lib/auth/session";
import { getCurrencyConfiguration } from "@/lib/services/settings";
import { listInstitutions } from "@/lib/services/institutions";

export default async function EditAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await requireSession();
  const { id } = await params;
  const [account, categories, currencyConfiguration, institutions] =
    await Promise.all([
      getAccount(userId, id),
      listCategories(userId),
      getCurrencyConfiguration(userId),
      listInstitutions(userId, { includeArchived: true }),
    ]);
  if (!account) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`Edit ${account.name}`}
        description="Account history and currency remain unchanged."
      />
      <Card>
        <CardHeader>
          <CardTitle>Account details</CardTitle>
        </CardHeader>
        <CardContent>
          <AccountForm
            categories={categories}
            currencies={currencyConfiguration.enabledCurrencies}
            baseCurrency={currencyConfiguration.baseCurrency}
            institutions={institutions}
            action={updateAccountAction.bind(null, id)}
            initial={{
              name: account.name,
              description: account.description || "",
              categoryId: account.categoryId,
              institutionId: account.institutionId || "",
              accountReference: account.accountReference || "",
              currency: account.currency,
              costBasis:
                account.costBasisMinor == null
                  ? ""
                  : minorToDecimalString(
                      account.costBasisMinor,
                      account.currency,
                    ),
              isIncludedInNetWorth: account.isIncludedInNetWorth,
              notes: account.notes || "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
