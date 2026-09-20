import { zodResolver } from "@hookform/resolvers/zod";
import { FileSearch, Save, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import {
  clearAIUsage,
  convertAIDocument,
  deleteAICredential,
  disconnectAI,
  extractAIDocument,
  generateAIReview,
  getAccounts,
  getDashboard,
  getGoals,
  getReportAllocation,
  saveAICredential,
  saveAISettings,
} from "./api";
import type { AIConversionDraft, AIRead, AISource, Session } from "./types";
import { Card, CardHeader } from "./ui";

const settingsSchema = z
  .object({
    provider: z.enum(["openai", "deepseek", "custom"]),
    baseUrl: z.url(),
    model: z.string().trim().min(1).max(160),
    includeExactAmounts: z.boolean(),
    includeAccountNames: z.boolean(),
    monthlyTokenLimit: z.coerce.number().int().min(1000).max(10_000_000),
    maxOutputTokens: z.coerce.number().int().min(100).max(100_000),
    apiKey: z.string().max(4096),
  })
  .refine((value) => value.maxOutputTokens <= value.monthlyTokenLimit, {
    path: ["maxOutputTokens"],
    message: "Output tokens cannot exceed the monthly limit.",
  });
const reviewSchema = z.object({
  period: z.enum(["1m", "3m", "6m", "1y", "all"]),
  focus: z.enum([
    "overall",
    "allocation",
    "goals",
    "cash-flow",
    "data-quality",
  ]),
  apiKey: z.string().max(4096),
});

export function AIWorkflowWorkspace({
  ai,
  session,
  onChanged,
}: {
  ai: AIRead;
  session: Session;
  onChanged: () => void;
}) {
  return (
    <div className="settings-stack">
      <AISettingsForm ai={ai} session={session} onChanged={onChanged} />
      <AIReviewForm ai={ai} session={session} onChanged={onChanged} />
      <DocumentConversion ai={ai} session={session} />
    </div>
  );
}

function AISettingsForm({
  ai,
  session,
  onChanged,
}: {
  ai: AIRead;
  session: Session;
  onChanged: () => void;
}) {
  const [error, setError] = useState("");
  const form = useForm({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      provider: (ai.settings?.provider || "openai") as "openai",
      baseUrl: ai.settings?.baseUrl || "https://api.openai.com/v1",
      model: ai.settings?.model || "",
      includeExactAmounts: ai.settings?.includeExactAmounts || false,
      includeAccountNames: ai.settings?.includeAccountNames || false,
      monthlyTokenLimit: ai.settings?.monthlyTokenLimit || 100000,
      maxOutputTokens: ai.settings?.maxOutputTokens || 4000,
      apiKey: "",
    },
  });
  const provider = useWatch({ control: form.control, name: "provider" });
  const submit = form.handleSubmit(async ({ apiKey, ...values }) => {
    setError("");
    try {
      await saveAISettings(values, session.csrfToken);
      if (apiKey) await saveAICredential(apiKey, session.csrfToken);
      form.setValue("apiKey", "");
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "AI settings could not be saved.",
      );
    }
  });
  return (
    <Card>
      <CardHeader
        title="AI provider"
        description="Credentials are write-only and may be removed independently."
      />
      {error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : null}
      <form
        className="auth-form"
        data-financial-mutation="true"
        onSubmit={submit}
      >
        <div className="form-grid">
          <Label label="Provider" id="ai-provider">
            <select id="ai-provider" {...form.register("provider")}>
              <option value="openai">OpenAI</option>
              <option value="deepseek">DeepSeek</option>
              <option value="custom">Custom</option>
            </select>
          </Label>
          <Label label="Base URL" id="ai-base-url">
            <input
              id="ai-base-url"
              disabled={provider !== "custom"}
              {...form.register("baseUrl")}
            />
          </Label>
          <Label label="Model" id="ai-model">
            <input id="ai-model" {...form.register("model")} />
          </Label>
          <Label label="API key (leave blank to keep stored key)" id="ai-key">
            <input
              id="ai-key"
              type="password"
              autoComplete="off"
              {...form.register("apiKey")}
            />
          </Label>
          <Label label="Monthly token limit" id="ai-monthly">
            <input
              id="ai-monthly"
              type="number"
              {...form.register("monthlyTokenLimit")}
            />
          </Label>
          <Label label="Maximum output tokens" id="ai-output">
            <input
              id="ai-output"
              type="number"
              {...form.register("maxOutputTokens")}
            />
          </Label>
        </div>
        <label>
          <input type="checkbox" {...form.register("includeExactAmounts")} />{" "}
          Allow exact financial amounts
        </label>
        <label>
          <input type="checkbox" {...form.register("includeAccountNames")} />{" "}
          Allow private account names
        </label>
        <button
          className="primary-button compact"
          disabled={form.formState.isSubmitting}
        >
          <Save size={16} /> Save provider
        </button>
      </form>
      <div className="page-actions">
        {ai.settings?.hasStoredApiKey ? (
          <button
            className="secondary-button danger-button"
            onClick={async () => {
              if (!window.confirm("Delete the stored AI credential?")) return;
              await deleteAICredential(session.csrfToken);
              onChanged();
            }}
          >
            <Trash2 size={16} /> Delete credential
          </button>
        ) : null}
        <button
          className="secondary-button"
          onClick={async () => {
            if (
              !window.confirm(
                "Disconnect the AI provider and delete its stored credential?",
              )
            )
              return;
            await disconnectAI(session.csrfToken);
            onChanged();
          }}
        >
          Disconnect
        </button>
        <button
          className="secondary-button"
          onClick={async () => {
            if (!window.confirm("Clear AI usage history for this user?"))
              return;
            await clearAIUsage(session.csrfToken);
            onChanged();
          }}
        >
          Clear usage
        </button>
      </div>
    </Card>
  );
}

