import {
  ArchiveRestore,
  Building2,
  Copy,
  Download,
  FolderCog,
  History,
  KeyRound,
  Link2,
  Link2Off,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  clearAIUsage,
  createAPIKey,
  createExchangeRate,
  deleteAICredential,
  deleteExchangeRate,
  disconnectAI,
  downloadExport,
  getAI,
  getAPIKeys,
  getAuthConfig,
  getSettings,
  restoreUser,
  revokeAllAPIKeys,
  revokeAPIKey,
  saveAICredential,
  saveAISettings,
  updateSettings,
} from "@/api/client";
import {
  authenticationOperations,
  type AuthenticationOperations,
} from "@/lib/auth-operations";
import {
  Button,
  buttonClasses,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  PageHeader,
  Select,
} from "@/components/ui/primitives";
import { PrivateValue } from "@/components/privacy";
import type {
  AIRead,
  APIKeyMetadata,
  CreateAPIKeyInput,
  CreatedAPIKey,
  AuthConfig,
  ExchangeRateInput,
  Session,
  SettingsInput,
  SettingsRead,
} from "@/lib/types";
import { ErrorState, LoadingState } from "@/components/ui/resource";
import { useResource } from "@/hooks/use-resource";

type SettingsData = {
  settings: SettingsRead;
  ai: AIRead;
  authConfig: AuthConfig;
};

const initialDateInput = new Date().toISOString().slice(0, 10);

function dateAgeInDays(today: string, effectiveDate: string) {
  return Math.floor(
    (new Date(`${today}T00:00:00Z`).getTime() -
      new Date(effectiveDate).getTime()) /
      86_400_000,
  );
}

function localeDate(value: string) {
  return new Date(value).toLocaleDateString();
}

type SettingsOperations = {
  load: () => Promise<SettingsData>;
  updateSettings: typeof updateSettings;
  createExchangeRate: typeof createExchangeRate;
  deleteExchangeRate: typeof deleteExchangeRate;
  saveAISettings: typeof saveAISettings;
  saveAICredential: typeof saveAICredential;
  deleteAICredential: typeof deleteAICredential;
  disconnectAI: typeof disconnectAI;
  clearAIUsage: typeof clearAIUsage;
  getAPIKeys: typeof getAPIKeys;
  createAPIKey: typeof createAPIKey;
  revokeAPIKey: typeof revokeAPIKey;
  revokeAllAPIKeys: typeof revokeAllAPIKeys;
  downloadExport: typeof downloadExport;
  restoreUser: typeof restoreUser;
  authentication: AuthenticationOperations;
};

const defaultOperations: SettingsOperations = {
  load: async () => {
    const [settings, ai, authConfig] = await Promise.all([
      getSettings(),
      getAI(),
      getAuthConfig(),
    ]);
    return { settings, ai, authConfig };
  },
  updateSettings,
  createExchangeRate,
  deleteExchangeRate,
  saveAISettings,
  saveAICredential,
  deleteAICredential,
  disconnectAI,
  clearAIUsage,
  getAPIKeys,
  createAPIKey,
  revokeAPIKey,
  revokeAllAPIKeys,
  downloadExport,
  restoreUser,
  authentication: authenticationOperations,
};

function ActionMessage({ ok, message }: { ok?: boolean; message?: string }) {
  if (!message) return null;
  return (
    <p
      role={ok ? "status" : "alert"}
      className={ok ? "text-sm text-emerald-300" : "text-sm text-red-300"}
    >
      {message}
    </p>
  );
}

function useNotice() {
  const [state, setState] = useState<{ ok?: boolean; message?: string }>({});
  const [pending, setPending] = useState(false);
  async function run(action: () => Promise<unknown>, success: string) {
    setPending(true);
    setState({});
    try {
      await action();
      setState({ ok: true, message: success });
      return true;
    } catch (error) {
      setState({
        message:
          error instanceof Error
            ? error.message
            : "The request could not be completed.",
      });
      return false;
    } finally {
      setPending(false);
    }
  }
  return { state, pending, run };
}

