"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  EyeOff,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  Square,
} from "lucide-react";

import { usePrivacy } from "@/components/privacy-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Input, Label, Select } from "@/components/ui/form-controls";
import type {
  PortfolioAiReview,
  PortfolioReviewSnapshot,
} from "@/lib/ai/schemas";

type ProviderSettings = {
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
};

type UsageSummary = {
  billingMonth: string;
  chargedTokens: number;
  remainingTokens: number;
  monthlyTokenLimit: number;
  successfulReviews: number;
  lastUsedAt: string | null;
} | null;

type ReviewResult = {
  review: PortfolioAiReview;
  snapshot: PortfolioReviewSnapshot;
  provider: {
    name: "openai" | "deepseek" | "custom";
    host: string;
    model: string;
  };
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
  };
  generatedAt: string;
};

const focusOptions = [
  ["overall", "Overall"],
  ["allocation", "Allocation"],
  ["goals", "Goals"],
  ["cash-flow", "Cash flow"],
  ["data-quality", "Data quality"],
] as const;

function evidenceLabel(reference: string, snapshot: PortfolioReviewSnapshot) {
  if (reference === "portfolio.totals") return "Portfolio totals";
  if (reference === "portfolio.ratios") return "Portfolio ratios";
  if (reference === "portfolio.period-change") return "Period change";
  if (reference === "cash-flow.summary") return "Cash-flow summary";
  const item = [
    ...snapshot.allocations.categories,
    ...snapshot.allocations.currencies,
    ...snapshot.topAccounts,
    ...snapshot.goals,
    ...snapshot.dataQuality,
  ].find((candidate) => candidate.evidenceId === reference);
  if (!item) return reference;
  if ("label" in item) return `${item.label}: ${item.sharePercent}%`;
  if ("category" in item) {
    return `${item.name ?? item.alias}: ${item.sharePercent}%`;
  }
  if ("tracking" in item) {
    return `${item.name ?? item.alias}: ${item.progressPercent}% complete`;
  }
  return item.message;
}

function FindingGroup({
  title,
  findings,
  snapshot,
}: {
  title: string;
  findings: PortfolioAiReview["attentionItems"];
  snapshot: PortfolioReviewSnapshot;
}) {
  if (!findings.length) return null;
  return (
    <section
      aria-labelledby={`review-${title.toLowerCase().replaceAll(" ", "-")}`}
    >
      <h2
        id={`review-${title.toLowerCase().replaceAll(" ", "-")}`}
        className="mb-3 text-sm font-semibold text-slate-200"
      >
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

export function PortfolioReviewWorkspace({
  settings,
  usage,
}: {
  settings: ProviderSettings;
  usage: UsageSummary;
}) {
  const { hidden } = usePrivacy();
  const [period, setPeriod] = useState<"1m" | "3m" | "6m" | "1y" | "all">("1y");
  const [focus, setFocus] = useState<
    "overall" | "allocation" | "goals" | "cash-flow" | "data-quality"
  >("overall");
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
  const abortController = useRef<AbortController | null>(null);
  const hasCredential = settings.hasStoredApiKey || apiKey.trim().length >= 8;

  async function generateReview() {
    const controller = new AbortController();
    abortController.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/ai/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          period,
          focus,
          includeExactAmounts,
          includeAccountNames,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }),
      });
      const body = (await response.json()) as ReviewResult & { error?: string };
      if (!response.ok)
        throw new Error(body.error || "Review generation failed.");
      setResult(body);
      setApiKey("");
    } catch (caught) {
      if (controller.signal.aborted) {
        setError("Portfolio review generation was cancelled.");
      } else {
        setError(
          caught instanceof Error
            ? caught.message
            : "The portfolio review could not be generated.",
        );
      }
    } finally {
      abortController.current = null;
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
                    setPeriod(
                      event.target.value as "1m" | "3m" | "6m" | "1y" | "all",
                    )
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
                    setFocus(
                      event.target.value as
                        | "overall"
                        | "allocation"
                        | "goals"
                        | "cash-flow"
                        | "data-quality",
                    )
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
                    onClick={() => abortController.current?.abort()}
                  >
                    <Square size={15} /> Cancel
                  </Button>
                ) : null}
                <Button
                  type="button"
                  onClick={generateReview}
                  disabled={
                    busy || !hasCredential || usage?.remainingTokens === 0
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
              {usage ? (
                <p>
                  {usage.remainingTokens.toLocaleString()} of{" "}
                  {usage.monthlyTokenLimit.toLocaleString()} monthly tokens
                  remain.
                </p>
              ) : (
                <p>No AI usage has been recorded this month.</p>
              )}
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
            result.snapshot.portfolio.totals.netWorth ? (
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
      )}
    </div>
  );
}
