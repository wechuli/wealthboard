import { AccountForm } from "@/components/forms/account-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { createAccountAction } from "@/app/(app)/actions";
import { listCategories } from "@/lib/services/categories";
import { getSettings } from "@/lib/bootstrap";
import { dateInputForTimezone } from "@/lib/dates";

export const metadata = { title: "Add account" };

export default async function NewAccountPage() {
  const [categories, settings] = await Promise.all([listCategories(), getSettings()]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add an account or asset" description="Start with its current value. You can add detailed history later." />
      <Card>
        <CardHeader><CardTitle>Account details</CardTitle></CardHeader>
        <CardContent><AccountForm categories={categories} action={createAccountAction} idempotencyKey={crypto.randomUUID()} today={dateInputForTimezone(settings.timezone)} /></CardContent>
      </Card>
    </div>
  );
}