export function SettingsPage({
  session,
  reauthenticated = false,
  feedback,
  operations = defaultOperations,
}: {
  session: Session;
  reauthenticated?: boolean;
  feedback?: string;
  operations?: SettingsOperations;
}) {
  const [version, setVersion] = useState(0);
  const resource = useResource(operations.load, [operations, version]);
  const changed = () => setVersion((current) => current + 1);

  if (resource.status === "loading")
    return <LoadingState label="Loading settings..." />;
  if (resource.status === "error")
    return <ErrorState message={resource.message} />;
  const { settings, ai, authConfig } = resource.data;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Personalize Wealthboard, manage security, rates, classifications, and portable data."
        actions={
          <>
            <Link
              className={buttonClasses({ variant: "secondary" })}
              to="/accounts/archived"
            >
              <ArchiveRestore size={16} /> Archived accounts
            </Link>
            <Link
              className={buttonClasses({ variant: "secondary" })}
              to="/institutions"
            >
              <Building2 size={16} /> Manage institutions
            </Link>
            <Link
              className={buttonClasses({ variant: "secondary" })}
              to="/categories"
            >
              <FolderCog size={16} /> Manage categories
            </Link>
          </>
        }
      />
      <div className="space-y-5">
        <GeneralSettingsForm
          data={settings}
          session={session}
          onChanged={changed}
          operation={operations.updateSettings}
        />
        <ExchangeRateManager
          data={settings}
          session={session}
          onChanged={changed}
          createRate={operations.createExchangeRate}
          removeRate={operations.deleteExchangeRate}
        />
        <AiSettingsForm
          ai={ai}
          session={session}
          onChanged={changed}
          operations={operations}
        />
        <AuthenticationMethodsForm
          authConfig={authConfig}
          hasPassword={settings.authMethods.hasPassword}
          oidcLinked={settings.authMethods.oidcIdentities.length > 0}
          reauthenticated={reauthenticated}
          feedback={feedback}
          session={session}
          operations={operations.authentication}
          onChanged={changed}
        />
        {authConfig.localEnabled && settings.authMethods.hasPassword ? (
          <PasswordForm
            session={session}
            operation={operations.authentication.changePassword}
          />
        ) : null}
        <PersonalAPIKeys
          session={session}
          operations={operations}
        />
        <DataPortability
          session={session}
          onChanged={changed}
          download={operations.downloadExport}
          restore={operations.restoreUser}
        />
      </div>
    </>
  );
}

const apiKeyScopes = [
  ["portfolio:read", "Read portfolio data"],
  ["portfolio:write", "Change portfolio data"],
  ["imports:write", "Preview and commit imports"],
  ["exports:read", "Download user exports"],
  ["ai:invoke", "Invoke configured AI workflows"],
] as const satisfies ReadonlyArray<
  readonly [CreateAPIKeyInput["scopes"][number], string]
>;

