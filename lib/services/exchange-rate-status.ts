import "server-only";

import { isExchangeRateStale } from "@/lib/dates";
import { selectExchangeRate, type ExchangeRateLike } from "@/lib/money";

export type ExchangeRateGap = {
  baseCurrency: string;
  quoteCurrency: string;
  affectedFrom: string;
  affectedTo: string;
};

export type CurrentExchangeRateIssue = {
  baseCurrency: string;
  quoteCurrency: string;
  status: "missing" | "stale";
  rate?: string;
  effectiveDate?: string;
};

export function exchangeRatePairKey(base: string, quote: string) {
  return [base, quote].sort().join("/");
}

export function recordExchangeRateGap(
  gaps: Map<string, ExchangeRateGap>,
  baseCurrency: string,
  quoteCurrency: string,
  affectedFrom: string,
  affectedTo = affectedFrom,
) {
  const key = exchangeRatePairKey(baseCurrency, quoteCurrency);
  const previous = gaps.get(key);
  gaps.set(key, {
    baseCurrency: previous?.baseCurrency ?? baseCurrency,
    quoteCurrency: previous?.quoteCurrency ?? quoteCurrency,
    affectedFrom:
      previous && previous.affectedFrom < affectedFrom
        ? previous.affectedFrom
        : affectedFrom,
    affectedTo:
      previous && previous.affectedTo > affectedTo
        ? previous.affectedTo
        : affectedTo,
  });
}

export function currentExchangeRateIssue(
  baseCurrency: string,
  quoteCurrency: string,
  rates: ExchangeRateLike[],
  asOf: string,
): CurrentExchangeRateIssue | null {
  if (baseCurrency === quoteCurrency) return null;
  const selected = selectExchangeRate(baseCurrency, quoteCurrency, rates, asOf);
  if (!selected) return { baseCurrency, quoteCurrency, status: "missing" };
  if (
    selected.rate.effectiveDate &&
    isExchangeRateStale(selected.rate.effectiveDate, asOf)
  ) {
    return {
      baseCurrency: selected.rate.baseCurrency,
      quoteCurrency: selected.rate.quoteCurrency,
      rate: selected.rate.rate,
      effectiveDate: selected.rate.effectiveDate,
      status: "stale",
    };
  }
  return null;
}
