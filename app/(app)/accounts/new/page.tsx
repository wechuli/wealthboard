import { AccountForm } from "@/components/forms/account-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { createAccountAction } from "@/app/(app)/actions";
import { listCategories } from "@/lib/services/categories";
import { getSettings } from "@/lib/bootstrap";
import { requireSession } from "@/lib/auth/session";
import { dateInputForTimezone } from "@/lib/dates";
import { getCurrencyConfiguration } from "@/lib/services/settings";

export const metadata = { title: "Add account" };

export default async function NewAccountPage() {
  const { userId } = await requireSession();
  const [categories, settings, currencyConfiguration] = await Promise.all([
    listCategories(userId),
    getSettings(userId),
    getCurrencyConfiguration(userId),
  ]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Add an account or asset"
        description="Start with its current value. You can add detailed history later."
      />
      <Card>
        <CardHeader>
          <CardTitle>Account details</CardTitle>
        </CardHeader>
        <CardContent>
          <AccountForm
            categories={categories}
            action={createAccountAction}
            idempotencyKey={crypto.randomUUID()}
            today={dateInputForTimezone(settings.timezone)}
            currencies={currencyConfiguration.enabledCurrencies}
            baseCurrency={currencyConfiguration.baseCurrency}
          />
        </CardContent>
      </Card>
    </div>
  );
}
