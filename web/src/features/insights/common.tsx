/**
 * Helpers shared by Home and the Insights pages. Everything here formats or arranges server-provided
 * values; nothing computes a financial result.
 */
import { ArrowRight, Plus, Sprout } from 'lucide-react'
import { useCallback, useSyncExternalStore, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { FlowsReport } from '@/api/extensions'
import type { DashboardRange } from '@/api/types'
import { BridgeChart, type BridgeStep } from '@/components/charts/BridgeChart'
import { ChartEmpty, ChartFrame } from '@/components/charts/ChartFrame'
import { DateText, Money } from '@/components/format'
import { Button, buttonClass } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Notice } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { format } from 'date-fns'
import { formatMonthTick, parseDateOnly } from '@/lib/dates'
import { formatMoney, maskedMoney, minorSign, toChartNumber } from '@/lib/money'
import { usePrivacy } from '@/lib/privacy'
import { usePrefs } from '@/lib/prefs'
import { useAttention } from '@/lib/queries'

// ---- layout + media ---------------------------------------------------------------

/** Subscribes to a CSS media query (SSR-safe, no effects). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', cb)
      return () => mql.removeEventListener('change', cb)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  )
}

export const useIsMdUp = () => useMediaQuery('(min-width: 768px)')
export const useIsLgUp = () => useMediaQuery('(min-width: 1024px)')

/** A section heading inside a page (h2), with optional supporting line and trailing controls. */
export function SectionTitle({ title, description, action, id, level = 2, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; id?: string; level?: 2 | 3; className?: string }) {
  const H = level === 2 ? 'h2' : 'h3'
  return (
    <div className={cn('mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2', className)}>
      <div className="min-w-0">
        <H id={id} className={cn(level === 2 ? 'display text-lg text-ink' : 'text-md font-semibold text-ink')}>
          {title}
        </H>
        {description ? <p className="mt-0.5 max-w-[70ch] text-sm text-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  )
}

// ---- ranges -----------------------------------------------------------------------

export const RANGE_OPTIONS: { value: DashboardRange; label: string; ariaLabel: string }[] = [
  { value: '1m', label: '1M', ariaLabel: 'One month' },
  { value: '3m', label: '3M', ariaLabel: 'Three months' },
  { value: '6m', label: '6M', ariaLabel: 'Six months' },
  { value: '1y', label: '1Y', ariaLabel: 'One year' },
  { value: 'all', label: 'All', ariaLabel: 'All time' },
]

const RANGES = new Set<string>(RANGE_OPTIONS.map((o) => o.value))

export function rangePhrase(range: DashboardRange): string {
  return { '1m': 'the past month', '3m': 'the past 3 months', '6m': 'the past 6 months', '1y': 'the past year', all: 'all time' }[range] ?? 'this period'
}

/** A search-param backed choice with a default and validation. */
export function useParamChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (value: T) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get(key)
  const value = raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
  const set = useCallback(
    (next: T) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          p.set(key, next)
          return p
        },
        { replace: true },
      ),
    [key, setParams],
  )
  return [value, set]
}

/** `?range=` with the user's default home period as fallback. */
export function useRangeParam(): [DashboardRange, (r: DashboardRange) => void] {
  const { defaultRange } = usePrefs()
  const fallback = RANGES.has(defaultRange) ? defaultRange : '1y'
  return useParamChoice<DashboardRange>('range', ['1m', '3m', '6m', '1y', 'all'], fallback)
}

// ---- money display helpers (string-only, no arithmetic) ------------------------------

/** Flips the sign of a minor-unit string for display (for example, a withdrawal shown as an outflow). */
export function negateMinor(minor: string): string {
  if (minorSign(minor) === 0) return minor.replace('-', '')
  return minor.startsWith('-') ? minor.slice(1) : `-${minor}`
}

/** Plain-text money for screen-reader chart summaries; respects privacy mode. */
export function useMoneyText(): (minor: string | null | undefined, currency: string) => string {
  const { hidden } = usePrivacy()
  return useCallback(
    (minor: string | null | undefined, currency: string) => {
      if (minor === null || minor === undefined) return 'incomplete'
      return hidden ? maskedMoney(currency) : formatMoney(minor, currency)
    },
    [hidden],
  )
}

/** "Mar 26" for month starts, "2 Nov" for the partial current month. */
export function monthTick(date: string, timezone: string): string {
  const d = date.slice(0, 10)
  if (d.endsWith('-01')) return formatMonthTick(d, timezone)
  return format(parseDateOnly(d), 'd MMM')
}

export function SignedMoney({ minor, currency, className }: { minor: string; currency: string; className?: string }) {
  const s = minorSign(minor)
  return <Money minor={minor} currency={currency} sign="always" className={cn(s > 0 ? 'text-positive' : s < 0 ? 'text-negative' : 'text-muted', className)} />
}

// ---- incomplete totals --------------------------------------------------------------

