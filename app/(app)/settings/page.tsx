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
import { AuthenticationMethodsForm } from "@/components/auth-methods-form";
import { aiEncryptionAvailable } from "@/lib/ai/config";
import { getAuthConfig } from "@/lib/auth/config";
import { getSettings } from "@/lib/bootstrap";
import {
  getCurrencyConfiguration,
  listExchangeRates,
} from "@/lib/services/settings";
import { requireSession } from "@/lib/auth/session";
import { getUserAuthState } from "@/lib/auth/users";
import {
  getAiProviderSettings,
  getAiUsageSummary,
} from "@/lib/services/ai-provider";

export const metadata = { title: "Settings" };

const authenticationFeedback: Record<string, string> = {
  provider_error: "Provider verification was cancelled or rejected.",
  invalid_callback: "The provider response could not be verified. Try again.",
  access_denied: "Authentication method access was denied.",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ auth?: string }>;
}) {
  const { userId } = await requireSession();
  const query = await searchParams;
  const authConfig = getAuthConfig();
  const [
    settings,
    rates,
    currencyConfiguration,
    aiSettings,
    aiUsage,
    authState,
  ] = await Promise.all([
    getSettings(userId),
    listExchangeRates(userId),
    getCurrencyConfiguration(userId),
    getAiProviderSettings(userId),
    getAiUsageSummary(userId),
    getUserAuthState(userId, authConfig.oidc?.issuer),
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
        <AuthenticationMethodsForm
          localEnabled={authConfig.localEnabled}
          oidcEnabled={authConfig.oidcEnabled}
          providerName={authConfig.oidc?.providerName}
          hasPassword={authState?.hasPassword ?? false}
          oidcLinked={Boolean(authState?.oidcIdentity)}
          reauthenticated={query.auth === "reauthenticated"}
          feedback={query.auth ? authenticationFeedback[query.auth] : undefined}
        />
        {authConfig.localEnabled && authState?.hasPassword ? (
          <PasswordForm />
        ) : null}
        <DataPortability />
      </div>
    </>
  );
}