function PersonalAPIKeys({
  session,
  operations,
}: {
  session: Session;
  operations: Pick<
    SettingsOperations,
    "getAPIKeys" | "createAPIKey" | "revokeAPIKey" | "revokeAllAPIKeys"
  >;
}) {
  const [version, setVersion] = useState(0);
  const [created, setCreated] = useState<CreatedAPIKey>();
  const [notice, setNotice] = useState<{ ok?: boolean; message?: string }>({});
  const [pending, setPending] = useState(false);
  const resource = useResource(operations.getAPIKeys, [operations, version]);
  const refresh = () => setVersion((current) => current + 1);

  const run = async (action: () => Promise<void>, success: string) => {
    setPending(true);
    setNotice({});
    try {
      await action();
      setNotice({ ok: true, message: success });
      refresh();
    } catch (error) {
      setNotice({
        message:
          error instanceof Error
            ? error.message
            : "The API key request could not be completed.",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Personal API keys</CardTitle>
          <p className="mt-1 text-sm text-slate-400">
            Create scoped credentials for scripts and external API clients.
          </p>
        </div>
        <KeyRound size={18} className="text-emerald-300" />
      </CardHeader>
      <CardContent className="space-y-5">
        {created ? (
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-amber-100">
                  Copy this key now
                </p>
                <p className="mt-1 text-xs text-amber-200/80">
                  Wealthboard will not show the complete key again.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Dismiss API key secret"
                onClick={() => setCreated(undefined)}
              >
                <X size={16} />
              </Button>
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label="New API key secret"
                readOnly
                value={created.token}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => void navigator.clipboard.writeText(created.token)}
              >
                <Copy size={16} /> Copy
              </Button>
            </div>
          </div>
        ) : null}

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const formElement = event.currentTarget;
            const form = new FormData(formElement);
            const name = String(form.get("name") ?? "").trim();
            const scopes = apiKeyScopes
              .map(([scope]) => scope)
              .filter((scope) => form.getAll("scopes").includes(scope));
            const expiry = String(form.get("expiresAt") ?? "");
            setPending(true);
            setNotice({});
            void operations
              .createAPIKey(
                {
                  name,
                  scopes,
                  expiresAt: expiry
                    ? new Date(`${expiry}T23:59:59.999Z`).toISOString()
                    : null,
                },
                session.csrfToken,
              )
              .then((key) => {
                setCreated(key);
                setNotice({ ok: true, message: "API key created." });
                formElement.reset();
                refresh();
              })
              .catch((error) =>
                setNotice({
                  message:
                    error instanceof Error
                      ? error.message
                      : "The API key could not be created.",
                }),
              )
              .finally(() => setPending(false));
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="apiKeyName">Name</Label>
              <Input id="apiKeyName" name="name" maxLength={80} required />
            </div>
            <div>
              <Label htmlFor="apiKeyExpiry">Expires on (optional)</Label>
              <Input id="apiKeyExpiry" name="expiresAt" type="date" />
            </div>
          </div>
          <fieldset>
            <legend className="text-sm font-medium text-slate-200">Scopes</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {apiKeyScopes.map(([scope, label]) => (
                <Checkbox
                  key={scope}
                  name="scopes"
                  value={scope}
                  defaultChecked={scope === "portfolio:read"}
                  label={label}
                />
              ))}
            </div>
          </fieldset>
          <Button disabled={pending}>
            <Plus size={16} /> {pending ? "Creating..." : "Create API key"}
          </Button>
        </form>

        <ActionMessage {...notice} />
        {resource.status === "loading" ? (
          <p className="text-sm text-slate-400">Loading API keys...</p>
        ) : resource.status === "error" ? (
          <p role="alert" className="text-sm text-red-300">{resource.message}</p>
        ) : resource.data.keys.length ? (
          <div className="space-y-2">
            {resource.data.keys.map((key: APIKeyMetadata) => (
              <div
                key={key.id}
                className="flex flex-col gap-3 rounded-xl border border-white/[0.07] p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-100">
                    {key.name}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {key.prefix} · {key.scopes.join(", ")}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Created {localeDate(key.createdAt)}
                    {key.expiresAt ? ` · Expires ${localeDate(key.expiresAt)}` : ""}
                    {key.revokedAt ? " · Revoked" : ""}
                  </p>
                </div>
                {!key.revokedAt ? (
                  <Button
                    type="button"
                    variant="danger"
                    disabled={pending}
                    onClick={() => {
                      if (!window.confirm(`Revoke ${key.name}?`)) return;
                      void run(
                        () => operations.revokeAPIKey(key.id, session.csrfToken),
                        "API key revoked.",
                      );
                    }}
                  >
                    <Trash2 size={16} /> Revoke
                  </Button>
                ) : null}
              </div>
            ))}
            {resource.data.keys.some((key: APIKeyMetadata) => !key.revokedAt) ? (
              <Button
                type="button"
                variant="danger"
                disabled={pending}
                onClick={() => {
                  if (!window.confirm("Revoke every active API key?")) return;
                  void run(
                    async () => {
                      await operations.revokeAllAPIKeys(session.csrfToken);
                    },
                    "All active API keys revoked.",
                  );
                }}
              >
                <Trash2 size={16} /> Revoke all active keys
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No API keys created yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function currencyName(code: string) {
  try {
    return new Intl.DisplayNames(["en"], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function supportedCurrencyCodes(configured: string[]) {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: "currency") => string[];
  };
  return [
    ...new Set([
      ...(intl.supportedValuesOf?.("currency") ?? []),
      ...configured,
    ]),
  ].sort();
}

function ThemeControl() {
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    localStorage.getItem("wealthboard-theme") === "light" ? "light" : "dark",
  );
  return (
    <div>
      <Label htmlFor="theme">Theme</Label>
      <Select
        id="theme"
        value={theme}
        onChange={(event) => {
          const next = event.target.value as "dark" | "light";
          setTheme(next);
          document.documentElement.dataset.theme = next;
          document.documentElement.style.colorScheme = next;
          localStorage.setItem("wealthboard-theme", next);
        }}
      >
        <option value="dark">Dark</option>
        <option value="light">Light</option>
      </Select>
    </div>
  );
}

export function GeneralSettingsForm({
  data,
  session,
  onChanged,
  operation,
}: {
  data: SettingsRead;
  session: Session;
  onChanged: () => void;
  operation: typeof updateSettings;
}) {
  const { settings, currencyConfiguration } = data;
  const [baseCurrency, setBaseCurrency] = useState(settings.baseCurrency);
  const [enabled, setEnabled] = useState(settings.supportedCurrencies);
  const notice = useNotice();
  const referenced = new Set(currencyConfiguration.referencedCurrencies);
  const options = useMemo(
    () =>
      supportedCurrencyCodes([
        ...enabled,
        baseCurrency,
        ...currencyConfiguration.referencedCurrencies,
      ]).map((code) => ({ code, name: currencyName(code) })),
    [baseCurrency, currencyConfiguration.referencedCurrencies, enabled],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preferences</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-5 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const input: SettingsInput = {
              displayName: String(form.get("displayName") ?? ""),
              appName: String(form.get("appName") ?? ""),
              baseCurrency,
              supportedCurrencies: enabled,
              timezone: String(form.get("timezone") ?? ""),
              preferredDateFormat: String(
                form.get("preferredDateFormat"),
              ) as SettingsInput["preferredDateFormat"],
              defaultDashboardPeriod: String(
                form.get("defaultDashboardPeriod"),
              ) as SettingsInput["defaultDashboardPeriod"],
              sessionTimeoutMinutes: Number(form.get("sessionTimeoutMinutes")),
              defaultGoalReturnBps: Math.round(
                Number(form.get("defaultGoalReturn")) * 100,
              ),
              positionStaleDaysStock: Number(
                form.get("positionStaleDaysStock"),
              ),
              positionStaleDaysEtf: Number(form.get("positionStaleDaysEtf")),
              positionStaleDaysFund: Number(form.get("positionStaleDaysFund")),
            };
            void notice
              .run(
                () => operation(input, session.csrfToken),
                "Preferences saved.",
              )
              .then((ok) => ok && onChanged());
          }}
        >
          <div>
            <Label htmlFor="displayName">Display name</Label>
            <Input
              id="displayName"
              name="displayName"
              defaultValue={settings.displayName}
            />
          </div>
          <div>
            <Label htmlFor="appName">Application name</Label>
            <Input
              id="appName"
              name="appName"
              defaultValue={settings.appName}
            />
          </div>
          <div>
            <Label htmlFor="baseCurrency">Base currency</Label>
            <Select
              id="baseCurrency"
              name="baseCurrency"
              value={baseCurrency}
              onChange={(event) => {
                const value = event.target.value;
                setBaseCurrency(value);
                setEnabled((current) => [...new Set([...current, value])]);
              }}
            >
              {options.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code} - {currency.name}
                </option>
              ))}
            </Select>
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-sm font-medium text-slate-300">
              Enabled currencies
            </legend>
            <div className="grid max-h-72 gap-2 overflow-y-auto rounded-xl border border-white/10 bg-black/15 p-2 sm:grid-cols-2 lg:grid-cols-3">
              {options.map((currency) => {
                const isBase = currency.code === baseCurrency;
                const isReferenced = referenced.has(currency.code);
                return (
                  <label
                    key={currency.code}
                    className="flex min-h-11 items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-slate-300 hover:bg-white/[0.04]"
                  >
                    <input
                      type="checkbox"
                      checked={enabled.includes(currency.code)}
                      disabled={isBase || isReferenced}
                      onChange={(event) =>
                        setEnabled((current) =>
                          event.target.checked
                            ? [...new Set([...current, currency.code])]
                            : current.filter((code) => code !== currency.code),
                        )
                      }
                      className="h-4 w-4 shrink-0 accent-emerald-400"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-slate-200">
                        {currency.code}
                      </span>
                      <span className="ml-2 text-xs text-slate-500">
                        {currency.name}
                      </span>
                    </span>
                    {isBase ? (
                      <span className="text-xs text-emerald-300">Base</span>
                    ) : isReferenced ? (
                      <span className="text-xs text-slate-500">In use</span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div>
            <Label htmlFor="timezone">Timezone</Label>
            <Input
              id="timezone"
              name="timezone"
              defaultValue={settings.timezone}
            />
          </div>
          <div>
            <Label htmlFor="preferredDateFormat">Date format</Label>
            <Select
              id="preferredDateFormat"
              name="preferredDateFormat"
              defaultValue={settings.preferredDateFormat}
            >
              <option value="dd MMM yyyy">31 Dec 2026</option>
              <option value="dd/MM/yyyy">31/12/2026</option>
              <option value="MM/dd/yyyy">12/31/2026</option>
              <option value="yyyy-MM-dd">2026-12-31</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="defaultDashboardPeriod">
              Default dashboard period
            </Label>
            <Select
              id="defaultDashboardPeriod"
              name="defaultDashboardPeriod"
              defaultValue={settings.defaultDashboardPeriod}
            >
              <option value="1m">One month</option>
              <option value="3m">Three months</option>
              <option value="6m">Six months</option>
              <option value="1y">One year</option>
              <option value="all">All time</option>
            </Select>
          </div>
          <ThemeControl />
          <div>
            <Label htmlFor="sessionTimeoutMinutes">
              Session timeout (minutes)
            </Label>
            <Input
              id="sessionTimeoutMinutes"
              name="sessionTimeoutMinutes"
              type="number"
              min="15"
              defaultValue={settings.sessionTimeoutMinutes}
            />
          </div>
          <div>
            <Label htmlFor="defaultGoalReturn">Default goal return (%)</Label>
            <Input
              id="defaultGoalReturn"
              name="defaultGoalReturn"
              type="number"
              min="0"
              max="100"
              step="0.1"
              defaultValue={settings.defaultGoalReturnBps / 100}
            />
          </div>
          <fieldset className="grid gap-4 sm:col-span-2 sm:grid-cols-3">
            <legend className="mb-1 text-sm font-medium text-slate-300 sm:col-span-3">
              Price freshness thresholds
            </legend>
            {(
              [
                [
                  "positionStaleDaysStock",
                  "Stocks (days)",
                  settings.positionStaleDaysStock,
                ],
                [
                  "positionStaleDaysEtf",
                  "ETFs (days)",
                  settings.positionStaleDaysEtf,
                ],
                [
                  "positionStaleDaysFund",
                  "Funds (days)",
                  settings.positionStaleDaysFund,
                ],
              ] as const
            ).map(([name, label, value]) => (
              <div key={name}>
                <Label htmlFor={name}>{label}</Label>
                <Input
                  id={name}
                  name={name}
                  type="number"
                  min="1"
                  max="3650"
                  defaultValue={value}
                />
              </div>
            ))}
          </fieldset>
          <div className="flex items-end justify-between gap-3 sm:col-span-2">
            <ActionMessage {...notice.state} />
            <Button disabled={notice.pending}>
              {notice.pending ? (
                <LoaderCircle className="animate-spin" size={16} />
              ) : (
                <Save size={16} />
              )}
              Save preferences
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

type Rate = SettingsRead["exchangeRates"][number];

export function ExchangeRateManager({
  data,
  session,
  onChanged,
  createRate,
  removeRate,
}: {
  data: SettingsRead;
  session: Session;
  onChanged: () => void;
  createRate: typeof createExchangeRate;
  removeRate: typeof deleteExchangeRate;
}) {
  const [draft, setDraft] = useState<Partial<Rate>>();
  const notice = useNotice();
  const enabled = data.currencyConfiguration.enabledCurrencies;
  const today = initialDateInput;
  const groups = useMemo(() => {
    const grouped = new Map<string, Rate[]>();
    for (const rate of data.exchangeRates) {
      const key = [rate.baseCurrency, rate.quoteCurrency].sort().join("/");
      grouped.set(key, [...(grouped.get(key) ?? []), rate]);
    }
    return [...grouped.entries()].map(([key, history]) => ({
      key,
      history: history.sort((left, right) =>
        right.effectiveDate.localeCompare(left.effectiveDate),
      ),
    }));
  }, [data.exchangeRates]);
  const open = (value?: Partial<Rate>) =>
    setDraft(
      value ?? {
        baseCurrency:
          enabled.find((code) => code !== data.settings.baseCurrency) ??
          data.settings.baseCurrency,
        quoteCurrency: data.settings.baseCurrency,
        effectiveDate: today,
      },
    );

  return (
    <section
      id="exchange-rates"
      aria-labelledby="exchange-rates-title"
      className="scroll-mt-6 border-t border-white/10 py-5"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="exchange-rates-title" className="text-base font-semibold">
          Exchange rates
        </h2>
        <Button
          type="button"
          variant="secondary"
          disabled={enabled.length < 2}
          onClick={() => open()}
        >
          <Plus size={16} /> Add pair
        </Button>
      </div>
      <ActionMessage {...notice.state} />
      {draft ? (
        <form
          className="mb-4 border-y border-white/10 py-4"
          aria-label={draft.id ? "Correct exchange rate" : "Save exchange rate"}
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const input: ExchangeRateInput = {
              baseCurrency: String(form.get("baseCurrency")),
              quoteCurrency: String(form.get("quoteCurrency")),
              rate: String(form.get("rate")),
              effectiveDate: String(form.get("effectiveDate")),
            };
            void notice
              .run(async () => {
                if (draft.id) await removeRate(draft.id, session.csrfToken);
                await createRate(input, session.csrfToken);
              }, "Exchange rate saved.")
              .then((ok) => {
                if (ok) {
                  setDraft(undefined);
                  onChanged();
                }
              });
          }}
        >
          <h3 className="mb-3 text-sm font-semibold">
            {draft.id ? "Correct exchange rate" : "Save exchange rate"}
          </h3>
          <fieldset
            disabled={notice.pending}
            className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <div className="min-w-0">
              <Label htmlFor="rateBase">Base currency</Label>
              <Select
                id="rateBase"
                name="baseCurrency"
                defaultValue={draft.baseCurrency}
              >
                {enabled.map((code) => (
                  <option key={code}>
                    {code} - {currencyName(code)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-0">
              <Label htmlFor="rateQuote">Quote currency</Label>
              <Select
                id="rateQuote"
                name="quoteCurrency"
                defaultValue={draft.quoteCurrency}
              >
                {enabled.map((code) => (
                  <option key={code}>
                    {code} - {currencyName(code)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-0">
              <Label htmlFor="exchange-rate-value">Rate (quote per base)</Label>
              <Input
                id="exchange-rate-value"
                name="rate"
                inputMode="decimal"
                defaultValue={draft.rate}
                required
              />
            </div>
            <div className="min-w-0">
              <Label htmlFor="effectiveDate">Effective date</Label>
              <Input
                id="effectiveDate"
                name="effectiveDate"
                type="date"
                defaultValue={draft.effectiveDate?.slice(0, 10) ?? today}
                required
              />
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 sm:col-span-2 lg:col-span-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDraft(undefined)}
              >
                <X size={16} /> Cancel
              </Button>
              <Button type="submit">
                <Save size={16} /> {notice.pending ? "Saving..." : "Save rate"}
              </Button>
            </div>
          </fieldset>
        </form>
      ) : null}
      {!groups.length ? (
        <p className="py-4 text-sm text-slate-400">No exchange rates saved.</p>
      ) : null}
      {enabled.length < 2 ? (
        <p className="text-sm text-slate-400">
          Enable another currency in Preferences to add a rate.
        </p>
      ) : null}
      <div className="divide-y divide-white/10">
        {groups.map((group) => {
          const latest = group.history[0];
          const pair = `${latest.baseCurrency}/${latest.quoteCurrency}`;
          const age = dateAgeInDays(today, latest.effectiveDate);
          return (
            <div key={group.key} className="py-4" data-rate-pair={group.key}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{pair}</h3>
                  <p className="break-all text-sm text-slate-300">
                    <PrivateValue>{latest.rate}</PrivateValue>
                  </p>
                </div>
                <div className="text-xs text-slate-400">
                  <p>{localeDate(latest.effectiveDate)}</p>
                  <p className={age > 30 ? "text-amber-200" : "text-slate-400"}>
                    {age > 30 ? "Over a month old" : "Current"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  title={`Update ${pair}`}
                  aria-label={`Update ${pair}`}
                  size="icon"
                  onClick={() => open({ ...latest, effectiveDate: today })}
                >
                  <RefreshCw size={16} />
                </Button>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer py-2 text-xs text-slate-400">
                  <History size={14} className="mr-1 inline" /> {pair} history (
                  {group.history.length})
                </summary>
                <ul className="divide-y divide-white/5">
                  {group.history.map((entry) => {
                    const entryPair = `${entry.baseCurrency}/${entry.quoteCurrency}`;
                    const entryDate = localeDate(entry.effectiveDate);
                    return (
                      <li
                        key={entry.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <p>
                            {entryDate}{" "}
                            <span className="text-xs text-slate-500">
                              {entry.source}
                            </span>
                          </p>
                          <p className="break-all text-slate-300">
                            {entryPair}:{" "}
                            <PrivateValue>{entry.rate}</PrivateValue>
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title={`Edit ${entryPair} rate from ${entryDate}`}
                          aria-label={`Edit ${entryPair} rate from ${entryDate}`}
                          onClick={() => open(entry)}
                        >
                          <Pencil size={16} />
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          size="icon"
                          title={`Delete ${entryPair} rate from ${entryDate}`}
                          aria-label={`Delete ${entryPair} rate from ${entryDate}`}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete this ${entryPair} rate from ${entryDate}? Current balances will use an older rate if available. Historical totals may become incomplete.`,
                              )
                            )
                              void notice
                                .run(
                                  () => removeRate(entry.id, session.csrfToken),
                                  "Exchange rate deleted.",
                                )
                                .then((ok) => ok && onChanged());
                          }}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </details>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AiSettingsForm({
  ai,
  session,
  onChanged,
  operations,
}: {
  ai: AIRead;
  session: Session;
  onChanged: () => void;
  operations: SettingsOperations;
}) {
  const settings = ai.settings;
  const [provider, setProvider] = useState(settings?.provider ?? "openai");
  const [customBaseUrl, setCustomBaseUrl] = useState(
    settings?.provider === "custom" ? settings.baseUrl : "",
  );
  const [remember, setRemember] = useState(settings?.hasStoredApiKey ?? false);
  const notice = useNotice();
  const endpoint =
    provider === "openai"
      ? "https://api.openai.com/v1"
      : provider === "deepseek"
        ? "https://api.deepseek.com"
        : customBaseUrl;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>AI provider</CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            Connect OpenAI, DeepSeek, or a compatible endpoint configured for
            this Wealthboard instance for on-demand reviews and file conversion.
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-emerald-300">
          <ShieldCheck size={15} /> Read-only
        </span>
      </CardHeader>
      <CardContent className="space-y-5">
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const input = {
              provider: provider as "openai" | "deepseek" | "custom",
              baseUrl: String(form.get("baseUrl")),
              model: String(form.get("model")),
              includeExactAmounts: form.has("includeExactAmounts"),
              includeAccountNames: form.has("includeAccountNames"),
              monthlyTokenLimit: Number(form.get("monthlyTokenLimit")),
              maxOutputTokens: Number(form.get("maxOutputTokens")),
            };
            const key = String(form.get("apiKey") ?? "");
            void notice
              .run(async () => {
                await operations.saveAISettings(input, session.csrfToken);
                if (remember && key)
                  await operations.saveAICredential(key, session.csrfToken);
              }, "AI settings saved.")
              .then((ok) => ok && onChanged());
          }}
        >
          <div>
            <Label htmlFor="aiProvider">Provider</Label>
            <Select
              id="aiProvider"
              name="provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
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
                This endpoint must be enabled for your Wealthboard instance.
              </p>
            ) : null}
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
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Session-only keys are entered on the Review or Import page and are
              never stored. A saved key replaces the previous credential.
            </p>
          </div>
          <Checkbox
            name="rememberApiKey"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
            label={
              settings?.hasStoredApiKey
                ? `Keep encrypted credential ${settings.apiKeyHint ?? ""}`
                : "Encrypt and remember this key"
            }
          />
          <div className="text-xs text-slate-500 sm:flex sm:items-center">
            Remembered API keys are encrypted before storage.
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
              Reviews never share notes, references, descriptions, or raw
              transaction rows. Import conversion requires separate
              source-sharing consent.
            </p>
          </fieldset>
          <div>
            <Label htmlFor="monthlyTokenLimit">Monthly token limit</Label>
            <Input
              id="monthlyTokenLimit"
              name="monthlyTokenLimit"
              type="number"
              min="10000"
              max="100000000"
              step="1000"
              defaultValue={settings?.monthlyTokenLimit ?? 100000}
            />
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
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
            <ActionMessage {...notice.state} />
            <Button disabled={notice.pending}>
              {notice.pending ? (
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
              {ai.usage.billingMonth || "Current month"}
            </p>
            <p className="mt-2 text-sm text-slate-300">
              {ai.usage.chargedTokens.toLocaleString()} of{" "}
              {ai.usage.monthlyTokenLimit.toLocaleString()} tokens used
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {ai.usage.successfulReviews} successful AI requests
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() =>
                void notice
                  .run(
                    () => operations.clearAIUsage(session.csrfToken),
                    "Usage history cleared.",
                  )
                  .then((ok) => ok && onChanged())
              }
            >
              <Trash2 size={15} /> Clear usage history
            </Button>
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
              <Button
                type="button"
                variant="danger"
                size="sm"
                className="mt-3"
                onClick={() =>
                  void notice
                    .run(
                      () => operations.deleteAICredential(session.csrfToken),
                      "Stored key deleted.",
                    )
                    .then((ok) => ok && onChanged())
                }
              >
                <Trash2 size={15} /> Delete stored key
              </Button>
            ) : (
              <span className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
                <KeyRound size={14} /> Session-only keys remain available.
              </span>
            )}
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
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={() =>
                void notice
                  .run(
                    () => operations.disconnectAI(session.csrfToken),
                    "AI provider disconnected.",
                  )
                  .then((ok) => ok && onChanged())
              }
            >
              <Trash2 size={15} /> Disconnect provider
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AuthSubmit({
  pending,
  icon,
  children,
}: {
  pending: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      {pending ? (
        <LoaderCircle
          className="animate-spin motion-reduce:animate-none"
          size={16}
        />
      ) : (
        icon
      )}
      {children}
    </>
  );
}

function AuthenticationMethodsForm({
  authConfig,
  hasPassword,
  oidcLinked,
  reauthenticated,
  feedback,
  session,
  operations,
  onChanged,
}: {
  authConfig: AuthConfig;
  hasPassword: boolean;
  oidcLinked: boolean;
  reauthenticated: boolean;
  feedback?: string;
  session: Session;
  operations: AuthenticationOperations;
  onChanged: () => void;
}) {
  const notice = useNotice();
  const hybrid = authConfig.localEnabled && authConfig.oidcEnabled;
  const provider = authConfig.providerName || "OIDC provider";
  const passwordForm = (event: React.FormEvent<HTMLFormElement>) =>
    String(new FormData(event.currentTarget).get("currentPassword") ?? "");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Authentication methods</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {feedback ? (
          <p
            role="alert"
            className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200"
          >
            {feedback}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex min-h-20 items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
            <KeyRound className="text-emerald-300" size={20} />
            <div>
              <p className="text-sm font-medium text-slate-100">
                Local password
              </p>
              <p className="text-xs text-slate-400">
                {authConfig.localEnabled
                  ? hasPassword
                    ? "Enabled"
                    : "Not enabled"
                  : "Unavailable"}
              </p>
            </div>
          </div>
          <div className="flex min-h-20 items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
            <ShieldCheck className="text-emerald-300" size={20} />
            <div>
              <p className="text-sm font-medium text-slate-100">{provider}</p>
              <p className="text-xs text-slate-400">
                {authConfig.oidcEnabled
                  ? oidcLinked
                    ? "Linked"
                    : "Not linked"
                  : "Unavailable"}
              </p>
            </div>
          </div>
        </div>
        {hybrid && hasPassword && !oidcLinked ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void notice.run(
                () =>
                  operations.linkOidc(passwordForm(event), session.csrfToken),
                "Continue with your provider.",
              );
            }}
          >
            <p className="text-sm text-slate-300">
              Confirm your current password, then continue through {provider} to
              link the identity explicitly.
            </p>
            <div className="max-w-sm">
              <Label htmlFor="linkCurrentPassword">Current password</Label>
              <Input
                id="linkCurrentPassword"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={notice.pending}>
                <AuthSubmit pending={notice.pending} icon={<Link2 size={16} />}>
                  Link {provider}
                </AuthSubmit>
              </Button>
              <ActionMessage {...notice.state} />
            </div>
          </form>
        ) : null}
        {hybrid && hasPassword && oidcLinked ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void notice
                  .run(
                    () =>
                      operations.unlinkOidc(
                        passwordForm(event),
                        session.csrfToken,
                      ),
                    "Provider unlinked.",
                  )
                  .then((ok) => ok && onChanged());
              }}
            >
              <p className="text-sm text-slate-300">
                Unlink provider sign-in after confirming your local password.
              </p>
              <div>
                <Label htmlFor="unlinkCurrentPassword">Current password</Label>
                <Input
                  id="unlinkCurrentPassword"
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                />
              </div>
              <Button variant="outline" disabled={notice.pending}>
                <AuthSubmit
                  pending={notice.pending}
                  icon={<Link2Off size={16} />}
                >
                  Unlink {provider}
                </AuthSubmit>
              </Button>
            </form>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void notice.run(
                  () => operations.reauthenticateOidc(session.csrfToken),
                  "Continue with your provider.",
                );
              }}
            >
              <p className="text-sm text-slate-300">
                Removing local sign-in requires a fresh verification with{" "}
                {provider}.
              </p>
              <Button variant="outline" disabled={notice.pending}>
                <AuthSubmit
                  pending={notice.pending}
                  icon={<ShieldCheck size={16} />}
                >
                  Verify with {provider}
                </AuthSubmit>
              </Button>
            </form>
            <ActionMessage {...notice.state} />
          </div>
        ) : null}
        {hybrid && !hasPassword && oidcLinked ? (
          !reauthenticated ? (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void notice.run(
                  () => operations.reauthenticateOidc(session.csrfToken),
                  "Continue with your provider.",
                );
              }}
            >
              <p className="text-sm text-slate-300">
                Verify with {provider} before creating a local username and
                password.
              </p>
              <Button variant="outline" disabled={notice.pending}>
                <AuthSubmit
                  pending={notice.pending}
                  icon={<ShieldCheck size={16} />}
                >
                  Verify with {provider}
                </AuthSubmit>
              </Button>
            </form>
          ) : (
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void notice
                  .run(
                    () =>
                      operations.enableLocalCredential(
                        {
                          username: String(form.get("username")),
                          password: String(form.get("password")),
                          confirmPassword: String(form.get("confirmPassword")),
                        },
                        session.csrfToken,
                      ),
                    "Local sign-in enabled.",
                  )
                  .then((ok) => ok && onChanged());
              }}
            >
              <div className="sm:col-span-2">
                <p className="text-sm text-emerald-300">
                  Provider verification complete. This authorization expires
                  shortly.
                </p>
              </div>
              <div>
                <Label htmlFor="localUsername">Local username</Label>
                <Input
                  id="localUsername"
                  name="username"
                  autoComplete="username"
                />
              </div>
              <div>
                <Label htmlFor="localPassword">Password</Label>
                <Input
                  id="localPassword"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                />
              </div>
              <div>
                <Label htmlFor="localConfirmPassword">Confirm password</Label>
                <Input
                  id="localConfirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                />
              </div>
              <div className="flex items-end">
                <Button disabled={notice.pending}>
                  <AuthSubmit
                    pending={notice.pending}
                    icon={<KeyRound size={16} />}
                  >
                    Enable local sign-in
                  </AuthSubmit>
                </Button>
              </div>
              <ActionMessage {...notice.state} />
            </form>
          )
        ) : null}
        {hybrid && hasPassword && oidcLinked && reauthenticated ? (
          <form
            className="space-y-3 border-t border-white/[0.07] pt-5"
            onSubmit={(event) => {
              event.preventDefault();
              void notice
                .run(
                  () => operations.removeLocalCredential(session.csrfToken),
                  "Local sign-in removed.",
                )
                .then((ok) => ok && onChanged());
            }}
          >
            <p className="text-sm text-emerald-300">
              Provider verification complete. Removing local sign-in leaves{" "}
              {provider} as your usable method.
            </p>
            <Button variant="danger" disabled={notice.pending}>
              <AuthSubmit
                pending={notice.pending}
                icon={<KeyRound size={16} />}
              >
                Remove local sign-in
              </AuthSubmit>
            </Button>
            <ActionMessage {...notice.state} />
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PasswordForm({
  session,
  operation,
}: {
  session: Session;
  operation: AuthenticationOperations["changePassword"];
}) {
  const notice = useNotice();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void notice.run(
              () =>
                operation(
                  {
                    currentPassword: String(form.get("currentPassword")),
                    newPassword: String(form.get("newPassword")),
                    confirmPassword: String(form.get("confirmPassword")),
                  },
                  session.csrfToken,
                ),
              "Password changed.",
            );
          }}
        >
          <div>
            <Label htmlFor="currentPassword">Current password</Label>
            <Input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
            />
          </div>
          <div>
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
            />
          </div>
          <div>
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
            />
          </div>
          <div className="flex items-center justify-between gap-3 sm:col-span-3">
            <ActionMessage {...notice.state} />
            <Button disabled={notice.pending}>
              <KeyRound size={16} /> Change password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function DataPortability({
  session,
  onChanged,
  download,
  restore,
}: {
  session: Session;
  onChanged: () => void;
  download: typeof downloadExport;
  restore: typeof restoreUser;
}) {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const notice = useNotice();
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Import, restore & export</CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            Portable files contain only your portfolio, never credentials or
            another user&apos;s records.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void download("/exports/user", "wealthboard-export.json")
            }
          >
            <Download size={16} /> Export JSON
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void download(
                "/exports/transactions.csv",
                "wealthboard-transactions.csv",
              )
            }
          >
            <Download size={16} /> Transactions CSV
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void download("/exports/accounts.csv", "wealthboard-accounts.csv")
            }
          >
            <Download size={16} /> Accounts CSV
          </Button>
        </div>
        <div className="border-t border-white/[0.06] pt-5">
          <div className="rounded-xl border border-amber-400/10 bg-amber-400/[0.035] p-4">
            <Label htmlFor="userRestore">Restore your JSON export</Label>
            <Input
              ref={fileRef}
              id="userRestore"
              type="file"
              accept=".json,application/json"
            />
            <Button
              type="button"
              variant="danger"
              className="mt-3"
              disabled={notice.pending}
              onClick={() => {
                const file = fileRef.current?.files?.[0];
                if (!file)
                  return void notice.run(
                    () => Promise.reject(new Error("Choose a file first.")),
                    "",
                  );
                if (
                  !window.confirm(
                    "Replace only your portfolio with this export? A copy of your current data will download first.",
                  )
                )
                  return;
                void notice
                  .run(async () => {
                    await download(
                      "/exports/user",
                      `wealthboard-before-restore-${new Date().toISOString().slice(0, 10)}.json`,
                    );
                    await restore(file, session.csrfToken);
                  }, "Portfolio restored.")
                  .then((ok) => {
                    if (ok) {
                      onChanged();
                      navigate("/");
                    }
                  });
              }}
            >
              {notice.pending ? (
                <LoaderCircle className="animate-spin" size={16} />
              ) : (
                <Upload size={16} />
              )}{" "}
              Replace my portfolio
            </Button>
            <ActionMessage {...notice.state} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