/** Explains incomplete totals and links straight to each fix (missing rates and prices). */
export function IncompleteTotalsNotice({ missingCurrencies: given, scope = 'totals', className }: { missingCurrencies?: string[]; scope?: string; className?: string }) {
  const { baseCurrency } = usePrefs()
  const { data } = useAttention()
  const fixes = (data?.items ?? []).filter((i) => i.kind === 'missing_rate' || i.kind === 'missing_price')
  const missingCurrencies = given ?? fixes.flatMap((i) => (i.kind === 'missing_rate' && i.pair ? [i.pair.base] : []))
  const fallback = missingCurrencies.map((c) => ({ id: c, fix: { label: `Add ${c}/${baseCurrency} rate`, href: `/settings/currencies?add=${c}-${baseCurrency}` } }))
  const links = fixes.length ? fixes : fallback
  const ccys = missingCurrencies.length ? missingCurrencies.join(', ') : null
  return (
    <Notice
      tone="warning"
      className={className}
      title={`Your ${scope} are incomplete`}
      action={
        links.length ? (
          <div className="flex flex-wrap gap-2">
            {links.slice(0, 2).map((l) => (
              <Link key={l.id} to={l.fix.href} className={buttonClass({ size: 'sm', variant: 'secondary' })}>
                {l.fix.label}
              </Link>
            ))}
          </div>
        ) : undefined
      }
    >
      {ccys ? (
        <>
          Values held in {ccys} are left out until a {ccys} → {baseCurrency} rate is added. Nothing is counted as zero.
        </>
      ) : (
        <>Some holdings have no price yet, so they are left out. Nothing is counted as zero.</>
      )}
    </Notice>
  )
}

// ---- empty portfolio ----------------------------------------------------------------

export function EmptyPortfolio({ what }: { what: string }) {
  const navigate = useNavigate()
  return (
    <div className="card">
      <EmptyState
        icon={<Sprout size={22} aria-hidden />}
        title={`${what} appear once you add an account`}
        action={
          <Button variant="primary" icon={<Plus size={16} aria-hidden />} onClick={() => navigate('/accounts/new')}>
            Add your first account
          </Button>
        }
      >
        Add a savings account, fund, property, or brokerage account, then keep its value current. Insights build up from your
        history, one update at a time.
      </EmptyState>
    </div>
  )
}

/** Generic skeleton for an insights section: a stat strip and one or two chart blocks. */
export function InsightsSkeleton({ charts = 2, stats = true }: { charts?: number; stats?: boolean }) {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-6">
      {stats ? (
        <div className="card grid gap-4 p-5 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>
      ) : null}
      {Array.from({ length: charts }, (_, i) => (
        <div key={i} className="card p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-2 h-3.5 w-72 max-w-full" />
          <Skeleton className="mt-5 h-60" />
        </div>
      ))}
    </div>
  )
}

// ---- contributions vs growth bridge -----------------------------------------------------

/**
 * Start value → contributions → income → growth → withdrawals → fees → end value. Bar geometry
 * uses chart numbers; every figure shown re-formats from the server strings.
 */
export function FlowsBridge({ flows, compactLabels }: { flows: FlowsReport; compactLabels?: boolean }) {
  const isSm = useMediaQuery('(min-width: 640px)')
  const ccy = flows.baseCurrency
  const n = (m: string) => toChartNumber(m, ccy)
  const withdrawals = negateMinor(flows.withdrawalsMinor)
  const fees = negateMinor(flows.feesMinor)
  const steps: BridgeStep[] = [
    { id: 'start', label: 'Start value', kind: 'total', value: n(flows.startValueMinor), display: <Money minor={flows.startValueMinor} currency={ccy} /> },
    { id: 'contrib', label: 'Contributions', kind: 'delta', value: n(flows.contributionsMinor), display: <SignedMoney minor={flows.contributionsMinor} currency={ccy} /> },
    { id: 'income', label: compactLabels ? 'Income' : 'Interest and dividends', kind: 'delta', value: n(flows.incomeMinor), display: <SignedMoney minor={flows.incomeMinor} currency={ccy} /> },
    { id: 'growth', label: compactLabels ? 'Growth' : 'Market and value growth', kind: 'delta', value: n(flows.growthMinor), display: <SignedMoney minor={flows.growthMinor} currency={ccy} /> },
    { id: 'withdrawals', label: 'Withdrawals', kind: 'delta', value: n(withdrawals), display: <SignedMoney minor={withdrawals} currency={ccy} /> },
    { id: 'fees', label: 'Fees', kind: 'delta', value: n(fees), display: <SignedMoney minor={fees} currency={ccy} /> },
    { id: 'end', label: 'End value', kind: 'total', value: n(flows.endValueMinor), display: <Money minor={flows.endValueMinor} currency={ccy} /> },
  ]
  const sparse = flows.months.length === 0
  return (
    <ChartFrame
      summary={`Bridge from a start value to an end value in ${ccy} between ${flows.from} and ${flows.to}, through contributions, interest and dividends, market and value growth, withdrawals, and fees.`}
      height={sparse ? 220 : isSm ? 240 : 300}
      empty={
        sparse ? (
          <ChartEmpty icon={<Sprout size={18} aria-hidden />} title="No flows in this period yet">
            Record deposits, interest, and value updates to see what came from saving and what came from returns.
          </ChartEmpty>
        ) : undefined
      }
      table={{
        caption: 'Contributions versus growth',
        columns: [{ label: 'Step' }, { label: `Amount (${ccy})`, align: 'right' }],
        rows: steps.map((s) => [s.label, s.display]),
      }}
      caption={
        <>
          <DateText value={flows.from} /> to <DateText value={flows.to} />. Withdrawals and fees reduce the bridge; growth includes price
          movements and revaluations.
        </>
      }
    >
      <div className="pt-1">
        <BridgeChart steps={steps} ariaLabel="Contributions versus growth" />
      </div>
    </ChartFrame>
  )
}

/** Flows completeness note under a bridge. */
export function FlowsIncomplete() {
  return (
    <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-warning">
      <span aria-hidden className="inline-block size-2 rounded-full border border-dashed border-warning" />
      Some amounts in this period could not be converted, so this bridge is incomplete.
      <Link to="/settings/currencies" className="link inline-flex items-center gap-0.5">
        Review rates <ArrowRight size={12} aria-hidden />
      </Link>
    </p>
  )
}
