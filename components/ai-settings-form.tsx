"use client";

import { useActionState, useState } from "react";
import {
  KeyRound,
  LoaderCircle,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import {
  clearAiUsageHistoryAction,
  deleteStoredAiCredentialAction,
  disconnectAiProviderAction,
  updateAiProviderSettingsAction,
} from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Checkbox,
  FieldError,
  Input,
  Label,
  Select,
} from "@/components/ui/form-controls";

type SettingsView = {
  provider: "openai" | "deepseek" | "custom";
  baseUrl: string;
  model: string;
  hasStoredApiKey: boolean;
  apiKeyHint: string | null;
  includeExactAmounts: boolean;
  includeAccountNames: boolean;
  monthlyTokenLimit: number;
  maxOutputTokens: number;
  updatedAt: string;
} | null;

type UsageView = {
  billingMonth: string;
  chargedTokens: number;
  remainingTokens: number;
  monthlyTokenLimit: number;
  successfulReviews: number;
  lastUsedAt: string | null;
} | null;

const providerEndpoints = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
};

export function AiSettingsForm({
  settings,
  usage,
  encryptionAvailable,
}: {
  settings: SettingsView;
  usage: UsageView;
  encryptionAvailable: boolean;
}) {
  const [state, action, pending] = useActionState(
    updateAiProviderSettingsAction,
    {},
  );
  const [deleteState, deleteAction, deleting] = useActionState(
    deleteStoredAiCredentialAction,
    {},
  );
  const [clearState, clearAction, clearing] = useActionState(
    clearAiUsageHistoryAction,
    {},
  );
  const [disconnectState, disconnectAction, disconnecting] = useActionState(
    disconnectAiProviderAction,
    {},
  );
  const [provider, setProvider] = useState<"openai" | "deepseek" | "custom">(
    settings?.provider ?? "openai",
  );
  const [customBaseUrl, setCustomBaseUrl] = useState(
    settings?.provider === "custom" ? settings.baseUrl : "",
  );
  const [remember, setRemember] = useState(settings?.hasStoredApiKey ?? false);
  const preserveUnavailableCredential =
    Boolean(settings?.hasStoredApiKey) && !encryptionAvailable;
  const endpoint =
    provider === "custom" ? customBaseUrl : providerEndpoints[provider];

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>AI portfolio review</CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            Connect OpenAI, DeepSeek, or an operator-approved compatible
            endpoint. Reviews are generated only when requested.
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-emerald-300">
          <ShieldCheck size={15} /> Read-only
        </span>
      </CardHeader>
      <CardContent className="space-y-5">
        <form action={action} className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="aiProvider">Provider</Label>
            <Select
              id="aiProvider"
              name="provider"
              value={provider}
              onChange={(event) =>
                setProvider(
                  event.target.value as "openai" | "deepseek" | "custom",
                )
              }
            >
              <option value="openai">OpenAI</option>
              <option value="deepseek">DeepSeek</option>
              <option value="custom">OpenAI-compatible endpoint</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="aiModel">Model identifier</Label>
            <Input
              id="aiModel"
              name="model"
              defaultValue={settings?.model ?? ""}
              placeholder="Provider model name"
              autoComplete="off"
              required
            />
            <FieldError>{state.fieldErrors?.model?.[0]}</FieldError>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="aiBaseUrl">API endpoint</Label>
            <Input
              id="aiBaseUrl"
              name="baseUrl"
              value={endpoint}
              readOnly={provider !== "custom"}
              onChange={(event) => setCustomBaseUrl(event.target.value)}
              placeholder="https://models.example.com/v1"
            />
            {provider === "custom" ? (
              <p className="mt-1.5 text-xs text-slate-500">
                The deployment operator must list this exact URL in
                AI_ALLOWED_ENDPOINTS.
              </p>
            ) : null}
            <FieldError>{state.fieldErrors?.baseUrl?.[0]}</FieldError>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="aiApiKey">API key</Label>
            <Input
              id="aiApiKey"
              name="apiKey"
              type="password"
              autoComplete="new-password"
              placeholder={
                settings?.hasStoredApiKey
                  ? `Stored credential ${settings.apiKeyHint ?? ""}`
                  : "Enter only when saving an encrypted credential"
              }
              disabled={!encryptionAvailable}
            />
            <FieldError>{state.fieldErrors?.apiKey?.[0]}</FieldError>
            <p className="mt-1.5 text-xs text-slate-500">
              Session-only keys are entered on the Review page and are never
              stored. A saved key replaces the previous credential.
            </p>
          </div>
          {preserveUnavailableCredential ? (
            <input type="hidden" name="rememberApiKey" value="on" />
          ) : (
            <Checkbox
              name="rememberApiKey"
              checked={remember}
              disabled={!encryptionAvailable}
              onChange={(event) => setRemember(event.target.checked)}
              label={
                settings?.hasStoredApiKey
                  ? `Keep encrypted credential ${settings.apiKeyHint ?? ""}`
                  : "Encrypt and remember this key"
              }
            />
          )}
          <div className="text-xs text-slate-500 sm:flex sm:items-center">
            {encryptionAvailable
              ? "Credential encryption is available for this deployment."
              : "Set AI_CREDENTIAL_ENCRYPTION_KEY to enable remembered keys."}
          </div>
          <fieldset className="rounded-xl border border-white/[0.06] p-4 sm:col-span-2">
            <legend className="px-1 text-sm font-medium text-slate-300">
              Default sharing
            </legend>
            <div className="grid gap-1 sm:grid-cols-2">
              <Checkbox
                name="includeExactAmounts"
                defaultChecked={settings?.includeExactAmounts ?? false}
                label="Include exact aggregate amounts"
              />
              <Checkbox
                name="includeAccountNames"
                defaultChecked={settings?.includeAccountNames ?? false}
                label="Include account and goal names"
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Notes, references, descriptions, and raw transaction rows are
              never shared.
            </p>
          </fieldset>
          <div>
            <Label htmlFor="monthlyTokenLimit">Monthly token limit</Label>
            <Input
              id="monthlyTokenLimit"
              name="monthlyTokenLimit"
              type="number"
              min="10000"
              max="5000000"
              step="1000"
              defaultValue={settings?.monthlyTokenLimit ?? 100000}
            />
            <FieldError>{state.fieldErrors?.monthlyTokenLimit?.[0]}</FieldError>
          </div>
          <div>
            <Label htmlFor="maxOutputTokens">Maximum output tokens</Label>
            <Input
              id="maxOutputTokens"
              name="maxOutputTokens"
              type="number"
              min="256"
              step="1"
              defaultValue={settings?.maxOutputTokens ?? 1200}
            />
            <FieldError>{state.fieldErrors?.maxOutputTokens?.[0]}</FieldError>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
            <p
              role="status"
              className={
                state.ok ? "text-sm text-emerald-300" : "text-sm text-red-300"
              }
            >
              {state.message}
            </p>
            <Button disabled={pending}>
              {pending ? (
                <LoaderCircle className="animate-spin" size={16} />
              ) : (
                <Save size={16} />
              )}
              Save AI settings
            </Button>
          </div>
        </form>

        <div className="grid gap-3 border-t border-white/[0.06] pt-5 sm:grid-cols-2">
          <div className="rounded-xl bg-white/[0.025] p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              {usage?.billingMonth ?? "Current month"}
            </p>
            <p className="mt-2 text-sm text-slate-300">
              {usage
                ? `${usage.chargedTokens.toLocaleString()} of ${usage.monthlyTokenLimit.toLocaleString()} tokens used`
                : "No AI usage recorded."}
            </p>
            {usage ? (
              <>
                <p className="mt-1 text-xs text-slate-500">
                  {usage.successfulReviews} successful reviews
                </p>
                <form action={clearAction} className="mt-3">
                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    disabled={clearing}
                  >
                    {clearing ? (
                      <LoaderCircle className="animate-spin" size={15} />
                    ) : (
                      <Trash2 size={15} />
                    )}
                    Clear usage history
                  </Button>
                </form>
              </>
            ) : null}
            {clearState.message ? (
              <p
                role="status"
                className={
                  clearState.ok
                    ? "mt-2 text-xs text-emerald-300"
                    : "mt-2 text-xs text-red-300"
                }
              >
                {clearState.message}
              </p>
            ) : null}
          </div>
          <div className="rounded-xl border border-red-400/10 bg-red-400/[0.025] p-4">
            <p className="text-sm font-medium text-slate-300">
              Stored credential
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {settings?.hasStoredApiKey
                ? `Encrypted key ${settings.apiKeyHint ?? ""}`
                : "No provider key is stored."}
            </p>
            {settings?.hasStoredApiKey ? (
              <form action={deleteAction} className="mt-3">
                <Button
                  type="submit"
                  variant="danger"
                  size="sm"
                  disabled={deleting}
                >
                  {deleting ? (
                    <LoaderCircle className="animate-spin" size={15} />
                  ) : (
                    <Trash2 size={15} />
                  )}
                  Delete stored key
                </Button>
              </form>
            ) : (
              <span className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
                <KeyRound size={14} /> Session-only keys remain available.
              </span>
            )}
            {deleteState.message ? (
              <p
                role="status"
                className={
                  deleteState.ok
                    ? "mt-2 text-xs text-emerald-300"
                    : "mt-2 text-xs text-red-300"
                }
              >
                {deleteState.message}
              </p>
            ) : null}
          </div>
        </div>
        {settings ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-5">
            <div>
              <p className="text-sm font-medium text-slate-300">
                Disconnect AI
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Deletes provider configuration and any encrypted credential.
                Usage history remains until cleared separately.
              </p>
            </div>
            <form action={disconnectAction}>
              <Button
                type="submit"
                variant="danger"
                size="sm"
                disabled={disconnecting}
              >
                {disconnecting ? (
                  <LoaderCircle className="animate-spin" size={15} />
                ) : (
                  <Trash2 size={15} />
                )}
                Disconnect provider
              </Button>
            </form>
            {disconnectState.message ? (
              <p
                role="status"
                className={
                  disconnectState.ok
                    ? "w-full text-xs text-emerald-300"
                    : "w-full text-xs text-red-300"
                }
              >
                {disconnectState.message}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
