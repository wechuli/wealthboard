import Link from "next/link";

import { SensitiveValue } from "@/components/privacy-provider";
import { formatDate } from "@/lib/dates";
import type {
  CurrentExchangeRateIssue,
  ExchangeRateGap,
} from "@/lib/services/exchange-rate-status";

function rateLink(
  baseCurrency: string,
  quoteCurrency: string,
  effectiveDate?: string,
) {
  const query = new URLSearchParams({
    rateBase: baseCurrency,
    rateQuote: quoteCurrency,
  });
  if (effectiveDate) query.set("rateDate", effectiveDate.slice(0, 10));
  return `/settings?${query}#exchange-rates`;
}

type DatePreferences = { timezone: string; dateFormat: string };

export function CurrentExchangeRateWarnings({
  issues,
  timezone,
  dateFormat,
}: DatePreferences & {
  issues: CurrentExchangeRateIssue[];
}) {
  if (!issues.length) return null;
  return (
    <div
      className="mb-5 space-y-2 border-l-2 border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200"
      role="status"
    >
      {issues.map((issue) => {
        const pair = `${issue.baseCurrency}/${issue.quoteCurrency}`;
        return (
          <p key={pair}>
            {issue.status === "missing" ? (
              <>
                <strong>Current total is incomplete.</strong> Add a {pair} rate
                to include holdings that require this conversion.{" "}
              </>
            ) : (
              <>
                <strong>{pair} rate is over a month old.</strong> Current
                balances still use <SensitiveValue>{issue.rate}</SensitiveValue>{" "}
                from {formatDate(issue.effectiveDate!, timezone, dateFormat)}
                .{" "}
              </>
            )}
            <Link
              className="underline underline-offset-2"
              href={rateLink(issue.baseCurrency, issue.quoteCurrency)}
            >
              {issue.status === "missing"
                ? `Add ${pair} rate`
                : `Update ${pair}`}
            </Link>
          </p>
        );
      })}
    </div>
  );
}

export function HistoricalExchangeRateWarnings({
  gaps,
  currentComplete,
  timezone,
  dateFormat,
}: DatePreferences & {
  gaps: ExchangeRateGap[];
  currentComplete: boolean;
}) {
  if (!gaps.length) return null;
  return (
    <div
      className="mb-4 border-l-2 border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200"
      role="status"
    >
      <p>
        <strong>Some historical totals are incomplete.</strong>
        {currentComplete
          ? " Your current total is complete."
          : " Your current total also has missing data."}
      </p>
      <ul className="mt-2 space-y-2">
        {gaps.map((gap) => {
          const pair = `${gap.baseCurrency}/${gap.quoteCurrency}`;
          return (
            <li key={pair}>
              {pair} rates are missing for calculations from{" "}
              {formatDate(gap.affectedFrom, timezone, dateFormat)} to{" "}
              {formatDate(gap.affectedTo, timezone, dateFormat)}. Affected
              historical holdings and activity are excluded.{" "}
              <Link
                className="underline underline-offset-2"
                href={rateLink(
                  gap.baseCurrency,
                  gap.quoteCurrency,
                  gap.affectedFrom,
                )}
              >
                Add earlier {pair} rate
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
