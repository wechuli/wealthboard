import Decimal from "decimal.js";

export type ExchangeRateLike = {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  effectiveDate?: string;
};

export class MissingExchangeRateError extends Error {
  constructor(from: string, to: string) {
    super(`No exchange rate is configured for ${from}/${to}.`);
    this.name = "MissingExchangeRateError";
  }
}

export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function parseMoney(value: string, currency: string): number {
  const normalized = value.trim().replaceAll(",", "");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error("Enter a valid monetary amount.");
  }

  const digits = currencyDigits(currency);
  const decimal = new Decimal(normalized);
  const minor = decimal.mul(new Decimal(10).pow(digits));
  if (!minor.isInteger()) {
    throw new Error(`${currency.toUpperCase()} supports at most ${digits} decimal places.`);
  }
  if (minor.abs().greaterThan(Number.MAX_SAFE_INTEGER)) {
    throw new Error("The amount is outside the supported range.");
  }
  return minor.toNumber();
}

export function minorToDecimalString(amountMinor: number | bigint, currency: string): string {
  const digits = currencyDigits(currency);
  return new Decimal(amountMinor.toString())
    .div(new Decimal(10).pow(digits))
    .toFixed(digits);
}

export function formatMoney(
  amountMinor: number | bigint,
  currency: string,
  options: { compact?: boolean; sign?: boolean } = {},
): string {
  const digits = currencyDigits(currency);
  const amount = new Decimal(amountMinor.toString())
    .div(new Decimal(10).pow(digits))
    .toNumber();

  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: currency.toUpperCase(),
    currencyDisplay: "narrowSymbol",
    notation: options.compact ? "compact" : "standard",
    signDisplay: options.sign ? "exceptZero" : "auto",
    maximumFractionDigits: options.compact ? 1 : digits,
    minimumFractionDigits: options.compact ? 0 : digits,
  }).format(amount);
}

function latestRate(
  rates: ExchangeRateLike[],
  base: string,
  quote: string,
  asOf?: string,
) {
  return rates
    .filter(
      (rate) =>
        rate.baseCurrency === base &&
        rate.quoteCurrency === quote &&
        (!asOf || !rate.effectiveDate || rate.effectiveDate <= asOf),
    )
    .sort((a, b) => (b.effectiveDate ?? "").localeCompare(a.effectiveDate ?? ""))[0];
}

export function convertMinor(
  amountMinor: number | bigint,
  fromCurrency: string,
  toCurrency: string,
  rates: ExchangeRateLike[],
  asOf?: string,
): bigint {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  if (from === to) return BigInt(amountMinor);

  const direct = latestRate(rates, from, to, asOf);
  const inverse = latestRate(rates, to, from, asOf);
  if (!direct && !inverse) throw new MissingExchangeRateError(from, to);
  const useDirect =
    Boolean(direct) &&
    (!inverse ||
      (direct?.effectiveDate ?? "") >= (inverse.effectiveDate ?? ""));

  const sourceMajor = new Decimal(amountMinor.toString()).div(
    new Decimal(10).pow(currencyDigits(from)),
  );
  const targetMajor = useDirect
    ? sourceMajor.mul(direct!.rate)
    : sourceMajor.div(inverse!.rate);
  const targetMinor = targetMajor.mul(new Decimal(10).pow(currencyDigits(to)));
  return BigInt(targetMinor.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
}

export function percentage(part: number | bigint, whole: number | bigint): string {
  if (BigInt(whole) === 0n) return "0";
  return new Decimal(part.toString())
    .div(whole.toString())
    .mul(100)
    .toDecimalPlaces(1)
    .toString();
}

export function safeChartNumber(value: number | bigint): number {
  const decimal = new Decimal(value.toString());
  if (decimal.abs().greaterThan(Number.MAX_SAFE_INTEGER)) {
    return decimal.isNegative() ? -Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
  }
  return decimal.toNumber();
}
