export type CurrencyDefinition = {
  code: string;
  name: string;
  region: "Regional" | "Africa" | "Global" | "Middle East" | "Asia Pacific";
};

export const CURRENCY_CATALOG = [
  { code: "KES", name: "Kenyan Shilling", region: "Regional" },
  { code: "TZS", name: "Tanzanian Shilling", region: "Regional" },
  { code: "UGX", name: "Ugandan Shilling", region: "Regional" },
  { code: "RWF", name: "Rwandan Franc", region: "Regional" },
  { code: "BIF", name: "Burundian Franc", region: "Regional" },
  { code: "ETB", name: "Ethiopian Birr", region: "Regional" },
  { code: "SSP", name: "South Sudanese Pound", region: "Regional" },
  { code: "CDF", name: "Congolese Franc", region: "Regional" },
  { code: "SOS", name: "Somali Shilling", region: "Regional" },
  { code: "ZAR", name: "South African Rand", region: "Africa" },
  { code: "NGN", name: "Nigerian Naira", region: "Africa" },
  { code: "GHS", name: "Ghanaian Cedi", region: "Africa" },
  { code: "USD", name: "US Dollar", region: "Global" },
  { code: "EUR", name: "Euro", region: "Global" },
  { code: "GBP", name: "British Pound", region: "Global" },
  { code: "CAD", name: "Canadian Dollar", region: "Global" },
  { code: "CHF", name: "Swiss Franc", region: "Global" },
  { code: "AED", name: "UAE Dirham", region: "Middle East" },
  { code: "SAR", name: "Saudi Riyal", region: "Middle East" },
  { code: "QAR", name: "Qatari Riyal", region: "Middle East" },
  { code: "KWD", name: "Kuwaiti Dinar", region: "Middle East" },
  { code: "BHD", name: "Bahraini Dinar", region: "Middle East" },
  { code: "OMR", name: "Omani Rial", region: "Middle East" },
  { code: "AUD", name: "Australian Dollar", region: "Asia Pacific" },
  { code: "NZD", name: "New Zealand Dollar", region: "Asia Pacific" },
  { code: "JPY", name: "Japanese Yen", region: "Asia Pacific" },
  { code: "CNY", name: "Chinese Yuan", region: "Asia Pacific" },
  { code: "INR", name: "Indian Rupee", region: "Asia Pacific" },
  { code: "SGD", name: "Singapore Dollar", region: "Asia Pacific" },
  { code: "HKD", name: "Hong Kong Dollar", region: "Asia Pacific" },
] as const satisfies readonly CurrencyDefinition[];

export type CatalogCurrencyCode = (typeof CURRENCY_CATALOG)[number]["code"];

export const DEFAULT_BASE_CURRENCY: CatalogCurrencyCode = "KES";
export const DEFAULT_ENABLED_CURRENCIES = ["KES", "USD", "TZS", "UGX"] as const;

const catalogByCode = new Map<string, CurrencyDefinition>(
  CURRENCY_CATALOG.map((currency) => [currency.code, currency]),
);

const isoCurrencyCodes = new Set<string>(
  typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("currency")
    : CURRENCY_CATALOG.map((currency) => currency.code),
);

export function normalizeCurrencyCode(value: string) {
  return value.trim().toUpperCase();
}

export function isIsoCurrencyCode(value: string) {
  const code = normalizeCurrencyCode(value);
  return /^[A-Z]{3}$/.test(code) && isoCurrencyCodes.has(code);
}

export function isCatalogCurrencyCode(
  value: string,
): value is CatalogCurrencyCode {
  return catalogByCode.has(normalizeCurrencyCode(value));
}

export function currencyLabel(code: string) {
  const normalized = normalizeCurrencyCode(code);
  const currency = catalogByCode.get(normalized);
  return currency ? `${currency.code} - ${currency.name}` : normalized;
}

export function parseEnabledCurrencies(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return normalizeEnabledCurrencies(
      parsed.filter(
        (currency): currency is string => typeof currency === "string",
      ),
    );
  } catch {
    return [];
  }
}

export function normalizeEnabledCurrencies(
  values: readonly string[],
  required: readonly string[] = [],
) {
  const normalized = [...values, ...required]
    .map(normalizeCurrencyCode)
    .filter(isIsoCurrencyCode);
  return [...new Set(normalized)];
}

export function currencyOptions(enabled: readonly string[] = []) {
  const legacy = normalizeEnabledCurrencies(enabled)
    .filter((code) => !catalogByCode.has(code))
    .map(
      (code): CurrencyDefinition => ({
        code,
        name: "Previously configured currency",
        region: "Global",
      }),
    );
  return [...CURRENCY_CATALOG, ...legacy];
}