function AIReviewForm({
  ai,
  session,
  onChanged,
}: {
  ai: AIRead;
  session: Session;
  onChanged: () => void;
}) {
  const [result, setResult] = useState<Record<string, unknown>>();
  const [error, setError] = useState("");
  const form = useForm({
    resolver: zodResolver(reviewSchema),
    defaultValues: {
      period: "1y" as const,
      focus: "overall" as const,
      apiKey: "",
    },
  });
  const submit = form.handleSubmit(async (values) => {
    setError("");
    try {
      const [dashboard, allocation, goals, accounts] = await Promise.all([
        getDashboard(),
        getReportAllocation(),
        getGoals(),
        getAccounts(),
      ]);
      const includeAmounts = ai.settings?.includeExactAmounts ?? false;
      const includeNames = ai.settings?.includeAccountNames ?? false;
      const snapshot = {
        schemaVersion: 1,
        asOf: new Date().toISOString(),
        period: values.period,
        focus: values.focus,
        baseCurrency: dashboard.baseCurrency,
        sharing: {
          includeExactAmounts: includeAmounts,
          includeAccountNames: includeNames,
        },
        completeness: {
          currentComplete: dashboard.currentComplete,
          missingCurrencies: dashboard.missingCurrencies,
        },
        portfolio: includeAmounts
          ? dashboard.totals
          : {
              accountCount: dashboard.accountCount,
              goalCount: dashboard.goalCount,
            },
        allocations: allocation,
        topAccounts: accounts.items
          .slice(0, 10)
          .map((account, index) => ({
            reference: `account-${index + 1}`,
            name: includeNames ? account.name : undefined,
            valueMinor: includeAmounts ? account.currentValueMinor : undefined,
            currency: account.currency,
          })),
        cashFlow: {},
        goals: goals.map((goal, index) => ({
          reference: `goal-${index + 1}`,
          name: includeNames ? goal.name : undefined,
          status: goal.status,
          progressPercent: goal.progressPercent,
        })),
        dataQuality: dashboard.missingCurrencies,
        methodology: { source: "owner-scoped live API reads" },
      };
      setResult(
        await generateAIReview({ ...values, snapshot }, session.csrfToken),
      );
      form.setValue("apiKey", "");
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The review could not be generated.",
      );
    }
  });
  return (
    <Card>
      <CardHeader
        title="Generate portfolio review"
        description="A bounded snapshot is sent only after you submit this form."
        aside={<Sparkles />}
      />
      {error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : null}
      <form
        className="auth-form"
        data-financial-mutation="true"
        onSubmit={submit}
      >
        <div className="form-grid">
          <Label label="Period" id="review-period">
            <select id="review-period" {...form.register("period")}>
              <option value="1m">1 month</option>
              <option value="3m">3 months</option>
              <option value="6m">6 months</option>
              <option value="1y">1 year</option>
              <option value="all">All history</option>
            </select>
          </Label>
          <Label label="Focus" id="review-focus">
            <select id="review-focus" {...form.register("focus")}>
              <option value="overall">Overall</option>
              <option value="allocation">Allocation</option>
              <option value="goals">Goals</option>
              <option value="cash-flow">Cash flow</option>
              <option value="data-quality">Data quality</option>
            </select>
          </Label>
          <Label label="Session API key (optional)" id="review-key">
            <input
              id="review-key"
              type="password"
              autoComplete="off"
              {...form.register("apiKey")}
            />
          </Label>
        </div>
        <button
          className="primary-button compact"
          disabled={form.formState.isSubmitting || !ai.settings}
        >
          <Sparkles size={16} />
          {form.formState.isSubmitting ? "Reviewing..." : "Generate review"}
        </button>
      </form>
      {result ? <JsonResult title="Review result" value={result} /> : null}
    </Card>
  );
}

