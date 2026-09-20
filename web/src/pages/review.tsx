import {
  AlertTriangle,
  CheckCircle2,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  generateAIReview,
  getAccounts,
  getAI,
  getDashboard,
  getGoals,
  getReportAllocation,
} from "@/api/client";
import {
  Badge,
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
} from "@/components/ui/original";
import type { AIRead, Session } from "@/lib/types";
import { usePrivacy } from "@/components/providers/privacy-provider";
import { ErrorState, LoadingState } from "@/components/ui/resource";
import { useResource } from "@/hooks/use-resource";

type ReviewFinding = {
  id: string;
  severity: "info" | "attention" | "high";
  confidence: "low" | "medium" | "high";
  title: string;
  explanation: string;
  evidenceRefs: string[];
};

type ReviewSnapshot = {
  sharing: { exactAmounts?: boolean; includeExactAmounts?: boolean };
  portfolio: { totals?: { netWorth?: { currency: string; amount: string } } };
  allocations: {
    categories?: Array<{
      evidenceId: string;
      label: string;
      sharePercent: number;
    }>;
    currencies?: Array<{
      evidenceId: string;
      label: string;
      sharePercent: number;
    }>;
  };
  topAccounts: Array<{
    evidenceId?: string;
    name?: string;
    alias?: string;
    category?: string;
    sharePercent?: number;
  }>;
  goals: Array<{
    evidenceId?: string;
    name?: string;
    alias?: string;
    tracking?: string;
    progressPercent?: number;
  }>;
  dataQuality: Array<{ evidenceId?: string; message?: string }>;
};

type ReviewResult = {
  review: {
    headline: string;
    executiveSummary: string;
    dataQuality: ReviewFinding[];
    strengths: ReviewFinding[];
    attentionItems: ReviewFinding[];
    goalObservations: ReviewFinding[];
    questions: string[];
    possibleNextChecks: string[];
    limitations: string[];
  };
  snapshot: ReviewSnapshot;
  provider: { name: string; host: string; model: string };
  usage: { inputTokens: number | null; outputTokens: number | null };
  generatedAt: string;
};

type ReviewInput = {
  period: "1m" | "3m" | "6m" | "1y" | "all";
  focus: "overall" | "allocation" | "goals" | "cash-flow" | "data-quality";
  includeExactAmounts: boolean;
  includeAccountNames: boolean;
  apiKey?: string;
};

type ReviewOperations = {
  load: () => Promise<AIRead>;
  generate: (input: ReviewInput, csrfToken: string) => Promise<ReviewResult>;
};

const defaultOperations: ReviewOperations = {
  load: getAI,
  async generate(input, csrfToken) {
    const [dashboard, allocation, goals, accounts] = await Promise.all([
      getDashboard(),
      getReportAllocation(),
      getGoals(),
      getAccounts(),
    ]);
    const snapshot = {
      schemaVersion: 1 as const,
      asOf: new Date().toISOString(),
      period: input.period,
      focus: input.focus,
      baseCurrency: dashboard.baseCurrency,
      sharing: {
        exactAmounts: input.includeExactAmounts,
        includeExactAmounts: input.includeExactAmounts,
        includeAccountNames: input.includeAccountNames,
      },
      completeness: {
        currentComplete: dashboard.currentComplete,
        missingCurrencies: dashboard.missingCurrencies,
      },
      portfolio: input.includeExactAmounts
        ? { totals: dashboard.totals }
        : {
            accountCount: dashboard.accountCount,
            goalCount: dashboard.goalCount,
          },
      allocations: allocation,
      topAccounts: accounts.items.slice(0, 10).map((account, index) => ({
        evidenceId: `account-${index + 1}`,
        alias: `Account ${index + 1}`,
        name: input.includeAccountNames ? account.name : undefined,
        valueMinor: input.includeExactAmounts
          ? account.currentValueMinor
          : undefined,
        currency: account.currency,
      })),
      cashFlow: {},
      goals: goals.map((goal, index) => ({
        evidenceId: `goal-${index + 1}`,
        alias: `Goal ${index + 1}`,
        name: input.includeAccountNames ? goal.name : undefined,
        tracking: goal.status,
        progressPercent: goal.progressPercent,
      })),
      dataQuality: dashboard.missingCurrencies.map((currency, index) => ({
        evidenceId: `data-quality-${index + 1}`,
        message: `Missing exchange rate for ${currency}`,
      })),
      methodology: { source: "live portfolio data" },
    };
    return (await generateAIReview(
      { ...input, snapshot },
      csrfToken,
    )) as unknown as ReviewResult;
  },
};

