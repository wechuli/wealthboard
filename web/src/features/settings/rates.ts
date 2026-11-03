import type { ExchangeRate } from '@/api/types'
import { daysBetween } from '@/lib/dates'

/** A currency pair with its rates (either direction), newest first. */
export interface RatePair {
  key: string
  a: string
  b: string
  latest: ExchangeRate
  history: ExchangeRate[]
}

/** Rates are effective-dated calendar days; the API serialises them as midnight UTC timestamps. */
export function rateDate(rate: Pick<ExchangeRate, 'effectiveDate'>): string {
  return rate.effectiveDate.slice(0, 10)
}

export function pairKey(x: string, y: string): string {
  return [x, y].sort().join('/')
}

/** Groups rates by unordered pair (USD/KES and KES/USD are the same pair). */
export function groupRatePairs(rates: readonly ExchangeRate[]): RatePair[] {
  const map = new Map<string, ExchangeRate[]>()
  for (const r of rates) {
    const key = pairKey(r.baseCurrency, r.quoteCurrency)
    const list = map.get(key)
    if (list) list.push(r)
    else map.set(key, [r])
  }
  const pairs: RatePair[] = []
  for (const [key, list] of map) {
    const history = [...list].sort((x, y) => (x.effectiveDate === y.effectiveDate ? (x.createdAt < y.createdAt ? 1 : -1) : x.effectiveDate < y.effectiveDate ? 1 : -1))
    const [a = '', b = ''] = key.split('/')
    pairs.push({ key, a, b, latest: history[0]!, history })
  }
  return pairs.sort((x, y) => x.key.localeCompare(y.key))
}

export const RATE_CURRENT_DAYS = 31

/** Exchange rates older than a month warn but still count toward totals. */
export function rateAgeDays(rate: ExchangeRate, today: string): number {
  return Math.max(0, daysBetween(rateDate(rate), today))
}

/** Parses "USD-KES" from the ?add= deep link. */
export function parsePairParam(value: string | null): { base: string; quote: string } | null {
  const m = value?.toUpperCase().match(/^([A-Z]{3})-([A-Z]{3})$/)
  if (!m || m[1] === m[2]) return null
  return { base: m[1]!, quote: m[2]! }
}
