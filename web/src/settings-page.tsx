import { KeyRound, Trash2, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import {
  createAPIKey,
  getAPIKeys,
  getSettings,
  revokeAllAPIKeys,
  revokeAPIKey,
} from "./api";
import type {
  APIKeyMetadata,
  CreateAPIKeyInput,
  CreatedAPIKey,
  Session,
} from "./types";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  formatDate,
  humanize,
  KeyValue,
  PageHeader,
  ResourceView,
} from "./ui";
import { useResource } from "./use-resource";
import { ExchangeRateManager, SettingsEditor } from "./metadata-forms";

const apiKeyScopes = [
  "portfolio:read",
  "portfolio:write",
  "imports:write",
  "exports:read",
  "ai:invoke",
] as const;

export function SettingsPage({ session }: { session: Session }) {
  const [refresh, setRefresh] = useState(0);
  const state = useResource(getSettings, [refresh]);
  return (
    <>
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        description="Application preferences, currencies, exchange rates, authentication, and API access."
      />
      <ResourceView state={state}>
        {(data) => (
          <div className="settings-stack">
            <SettingsEditor data={data} csrfToken={session.csrfToken} onChanged={() => setRefresh((value) => value + 1)} />
            <Card>
              <CardHeader
                title="General"
                description="Current application and financial display preferences"
              />
              <div className="key-grid">
                <KeyValue label="Display name">
                  {data.settings.displayName}
                </KeyValue>
                <KeyValue label="Application name">
                  {data.settings.appName}
                </KeyValue>
                <KeyValue label="Base currency">
                  {data.settings.baseCurrency}
                </KeyValue>
                <KeyValue label="Timezone">{data.settings.timezone}</KeyValue>
                <KeyValue label="Date format">
                  {data.settings.preferredDateFormat}
                </KeyValue>
                <KeyValue label="Dashboard period">
                  {humanize(data.settings.defaultDashboardPeriod)}
                </KeyValue>
                <KeyValue label="Session timeout">
                  {data.settings.sessionTimeoutMinutes} minutes
                </KeyValue>
                <KeyValue label="Default goal return">
                  {data.settings.defaultGoalReturnBps / 100}%
                </KeyValue>
                <KeyValue label="Stock price stale after">
                  {data.settings.positionStaleDaysStock} days
                </KeyValue>
                <KeyValue label="ETF price stale after">
                  {data.settings.positionStaleDaysEtf} days
                </KeyValue>
                <KeyValue label="Fund price stale after">
                  {data.settings.positionStaleDaysFund} days
                </KeyValue>
                <KeyValue label="Settings created">
                  {formatDate(data.settings.createdAt)}
                </KeyValue>
                <KeyValue label="Settings updated">
                  {formatDate(data.settings.updatedAt)}
                </KeyValue>
              </div>
            </Card>
            <ExchangeRateManager data={data} csrfToken={session.csrfToken} onChanged={() => setRefresh((value) => value + 1)} />
            <Card>
              <CardHeader
                title="Currencies"
                description="Enabled and referenced currency codes"
              />
              <div className="key-grid">
                <KeyValue label="Base currency">
                  {data.currencyConfiguration.baseCurrency}
                </KeyValue>
                <KeyValue label="Enabled">
                  {data.currencyConfiguration.enabledCurrencies.join(", ") ||
                    "None"}
                </KeyValue>
                <KeyValue label="Referenced">
                  {data.currencyConfiguration.referencedCurrencies.join(", ") ||
                    "None"}
                </KeyValue>
              </div>
            </Card>
            <Card>
              <CardHeader
                title="Exchange rates"
                description="Effective-dated decimal rates"
              />
              {data.exchangeRates.length ? (
                <div className="data-list">
                  {data.exchangeRates.map((rate) => (
                    <div className="data-row" key={rate.id}>
                      <div>
                        <strong>
                          {rate.baseCurrency} / {rate.quoteCurrency}
                        </strong>
                        <span>
                          {formatDate(rate.effectiveDate)} · {rate.source}
                        </span>
                      </div>
                      <strong>{rate.rate}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No exchange rates"
                  description="No effective-dated exchange rates are configured."
                />
              )}
            </Card>
            <Card>
              <CardHeader
                title="Authentication methods"
                description={`Application user status: ${humanize(data.authMethods.status)}`}
              />
              <div className="key-grid">
                <KeyValue label="Local password">
                  {data.authMethods.hasPassword ? "Enabled" : "Not enabled"}
                </KeyValue>
                <KeyValue label="OIDC identities">
                  {data.authMethods.oidcIdentities.length}
                </KeyValue>
              </div>
              {data.authMethods.oidcIdentities.map((identity) => (
                <div className="data-row" key={identity.id}>
                  <div>
                    <strong>{identity.issuer}</strong>
                    <span>Last login {formatDate(identity.lastLoginAt)}</span>
                  </div>
                </div>
              ))}
            </Card>
            <APIKeysPanel csrfToken={session.csrfToken} />
          </div>
        )}
      </ResourceView>
    </>
  );
}

type APIKeyOperations = {
  load: () => Promise<{ keys: APIKeyMetadata[] }>;
  create: (
    input: CreateAPIKeyInput,
    csrfToken: string,
  ) => Promise<CreatedAPIKey>;
  revoke: (id: string, csrfToken: string) => Promise<void>;
  revokeAll: (csrfToken: string) => Promise<{ revoked: number }>;
};

const defaultOperations: APIKeyOperations = {
  load: getAPIKeys,
  create: createAPIKey,
  revoke: revokeAPIKey,
  revokeAll: revokeAllAPIKeys,
};

export function APIKeysPanel({
  csrfToken,
  operations = defaultOperations,
}: {
  csrfToken: string;
  operations?: APIKeyOperations;
}) {
  const [keys, setKeys] = useState<APIKeyMetadata[]>();
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void operations
      .load()
      .then((value) => {
        if (active) setKeys(value.keys);
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "API keys are unavailable.",
          );
      });
    return () => {
      active = false;
    };
  }, [operations]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const scopes = apiKeyScopes.filter((scope) =>
      form.getAll("scopes").includes(scope),
    );
    const expiresAt = String(form.get("expiresAt") || "");
    if (!name || !scopes.length) {
      setError("Provide a name and at least one scope.");
      return;
    }
    setBusy(true);
    setError("");
    setSecret(null);
    try {
      const created = await operations.create(
        {
          name,
          scopes,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        },
        csrfToken,
      );
      setSecret(created.token);
      setKeys((current) => [created, ...(current || [])]);
      event.currentTarget.reset();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The API key could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError("");
    try {
      await operations.revoke(id, csrfToken);
      setKeys((current) => current?.filter((key) => key.id !== id));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The API key could not be revoked.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function revokeAll() {
    setBusy(true);
    setError("");
    try {
      await operations.revokeAll(csrfToken);
      const revokedAt = new Date().toISOString();
      setKeys((current) =>
        current?.map((key) => ({
          ...key,
          revokedAt: key.revokedAt || revokedAt,
        })),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "API keys could not be revoked.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="API keys"
        description="Browser-session managed credentials for API clients"
        aside={<KeyRound />}
      />
      {secret ? (
        <div className="secret-notice" role="status">
          <div>
            <strong>Copy this key now</strong>
            <p>This secret is shown once and cannot be recovered.</p>
            <code>{secret}</code>
          </div>
          <button
            className="icon-button"
            aria-label="Dismiss API key secret"
            onClick={() => setSecret(null)}
          >
            <X />
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : null}
      <form className="api-key-form" onSubmit={(event) => void submit(event)}>
        <div>
          <label htmlFor="api-key-name">Key name</label>
          <input id="api-key-name" name="name" maxLength={80} required />
        </div>
        <div>
          <label htmlFor="api-key-expiry">Expires (optional)</label>
          <input id="api-key-expiry" name="expiresAt" type="datetime-local" />
        </div>
        <fieldset>
          <legend>Scopes</legend>
          <div className="scope-grid">
            {apiKeyScopes.map((scope) => (
              <label key={scope}>
                <input
                  type="checkbox"
                  name="scopes"
                  value={scope}
                  defaultChecked={scope === "portfolio:read"}
                />{" "}
                {scope}
              </label>
            ))}
          </div>
        </fieldset>
        <button
          className="primary-button compact"
          disabled={busy}
          type="submit"
        >
          {busy ? "Creating..." : "Create API key"}
        </button>
      </form>
      {keys === undefined ? (
        <p className="read-note">Loading API keys...</p>
      ) : keys.length ? (
        <>
          <div className="data-list api-key-list">
            {keys.map((key) => (
              <div className="data-row" key={key.id}>
                <div>
                  <strong>{key.name}</strong>
                  <span>
                    {key.prefix} · {key.scopes.join(", ")} · created{" "}
                    {formatDate(key.createdAt)}
                    {key.expiresAt
                      ? ` · expires ${formatDate(key.expiresAt)}`
                      : ""}
                    {key.revokedAt ? " · Revoked" : ""}
                  </span>
                </div>
                {!key.revokedAt ? (
                  <button
                    className="icon-button"
                    aria-label={`Revoke ${key.name}`}
                    disabled={busy}
                    onClick={() => void revoke(key.id)}
                  >
                    <Trash2 />
                  </button>
                ) : (
                  <Badge tone="warning">Revoked</Badge>
                )}
              </div>
            ))}
          </div>
          {keys.some((key) => !key.revokedAt) ? (
            <button
              className="secondary-button danger-button"
              disabled={busy}
              onClick={() => void revokeAll()}
            >
              Revoke all active keys
            </button>
          ) : null}
        </>
      ) : (
        <EmptyState
          title="No API keys"
          description="Create a scoped key for an API client."
        />
      )}
    </Card>
  );
}
