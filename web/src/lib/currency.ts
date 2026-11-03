export interface CurrencyInfo {
  code: string
  name: string
  region: 'east-africa' | 'international'
}

export const CURRENCIES: readonly CurrencyInfo[] = [
  { code: 'KES', name: 'Kenyan shilling', region: 'east-africa' },
  { code: 'TZS', name: 'Tanzanian shilling', region: 'east-africa' },
  { code: 'UGX', name: 'Ugandan shilling', region: 'east-africa' },
  { code: 'RWF', name: 'Rwandan franc', region: 'east-africa' },
  { code: 'BIF', name: 'Burundian franc', region: 'east-africa' },
  { code: 'ETB', name: 'Ethiopian birr', region: 'east-africa' },
  { code: 'SSP', name: 'South Sudanese pound', region: 'east-africa' },
  { code: 'CDF', name: 'Congolese franc', region: 'east-africa' },
  { code: 'SOS', name: 'Somali shilling', region: 'east-africa' },
  { code: 'USD', name: 'US dollar', region: 'international' },
  { code: 'EUR', name: 'Euro', region: 'international' },
  { code: 'GBP', name: 'British pound', region: 'international' },
  { code: 'CHF', name: 'Swiss franc', region: 'international' },
  { code: 'JPY', name: 'Japanese yen', region: 'international' },
  { code: 'CNY', name: 'Chinese yuan', region: 'international' },
  { code: 'INR', name: 'Indian rupee', region: 'international' },
  { code: 'AED', name: 'UAE dirham', region: 'international' },
  { code: 'SAR', name: 'Saudi riyal', region: 'international' },
  { code: 'ZAR', name: 'South African rand', region: 'international' },
  { code: 'NGN', name: 'Nigerian naira', region: 'international' },
  { code: 'GHS', name: 'Ghanaian cedi', region: 'international' },
  { code: 'CAD', name: 'Canadian dollar', region: 'international' },
  { code: 'AUD', name: 'Australian dollar', region: 'international' },
  { code: 'NZD', name: 'New Zealand dollar', region: 'international' },
  { code: 'HKD', name: 'Hong Kong dollar', region: 'international' },
  { code: 'SGD', name: 'Singapore dollar', region: 'international' },
  { code: 'KWD', name: 'Kuwaiti dinar', region: 'international' },
  { code: 'BHD', name: 'Bahraini dinar', region: 'international' },
  { code: 'OMR', name: 'Omani rial', region: 'international' },
  { code: 'QAR', name: 'Qatari riyal', region: 'international' },
]

/**
 * Codes in catalog order, followed by any the catalog does not list (sorted). The server's
 * currency list can be wider than this one, and a known-but-unlisted currency must never be
 * dropped from a saved setting.
 */
export function orderCurrencyCodes(codes: Iterable<string>): string[] {
  const wanted = new Set(codes)
  const listed = CURRENCIES.map((c) => c.code).filter((c) => wanted.delete(c))
  return [...listed, ...[...wanted].sort()]
}

export function currencyName(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.name ?? code
}

export const DEFAULT_BASE_CURRENCY = 'KES'