function DocumentConversion({ ai, session }: { ai: AIRead; session: Session }) {
  const [file, setFile] = useState<File>();
  const [password, setPassword] = useState("");
  const [source, setSource] = useState<AISource>();
  const [draft, setDraft] = useState<AIConversionDraft>();
  const [trackingMode, setTrackingMode] = useState<"balance" | "positions">(
    "balance",
  );
  const [currency, setCurrency] = useState("USD");
  const [apiKey, setAPIKey] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const extract = async () => {
    if (!file) {
      setError("Choose a supported document.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setSource(
        (await extractAIDocument(file, password, session.csrfToken)).source,
      );
      setPassword("");
      setDraft(undefined);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The document could not be extracted.",
      );
    } finally {
      setBusy(false);
    }
  };
  const convert = async () => {
    if (!source || !ai.settings) return;
    setBusy(true);
    setError("");
    try {
      const serialized = JSON.stringify([
        ai.settings.provider,
        ai.settings.baseUrl,
        ai.settings.model,
        ai.settings.maxOutputTokens,
        ai.settings.updatedAt,
        trackingMode,
        currency,
      ]);
      const hash = [
        ...new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(serialized),
          ),
        ),
      ]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      setDraft(
        await convertAIDocument(
          {
            source,
            configurationHash: hash,
            consent,
            apiKey,
            trackingMode,
            currency,
          },
          session.csrfToken,
        ),
      );
      setAPIKey("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The draft could not be converted.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader
        title="Document conversion"
        description="Extraction is local to the server. Review and redact every source unit before sending it to the provider; drafts are never committed automatically."
        aside={<FileSearch />}
      />
      {error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="auth-form">
        <div className="form-grid">
          <Label label="Source document" id="ai-document">
            <input
              id="ai-document"
              type="file"
              accept=".txt,.csv,.tsv,.json,.pdf,.xlsx,.docx"
              onChange={(event) => setFile(event.target.files?.[0])}
            />
          </Label>
          <Label label="PDF password (not stored)" id="ai-document-password">
            <input
              id="ai-document-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Label>
        </div>
        <button
          className="secondary-button"
          data-financial-mutation="true"
          disabled={busy}
          onClick={() => void extract()}
        >
          <FileSearch size={16} /> Extract
        </button>
        {source ? (
          <>
            <div className="data-list">
              {source.units.map((unit, index) => (
                <div className="data-row" key={unit.id}>
                  <div>
                    <strong>{unit.location}</strong>
                    <textarea
                      aria-label={`Redact ${unit.location}`}
                      value={unit.text}
                      onChange={(event) =>
                        setSource({
                          ...source,
                          units: source.units.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, text: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="form-grid">
              <Label label="Destination tracking" id="convert-tracking">
                <select
                  id="convert-tracking"
                  value={trackingMode}
                  onChange={(event) =>
                    setTrackingMode(
                      event.target.value as "balance" | "positions",
                    )
                  }
                >
                  <option value="balance">Balance</option>
                  <option value="positions">Positions</option>
                </select>
              </Label>
              <Label label="Currency" id="convert-currency">
                <input
                  id="convert-currency"
                  value={currency}
                  maxLength={3}
                  onChange={(event) =>
                    setCurrency(event.target.value.toUpperCase())
                  }
                />
              </Label>
              <Label label="Session API key (optional)" id="convert-key">
                <input
                  id="convert-key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setAPIKey(event.target.value)}
                />
              </Label>
            </div>
            <label>
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />{" "}
              I reviewed and redacted the extracted text and consent to sending
              it to the configured provider.
            </label>
            <button
              className="primary-button compact"
              data-financial-mutation="true"
              disabled={busy || !consent}
              onClick={() => void convert()}
            >
              <Sparkles size={16} /> Convert to draft
            </button>
          </>
        ) : null}
      </div>
      {draft ? (
        <JsonResult title="Conversion draft (not committed)" value={draft} />
      ) : null}
    </Card>
  );
}

function JsonResult({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="snapshot-group">
      <h3>{title}</h3>
      <pre className="read-note">
        <code>{JSON.stringify(value, null, 2)}</code>
      </pre>
    </div>
  );
}
function Label({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}
