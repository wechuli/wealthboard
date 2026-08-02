import Link from "next/link";
import { FolderCog } from "lucide-react";

import {
  DataPortability,
  ExchangeRateForm,
  GeneralSettingsForm,
  PasswordForm,
} from "@/components/settings-forms";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { getSettings } from "@/lib/bootstrap";
import { listExchangeRates } from "@/lib/services/settings";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { userId } = await requireSession();
  const [settings, rates] = await Promise.all([
    getSettings(userId),
    listExchangeRates(userId),
  ]);
  return (
    <>
      <PageHeader
        title="Settings"
        description="Personalize Worthboard, manage security, rates, classifications, and portable data."
        actions={<Button asChild variant="secondary"><Link href="/categories"><FolderCog size={16} />Manage categories</Link></Button>}
      />
      <div className="space-y-5">
        <GeneralSettingsForm settings={settings} />
        <ExchangeRateForm rates={rates} />
        <PasswordForm />
        <DataPortability />
      </div>
    </>
  );
}