const focusOptions = [
  ["overall", "Overall"],
  ["allocation", "Allocation"],
  ["goals", "Goals"],
  ["cash-flow", "Cash flow"],
  ["data-quality", "Data quality"],
] as const;

function evidenceLabel(reference: string, snapshot: ReviewSnapshot) {
  if (reference === "portfolio.totals") return "Portfolio totals";
  if (reference === "portfolio.ratios") return "Portfolio ratios";
  if (reference === "portfolio.period-change") return "Period change";
  if (reference === "cash-flow.summary") return "Cash-flow summary";
  const item = [
    ...(snapshot.allocations.categories ?? []),
    ...(snapshot.allocations.currencies ?? []),
    ...snapshot.topAccounts,
    ...snapshot.goals,
    ...snapshot.dataQuality,
  ].find((candidate) => candidate.evidenceId === reference);
  if (!item) return reference;
  if ("label" in item) return `${item.label}: ${item.sharePercent}%`;
  if ("category" in item)
    return `${item.name ?? item.alias}: ${item.sharePercent}%`;
  if ("tracking" in item)
    return `${item.name ?? item.alias}: ${item.progressPercent}% complete`;
  if ("message" in item) return item.message ?? reference;
  return reference;
}

function FindingGroup({
  title,
  findings,
  snapshot,
}: {
  title: string;
  findings: ReviewFinding[];
  snapshot: ReviewSnapshot;
}) {
  if (!findings.length) return null;
  const id = `review-${title.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-3 text-sm font-semibold text-slate-200">
        {title}
      </h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {findings.map((finding) => (
          <Card key={finding.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-slate-100">{finding.title}</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {finding.explanation}
                </p>
              </div>
              <Badge
                tone={
                  finding.severity === "high"
                    ? "negative"
                    : finding.severity === "attention"
                      ? "warning"
                      : "info"
                }
              >
                {finding.severity}
              </Badge>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {finding.evidenceRefs.map((reference) => (
                <span
                  key={reference}
                  title={reference}
                  className="rounded-lg bg-white/[0.05] px-2.5 py-1 text-xs text-slate-400"
                >
                  {evidenceLabel(reference, snapshot)}
                </span>
              ))}
              <span className="px-1 py-1 text-xs text-slate-600">
                {finding.confidence} confidence
              </span>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

export function OriginalPortfolioReviewPage({
  session,
  operations = defaultOperations,
}: {
  session: Session;
  operations?: ReviewOperations;
}) {
  const resource = useResource(operations.load, [operations]);
  if (resource.status === "loading")
    return <LoadingState label="Loading portfolio review..." />;
  if (resource.status === "error")
    return <ErrorState message={resource.message} />;
  return (
    <>
      <PageHeader
        title="Portfolio review"
        description="A provider-generated critique grounded in Wealthboard's deterministic portfolio snapshot."
        actions={
          <Link
            className={buttonClasses({ variant: "secondary" })}
            to="/settings"
          >
            <Settings size={16} /> Provider settings
          </Link>
        }
      />
      {resource.data.settings ? (
        <PortfolioReviewWorkspace
          ai={resource.data}
          session={session}
          generate={operations.generate}
        />
      ) : (
        <div className="border-y border-white/[0.06] py-16 text-center">
          <Sparkles className="mx-auto text-slate-600" size={30} />
          <h2 className="mt-4 text-lg font-semibold">
            Configure an AI provider
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">
            Choose OpenAI, DeepSeek, or a compatible endpoint configured for
            this Wealthboard instance before requesting a portfolio review.
          </p>
          <Link className={buttonClasses({ className: "mt-5" })} to="/settings">
            <Settings size={16} /> Open settings
          </Link>
        </div>
      )}
    </>
  );
}

export function PortfolioReviewWorkspace({
  ai,
  session,
  generate,
}: {
  ai: AIRead;
  session: Session;
  generate: ReviewOperations["generate"];
}) {
  const { hidden } = usePrivacy();
  const settings = ai.settings!;
  const [period, setPeriod] = useState<ReviewInput["period"]>("1y");
  const [focus, setFocus] = useState<ReviewInput["focus"]>("overall");
  const [includeExactAmounts, setIncludeExactAmounts] = useState(
    settings.includeExactAmounts,
  );
  const [includeAccountNames, setIncludeAccountNames] = useState(
    settings.includeAccountNames,
  );
  const [apiKey, setApiKey] = useState("");
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);
  const hasCredential = settings.hasStoredApiKey || apiKey.trim().length >= 8;

  async function generateReview() {
    cancelled.current = false;
    setBusy(true);
    setError("");
    try {
      const review = await generate(
        {
          period,
          focus,
          includeExactAmounts,
          includeAccountNames,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        },
        session.csrfToken,
      );
      if (!cancelled.current) {
        setResult(review);
        setApiKey("");
      }
    } catch (caught) {
      if (!cancelled.current)
        setError(
          caught instanceof Error
            ? caught.message
            : "The portfolio review could not be generated.",
        );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Review scope</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                {settings.provider} · {settings.model} ·{" "}
                {new URL(settings.baseUrl).host}
              </p>
            </div>
            <Badge tone="positive">On demand</Badge>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="reviewPeriod">Period</Label>
                <Select
                  id="reviewPeriod"
                  value={period}
                  onChange={(event) =>
                    setPeriod(event.target.value as ReviewInput["period"])
                  }
                >
                  <option value="1m">One month</option>
                  <option value="3m">Three months</option>
                  <option value="6m">Six months</option>
                  <option value="1y">One year</option>
                  <option value="all">All history</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="reviewFocus">Focus</Label>
                <Select
                  id="reviewFocus"
                  value={focus}
                  onChange={(event) =>
                    setFocus(event.target.value as ReviewInput["focus"])
                  }
                >
                  {focusOptions.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <fieldset className="rounded-xl border border-white/[0.06] p-4">
              <legend className="px-1 text-sm font-medium text-slate-300">
                Data sharing
              </legend>
              <Checkbox
                checked={includeExactAmounts}
                onChange={(event) =>
                  setIncludeExactAmounts(event.target.checked)
                }
                label="Include exact aggregate amounts"
              />
              <Checkbox
                checked={includeAccountNames}
                onChange={(event) =>
                  setIncludeAccountNames(event.target.checked)
                }
                label="Include account and goal names"
              />
            </fieldset>
            <div>
              <Label htmlFor="sessionAiKey">
                Session-only API key
                {settings.hasStoredApiKey ? " (optional override)" : ""}
              </Label>
              <Input
                id="sessionAiKey"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="new-password"
                placeholder={
                  settings.hasStoredApiKey
                    ? `Using encrypted key ${settings.apiKeyHint ?? ""}`
                    : "Required for this request"
                }
              />
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
                <KeyRound size={13} /> This field is cleared after a successful
                review.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
              <p role="status" className="text-sm text-red-300">
                {error}
              </p>
              <div className="flex gap-2">
                {busy ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      cancelled.current = true;
                      setBusy(false);
                      setError("Portfolio review generation was cancelled.");
                    }}
                  >
                    <Square size={15} /> Cancel
                  </Button>
                ) : null}
                <Button
                  type="button"
                  onClick={() => void generateReview()}
                  disabled={
                    busy || !hasCredential || ai.usage.remainingTokens === 0
                  }
                >
                  {busy ? (
                    <LoaderCircle className="animate-spin" size={17} />
                  ) : (
                    <Sparkles size={17} />
                  )}
                  Generate review
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Data sent to the provider</CardTitle>
            <ShieldCheck className="text-emerald-300" size={18} />
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm text-slate-400">
              {[
                "Portfolio and cash-flow ratios",
                "Category and currency concentration",
                "Pseudonymous account concentration",
                "Goal trajectory and contribution ratios",
                "Missing-rate and methodology warnings",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <CheckCircle2
                    className="mt-0.5 shrink-0 text-emerald-400"
                    size={15}
                  />
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-5 rounded-xl border border-amber-400/15 bg-amber-400/[0.04] p-3 text-xs leading-5 text-amber-100/80">
              Notes, account references, transaction descriptions, raw activity,
              and unreliable annualized returns are excluded.
            </div>
            <div className="mt-5 border-t border-white/[0.06] pt-4 text-xs text-slate-500">
              <p>
                {ai.usage.remainingTokens.toLocaleString()} of{" "}
                {ai.usage.monthlyTokenLimit.toLocaleString()} monthly tokens
                remain.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
      {!result ? (
        <div className="border-y border-white/[0.06] py-14 text-center">
          <Sparkles className="mx-auto text-slate-600" size={28} />
          <h2 className="mt-4 text-base font-semibold text-slate-200">
            No review generated in this session
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Generated reviews are not saved and disappear when this page
            reloads.
          </p>
        </div>
      ) : hidden ? (
        <Card className="border-amber-400/15">
          <CardContent className="flex min-h-48 flex-col items-center justify-center text-center">
            <EyeOff className="text-amber-300" size={25} />
            <h2 className="mt-3 font-semibold text-slate-200">Review hidden</h2>
            <p className="mt-2 max-w-md text-sm text-slate-500">
              Privacy mode removes generated review text from this page because
              it may repeat financial values.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ReviewResultView result={result} />
      )}
    </div>
  );
}

function ReviewResultView({ result }: { result: ReviewResult }) {
  return (
    <div className="space-y-6" aria-live="polite">
      <section className="border-y border-emerald-400/15 py-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-4xl">
            <p className="text-xs uppercase tracking-wide text-emerald-300">
              AI portfolio review
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-white">
              {result.review.headline}
            </h1>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              {result.review.executiveSummary}
            </p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <p>{result.provider.model}</p>
            <p className="mt-1">{result.provider.host}</p>
          </div>
        </div>
        {result.snapshot.sharing.exactAmounts &&
        result.snapshot.portfolio.totals?.netWorth ? (
          <div className="mt-5 text-sm text-slate-400">
            Snapshot net worth:{" "}
            {result.snapshot.portfolio.totals.netWorth.currency}{" "}
            {result.snapshot.portfolio.totals.netWorth.amount}
          </div>
        ) : null}
      </section>
      <FindingGroup
        title="Data quality"
        findings={result.review.dataQuality}
        snapshot={result.snapshot}
      />
      <FindingGroup
        title="Strengths"
        findings={result.review.strengths}
        snapshot={result.snapshot}
      />
      <FindingGroup
        title="Attention items"
        findings={result.review.attentionItems}
        snapshot={result.snapshot}
      />
      <FindingGroup
        title="Goal observations"
        findings={result.review.goalObservations}
        snapshot={result.snapshot}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Questions to consider</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm leading-6 text-slate-400">
              {result.review.questions.map((question, index) => (
                <li key={question} className="flex gap-3">
                  <span className="text-slate-600">{index + 1}.</span>
                  {question}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Possible next checks</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm leading-6 text-slate-400">
              {result.review.possibleNextChecks.map((item) => (
                <li key={item} className="flex gap-2">
                  <AlertTriangle
                    className="mt-1 shrink-0 text-amber-300"
                    size={14}
                  />
                  {item}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
      <section className="border-t border-white/[0.06] pt-5 text-xs leading-5 text-slate-500">
        <p className="font-medium text-slate-400">Limitations</p>
        <ul className="mt-2 space-y-1">
          {result.review.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
        <p className="mt-3">
          This output is explanatory and is not regulated financial advice.
        </p>
      </section>
    </div>
  );
}
