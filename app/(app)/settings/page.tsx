import Link from "next/link";
import { Building2, FolderCog } from "lucide-react";

import {
  DataPortability,
  ExchangeRateForm,
  GeneralSettingsForm,
  PasswordForm,
} from "@/components/settings-forms";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { AiSettingsForm } from "@/components/ai-settings-form";
import { aiEncryptionAvailable } from "@/lib/ai/config";
import { getSettings } from "@/lib/bootstrap";
import {
  getCurrencyConfiguration,
  listExchangeRates,
} from "@/lib/services/settings";
import { requireSession } from "@/lib/auth/session";
import {
  getAiProviderSettings,
  getAiUsageSummary,
} from "@/lib/services/ai-provider";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { userId } = await requireSession();
  const [settings, rates, currencyConfiguration, aiSettings, aiUsage] =
    await Promise.all([
      getSettings(userId),
      listExchangeRates(userId),
      getCurrencyConfiguration(userId),
      getAiProviderSettings(userId),
      getAiUsageSummary(userId),
    ]);
  return (
    <>
      <PageHeader
        title="Settings"
        description="Personalize Wealthboard, manage security, rates, classifications, and portable data."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href="/institutions">
                <Building2 size={16} />
                Manage institutions
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/categories">
                <FolderCog size={16} />
                Manage categories
              </Link>
            </Button>
          </>
        }
      />
      <div className="space-y-5">
        <GeneralSettingsForm
          settings={settings}
          referencedCurrencies={currencyConfiguration.referencedCurrencies}
        />
        <ExchangeRateForm
          rates={rates}
          enabledCurrencies={currencyConfiguration.enabledCurrencies}
          baseCurrency={currencyConfiguration.baseCurrency}
        />
        <AiSettingsForm
          settings={aiSettings}
          usage={aiUsage}
          encryptionAvailable={aiEncryptionAvailable()}
        />
        <PasswordForm />
        <DataPortability />
      </div>
    </>
  );
}
