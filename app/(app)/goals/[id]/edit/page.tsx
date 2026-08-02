import { notFound } from "next/navigation";

import { updateGoalAction } from "@/app/(app)/actions";
import { GoalForm } from "@/components/forms/goal-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { utcToDateInput } from "@/lib/dates";
import { minorToDecimalString } from "@/lib/money";
import { listAccounts } from "@/lib/services/accounts";
import { getGoal } from "@/lib/services/goals";

export default async function EditGoalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [goal, accounts] = await Promise.all([getGoal(id), listAccounts()]);
  if (!goal) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Edit ${goal.name}`} description="Update the target, link, contribution plan, or forecast assumption." />
      <Card>
        <CardHeader><CardTitle>Goal plan</CardTitle></CardHeader>
        <CardContent>
          <GoalForm
            accounts={accounts}
            action={updateGoalAction.bind(null, id)}
            initial={{
              name: goal.name,
              description: goal.description || "",
              targetAmount: minorToDecimalString(goal.targetAmountMinor, goal.currency),
              currentAmount: minorToDecimalString(goal.currentAmountMinor, goal.currency),
              currency: goal.currency,
              targetDate: utcToDateInput(goal.targetDate),
              linkedAccountId: goal.linkedAccountId || "",
              icon: goal.icon,
              status: goal.status,
              priority: goal.priority,
              assumedAnnualReturn: goal.assumedAnnualReturnBps / 100,
              plannedContribution: minorToDecimalString(goal.plannedContributionMinor || 0, goal.currency),
              frequency: goal.frequency || "monthly",
              planStartDate: goal.planStartDate ? utcToDateInput(goal.planStartDate) : new Date().toISOString().slice(0, 10),
              planEndDate: goal.planEndDate ? utcToDateInput(goal.planEndDate) : "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
