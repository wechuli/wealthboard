import { AccountForm } from "@/components/forms/account-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { createAccountAction } from "@/app/(app)/actions";
import { listCategories } from "@/lib/services/categories";
import { getSettings } from "@/lib/bootstrap";
import { requireSession } from "@/lib/auth/session";
import { dateInputForTimezone } from "@/lib/dates";
import { getCurrencyConfiguration } from "@/lib/services/settings";
import { listInstitutions } from "@/lib/services/institutions";

export const metadata = { title: "Add account" };

export default async function NewAccountPage() {
  const { userId } = await requireSession();
  const [categories, settings, currencyConfiguration, institutions] =
    await Promise.all([
      listCategories(userId),
      getSettings(userId),
      getCurrencyConfiguration(userId),
      listInstitutions(userId),
    ]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Add an account or asset"
        description="Track one monetary value or use units and prices for an investment account."
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
            institutions={institutions}
          />
        </CardContent>
      </Card>
    </div>
  );
}
