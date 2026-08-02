import { createGoalAction } from "@/app/(app)/actions";
import { GoalForm } from "@/components/forms/goal-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { getSettings } from "@/lib/bootstrap";
import { requireSession } from "@/lib/auth/session";
import { listAccounts } from "@/lib/services/accounts";
import { dateInputForTimezone } from "@/lib/dates";

export const metadata = { title: "Create goal" };

export default async function NewGoalPage() {
  const { userId } = await requireSession();
  const [accounts, settings] = await Promise.all([listAccounts(userId), getSettings(userId)]);
  const target = new Date();
  target.setUTCFullYear(target.getUTCFullYear() + 2);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Create a financial goal" description="Link an account to avoid duplicating balances." />
      <Card>
        <CardHeader><CardTitle>Goal plan</CardTitle></CardHeader>
        <CardContent>
          <GoalForm
            accounts={accounts}
            action={createGoalAction}
            idempotencyKey={crypto.randomUUID()}
            today={dateInputForTimezone(settings.timezone)}
            initial={{
              currency: settings.baseCurrency,
              assumedAnnualReturn: settings.defaultGoalReturnBps / 100,
              targetDate: target.toISOString().slice(0, 10),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
