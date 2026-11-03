/** Pure list helpers for the accounts screens: joining, data state, grouping, and sorting. */
import type { AccountSummaryExt } from '@/api/extensions'
import type { Account, Category } from '@/api/types'
import { compareMinor } from '@/lib/money'

export type GroupBy = 'category' | 'institution' | 'currency' | 'kind' | 'mode' | 'state'
export type SortBy = 'value' | 'name' | 'category' | 'change' | 'updated'
export type ViewMode = 'cards' | 'table'
export type ShowMode = 'active' | 'archived'
export type DataState = 'complete' | 'stale' | 'incomplete'

export const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'category', label: 'Category' },
  { value: 'institution', label: 'Institution' },
  { value: 'currency', label: 'Currency' },
  { value: 'kind', label: 'Own or owe' },
  { value: 'mode', label: 'Tracking mode' },
  { value: 'state', label: 'Data state' },
]

export const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'value', label: 'Value' },
  { value: 'name', label: 'Name' },
  { value: 'category', label: 'Category' },
  { value: 'change', label: 'Change this month' },
  { value: 'updated', label: 'Last updated' },
]

export function parseParam<T extends string>(value: string | null, allowed: readonly { value: T }[] | readonly T[], fallback: T): T {
  const values = (allowed as readonly (T | { value: T })[]).map((a) => (typeof a === 'string' ? a : a.value))
  return value && (values as string[]).includes(value) ? (value as T) : fallback
}

export interface AccountItem {
  account: Account
  summary?: AccountSummaryExt
  category?: Category
}

export function joinAccounts(accounts: Account[], summaries: AccountSummaryExt[] | undefined, categories: Category[] | undefined): AccountItem[] {
  const byId = new Map((summaries ?? []).map((s) => [s.accountId, s]))
  const cats = new Map((categories ?? []).map((c) => [c.id, c]))
  return accounts.map((account) => ({ account, summary: byId.get(account.id), category: cats.get(account.categoryId) }))
}

export const isPositions = (a: Pick<Account, 'trackingMode'>) => a.trackingMode === 'positions'

/** Incomplete beats stale: a missing rate or price affects totals, a stale price only needs a refresh. */
export function dataState(item: AccountItem): DataState {
  const { account, summary } = item
  if (account.convertedValueMinor === null || summary?.valueComplete === false || summary?.freshness === 'missing') return 'incomplete'
  if (summary?.freshness === 'stale') return 'stale'
  return 'complete'
}

export const DATA_STATE_LABEL: Record<DataState, string> = {
  incomplete: 'Incomplete',
  stale: 'Stale prices',
  complete: 'Complete',
}

/**
 * Why an account has no base-currency value. A missing exchange rate needs a rate; a missing price needs a
 * price (and is never described as a rate, even for base-currency accounts).
 */
export type MissingValueReason = { kind: 'rate'; currency: string } | { kind: 'price' } | { kind: 'unknown' }

export function missingValueReason(account: Pick<Account, 'currency' | 'convertedValueMinor'>, summary: Pick<AccountSummaryExt, 'missingCurrencies' | 'missingPrices'> | undefined, baseCurrency: string): MissingValueReason | null {
  if (account.convertedValueMinor !== null) return null
  const missingRate = summary?.missingCurrencies.find((c) => c !== baseCurrency)
  if (summary?.missingCurrencies.includes(account.currency) && account.currency !== baseCurrency) return { kind: 'rate', currency: account.currency }
  if (missingRate) return { kind: 'rate', currency: missingRate }
  if (summary && summary.missingPrices.length > 0) return { kind: 'price' }
  if (account.currency !== baseCurrency) return { kind: 'rate', currency: account.currency }
  return { kind: 'unknown' }
}

export function rateFixHref(currency: string, baseCurrency: string): string {
  return `/settings/currencies?add=${encodeURIComponent(`${currency}-${baseCurrency}`)}`
}

export function priceFixHref(instrumentId: string): string {
  return `/instruments/${instrumentId}?addPrice=1`
}

export function modeLabel(account: Pick<Account, 'trackingMode'>, positionCount?: number | null): string {
  if (!isPositions(account)) return 'Value-tracked'
  if (positionCount === null || positionCount === undefined) return 'Position-tracked'
  return `${positionCount} ${positionCount === 1 ? 'position' : 'positions'}`
}

export interface AccountGroup {
  key: string
  label: string
  description?: string
  icon?: string
  /** Every account in the group is a liability (drives the "What you owe" treatment). */
  owed: boolean
  items: AccountItem[]
}

const byNullableMinorDesc = (a: string | null, b: string | null) => {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return compareMinor(b, a)
}

