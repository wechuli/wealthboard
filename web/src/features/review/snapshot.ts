/**
 * Builds the bounded, versioned portfolio snapshot sent with an AI review request.
 *
 * Mirrors the legacy client's snapshot (same top-level keys, pseudonymous `Account N` / `Goal N`
 * aliases, `data-quality-N` rate warnings) with three deliberate tightenings:
 * - exact amounts (account values, allocation values, totals) are only included with consent;
 * - instrument allocation is never included (the spec excludes instrument identifiers);
 * - allocation entries carry evidence IDs so findings about concentration can cite them.
 * Every figure is copied from a server read model; nothing financial is calculated here.
 */
import type { Account, AIReviewFocus, AIReviewPeriod, AIReviewSnapshot, Dashboard, Goal, ReportAllocation } from '@/api/types'
import { compareMinor } from '@/lib/money'

export interface ReviewSharing {
  includeExactAmounts: boolean
  includeAccountNames: boolean
}

export interface ReviewReads {
  dashboard: Dashboard
  allocation: ReportAllocation
  goals: Goal[]
  accounts: Account[]
}

export const SNAPSHOT_MAX_BYTES = 25_000
const MAX_ACCOUNTS = 10
const MAX_GOALS = 20
const MAX_ALLOCATION_ROWS = 12

type AllocationRow = ReportAllocation['categories'][number]

function allocationRows(rows: AllocationRow[] | undefined, prefix: string, exact: boolean) {
  return (rows ?? []).slice(0, MAX_ALLOCATION_ROWS).map((row, i) => ({
    evidenceId: `${prefix}-${i + 1}`,
    label: row.name,
    sharePercent: row.sharePercent,
    valueMinor: exact ? row.valueMinor : undefined,
  }))
}

/** Largest first by base-currency value; accounts with a missing rate sort last. */
function byConvertedValue(a: Account, b: Account): number {
  if (a.convertedValueMinor === null) return b.convertedValueMinor === null ? 0 : 1
  if (b.convertedValueMinor === null) return -1
  return compareMinor(b.convertedValueMinor, a.convertedValueMinor)
}

export function buildReviewSnapshot(
  { period, focus, sharing, asOf = new Date().toISOString() }: { period: AIReviewPeriod; focus: AIReviewFocus; sharing: ReviewSharing; asOf?: string },
  { dashboard, allocation, goals, accounts }: ReviewReads,
): AIReviewSnapshot {
  const exact = sharing.includeExactAmounts
  const names = sharing.includeAccountNames
  const active = accounts.filter((a) => !a.archivedAt).sort(byConvertedValue)
  return {
    schemaVersion: 1,
    asOf,
    period,
    focus,
    baseCurrency: dashboard.baseCurrency,
    sharing: { exactAmounts: exact, includeExactAmounts: exact, includeAccountNames: names },
    completeness: {
      currentComplete: dashboard.currentComplete,
      historicalComplete: dashboard.historicalComplete,
      missingCurrencies: dashboard.missingCurrencies,
    },
    portfolio: exact
      ? { evidenceId: 'portfolio.totals', totals: dashboard.totals, accountCount: dashboard.accountCount, goalCount: dashboard.goalCount }
      : { evidenceId: 'portfolio.totals', accountCount: dashboard.accountCount, goalCount: dashboard.goalCount },
    // The generated type for this open object is `Record<string, never>`, hence the cast.
    allocations: {
      categories: allocationRows(allocation.categories, 'category', exact),
      currencies: allocationRows(allocation.currencies, 'currency', exact),
      ...(names ? { institutions: allocationRows(allocation.institutions, 'institution', exact) } : {}),
    } as unknown as AIReviewSnapshot['allocations'],
    topAccounts: active.slice(0, MAX_ACCOUNTS).map((account, i) => ({
      evidenceId: `account-${i + 1}`,
      alias: `Account ${i + 1}`,
      name: names ? account.name : undefined,
      category: account.categoryName,
      trackingMode: account.trackingMode,
      isLiability: account.isLiability,
      currency: account.currency,
      valueMinor: exact ? account.currentValueMinor : undefined,
      valueComplete: account.convertedValueMinor !== null,
    })),
    cashFlow: {},
    goals: goals.slice(0, MAX_GOALS).map((goal, i) => ({
      evidenceId: `goal-${i + 1}`,
      alias: `Goal ${i + 1}`,
      name: names ? goal.name : undefined,
      status: goal.status,
      tracking: goal.trackingStatus,
      progressPercent: goal.progressPercent,
      targetDate: goal.targetDate,
      valueIncomplete: goal.valueIncomplete,
      currency: exact ? goal.currency : undefined,
      targetMinor: exact ? goal.targetAmountMinor : undefined,
      currentMinor: exact ? goal.currentAmountMinor : undefined,
    })),
    dataQuality: dashboard.missingCurrencies.map((currency, i) => ({
      evidenceId: `data-quality-${i + 1}`,
      message: `Missing exchange rate for ${currency}`,
    })),
    methodology: {
      source: 'live portfolio data',
      valueBasis: dashboard.valueBasis,
      notes: 'Totals, shares, and goal progress are calculated by Wealthboard. Annualized returns and movement attribution are omitted.',
    },
  }
}

/** JSON byte length of the snapshot as the server measures it. */
export function snapshotBytes(snapshot: AIReviewSnapshot): number {
  return new TextEncoder().encode(JSON.stringify(snapshot)).length
}

// ---- evidence labels ----------------------------------------------------------------------------

type Evidence = Record<string, unknown> & { evidenceId: string }

/** Every object carrying an evidenceId, found the same way the server validates citations. */
export function evidenceIndex(snapshot: unknown): Map<string, Evidence> {
  const out = new Map<string, Evidence>()
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      if (typeof record.evidenceId === 'string') out.set(record.evidenceId, record as Evidence)
      Object.values(record).forEach(visit)
    }
  }
  visit(snapshot)
  return out
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

/** A human label for an evidence reference ("Fixed Income · 36.97%", "Goal 2 · 45.1% complete"). */
export function evidenceLabel(reference: string, index: Map<string, Evidence>): string {
  if (reference === 'portfolio.totals') return 'Portfolio totals'
  const item = index.get(reference)
  if (!item) return reference
  const label = str(item.label)
  if (label) return str(item.sharePercent) ? `${label} · ${String(item.sharePercent)}%` : label
  const who = str(item.name) ?? str(item.alias)
  if (who && str(item.progressPercent)) return `${who} · ${String(item.progressPercent)}% complete`
  if (who) return who
  return str(item.message) ?? reference
}