export function sortItems(items: AccountItem[], sort: SortBy): AccountItem[] {
  const byName = (x: AccountItem, y: AccountItem) => x.account.name.localeCompare(y.account.name)
  const out = [...items]
  out.sort((x, y) => {
    switch (sort) {
      case 'name':
        return byName(x, y)
      case 'category':
        return (x.category?.displayOrder ?? 999) - (y.category?.displayOrder ?? 999) || x.account.categoryName.localeCompare(y.account.categoryName) || byName(x, y)
      case 'change':
        // Ordering only: compares the server's native monthly changes; null (not enough history) sorts last.
        return byNullableMinorDesc(x.account.monthlyChangeMinor, y.account.monthlyChangeMinor) || byName(x, y)
      case 'updated': {
        const a = x.summary?.lastUpdatedAt ?? ''
        const b = y.summary?.lastUpdatedAt ?? ''
        return a === b ? byName(x, y) : a < b ? 1 : -1
      }
      case 'value':
      default:
        return byNullableMinorDesc(x.account.convertedValueMinor, y.account.convertedValueMinor) || byName(x, y)
    }
  })
  return out
}

/** Groups and orders accounts. Never sums money: group headers show names and counts only. */
export function groupItems(items: AccountItem[], group: GroupBy, ctx: { baseCurrency: string }): AccountGroup[] {
  const map = new Map<string, AccountGroup & { order: number | string }>()
  const put = (key: string, order: number | string, init: Omit<AccountGroup, 'items' | 'key' | 'owed'>, item: AccountItem) => {
    let g = map.get(key)
    if (!g) {
      g = { key, order, owed: true, items: [], ...init }
      map.set(key, g)
    }
    g.items.push(item)
    if (!item.account.isLiability) g.owed = false
  }
  for (const item of items) {
    const a = item.account
    switch (group) {
      case 'category': {
        const c = item.category
        put(`c:${a.categoryId}`, c?.displayOrder ?? 999, { label: c?.name ?? a.categoryName, icon: c?.icon, description: a.isLiability ? 'What you owe. These balances reduce your net worth.' : undefined }, item)
        break
      }
      case 'institution':
        put(`i:${a.institutionId ?? 'none'}`, a.institutionName ? a.institutionName.toLowerCase() : '~', { label: a.institutionName ?? 'No institution' }, item)
        break
      case 'currency':
        put(`ccy:${a.currency}`, a.currency === ctx.baseCurrency ? '' : a.currency, { label: a.currency, description: a.currency === ctx.baseCurrency ? 'Your base currency' : undefined }, item)
        break
      case 'kind':
        put(
          a.isLiability ? 'owe' : 'own',
          a.isLiability ? 1 : 0,
          a.isLiability ? { label: 'What you owe', description: 'Loans and credit. These balances reduce your net worth.' } : { label: 'What you own', description: 'Assets that add to your net worth.' },
          item,
        )
        break
      case 'mode':
        put(
          a.trackingMode,
          isPositions(a) ? 1 : 0,
          isPositions(a)
            ? { label: 'Position-tracked', description: 'Cash plus holdings, valued from unit prices.' }
            : { label: 'Value-tracked', description: 'One running value, moved by transactions and valuations.' },
          item,
        )
        break
      case 'state': {
        const s = dataState(item)
        const meta: Record<DataState, { order: number; description: string }> = {
          incomplete: { order: 0, description: 'A missing exchange rate or price keeps these values from being complete.' },
          stale: { order: 1, description: 'Prices are older than your freshness threshold.' },
          complete: { order: 2, description: 'Values are complete and up to date.' },
        }
        put(s, meta[s].order, { label: DATA_STATE_LABEL[s], description: meta[s].description }, item)
        break
      }
    }
  }
  return [...map.values()]
    .sort((a, b) => (typeof a.order === 'number' && typeof b.order === 'number' ? a.order - b.order : String(a.order).localeCompare(String(b.order))))
    .map(({ order: _order, ...g }) => g)
}

/** Human labels for transaction, valuation, position, and price activity types. */
export const ACTIVITY_LABELS: Record<string, string> = {
  opening_balance: 'Opening balance',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  interest: 'Interest',
  dividend: 'Dividend',
  capital_gain: 'Capital gain',
  capital_loss: 'Capital loss',
  fee: 'Fee',
  purchase: 'Purchase',
  sale: 'Sale',
  manual_adjustment: 'Adjustment',
  liability_payment: 'Payment',
  liability_increase: 'Balance increase',
  transfer: 'Transfer',
  valuation: 'Value updated',
  price_update: 'Price updated',
  opening_position: 'Opening position',
  buy: 'Buy',
  sell: 'Sell',
  quantity_adjustment: 'Quantity adjustment',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  split: 'Stock split',
  spinoff: 'Spin-off',
  merger_in: 'Merger in',
  merger_out: 'Merger out',
}

export function activityLabel(type: string): string {
  return ACTIVITY_LABELS[type] ?? type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}
