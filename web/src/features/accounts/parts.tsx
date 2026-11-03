/** Small building blocks shared by the accounts list, account detail, and import screens. */
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { AccountSummaryExt } from '@/api/extensions'
import type { Account } from '@/api/types'
import { Sparkline } from '@/components/charts/Sparkline'
import { DateText, FreshnessBadge, Money, Unavailable } from '@/components/format'
import { cn } from '@/lib/cn'
import { toChartNumber } from '@/lib/money'
import { missingValueReason, priceFixHref, rateFixHref } from './model'

/** A compact labelled select for toolbars ("Group by Category ▾"). */
export function ToolbarSelect<T extends string>({ label, value, onChange, options, className }: { label: string; value: T; onChange(v: T): void; options: { value: T; label: string }[]; className?: string }) {
  return (
    <label
      className={cn(
        'relative inline-flex h-11 min-w-0 shrink-0 items-center rounded-md border border-line bg-surface pl-3 text-sm shadow-e1 transition-colors hover:border-line-strong has-[select:focus-visible]:outline-2 has-[select:focus-visible]:outline-offset-2 has-[select:focus-visible]:outline-[var(--focus-ring)] md:h-9',
        className,
      )}
    >
      <span className="mr-1.5 whitespace-nowrap text-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className="h-full min-w-0 cursor-pointer appearance-none bg-transparent pr-8 font-medium text-ink outline-none">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden size={15} className="pointer-events-none absolute right-2.5 text-muted" />
    </label>
  )
}

/**
 * The account's value in the base currency. A missing exchange rate is shown as unavailable with a
 * direct fix link, never as zero; a missing price is labelled as such (its fix is MissingPriceFix).
 */
export function BaseValue({
  account,
  summary,
  baseCurrency,
  interactive = true,
  showIncomplete = false,
  className,
}: {
  account: Account
  summary?: AccountSummaryExt
  baseCurrency: string
  interactive?: boolean
  /** Also mark base-currency accounts with a missing price (where the value itself is already in the base currency). */
  showIncomplete?: boolean
  className?: string
}) {
  const reason = missingValueReason(account, summary, baseCurrency)
  if (reason?.kind === 'rate') {
    const label = `Missing ${reason.currency} rate`
    return (
      <span className={cn('inline-flex flex-wrap items-center gap-x-2 gap-y-1', className)}>
        {interactive ? (
          <span className="relative z-10">
            <Unavailable label={label} reason={`Add a ${reason.currency} → ${baseCurrency} exchange rate to value this account in ${baseCurrency}.`} />
          </span>
        ) : (
          <Unavailable label={label} />
        )}
        {interactive ? (
          <Link to={rateFixHref(reason.currency, baseCurrency)} className="link relative z-10 text-sm">
            Add rate
          </Link>
        ) : null}
      </span>
    )
  }
  if (reason) {
    // A missing price: base-currency accounts already explain it next to the value, so only foreign ones repeat it.
    if (account.currency === baseCurrency && !showIncomplete) return null
    const label = reason.kind === 'price' ? 'Missing price' : 'Incomplete'
    return (
      <span className={cn('inline-flex', className)}>
        {interactive ? (
          <span className="relative z-10">
            <Unavailable label={label} reason={`A holding has no price, so this account can’t be valued in ${baseCurrency} yet.`} />
          </span>
        ) : (
          <Unavailable label={label} />
        )}
      </span>
    )
  }
  if (account.currency === baseCurrency || account.convertedValueMinor === null) return null
  return <Money minor={account.convertedValueMinor} currency={baseCurrency} className={className} />
}

/** Sparkline from the summary's month-end values; dashed when any point is incomplete. */
export function AccountSparkline({ account, summary, width = 96, height = 28 }: { account: Account; summary?: AccountSummaryExt; width?: number; height?: number }) {
  const points = summary?.sparkline ?? []
  const values = points.map((p) => toChartNumber(p.valueMinor, account.currency))
  const incomplete = points.some((p) => !p.complete)
  return <Sparkline values={values} incomplete={incomplete} width={width} height={height} tone={account.isLiability ? 'negative' : 'accent'} />
}

/** As-of date with freshness. Position accounts get a price freshness badge; others a plain as-of date. */
export function AsOf({ summary, compact }: { summary?: AccountSummaryExt; compact?: boolean }) {
  if (!summary) return null
  if (summary.freshness === 'not_applicable')
    return (
      <span className="whitespace-nowrap text-muted">
        {compact ? null : 'As of '}
        <DateText value={summary.asOfDate} />
      </span>
    )
  return <FreshnessBadge freshness={summary.freshness} asOf={summary.asOfDate} />
}

/** Missing-price explanation with a fix link to the first unpriced instrument. */
export function MissingPriceFix({ summary, className }: { summary?: AccountSummaryExt; className?: string }) {
  const first = summary?.missingPrices[0]
  if (!first || !summary) return null
  const names = summary.missingPrices.map((p) => p.name).join(', ')
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-2 gap-y-1', className)}>
      <span className="relative z-10">
        <Unavailable label="Incomplete" reason={`No price recorded for ${names}. The value shown leaves ${summary.missingPrices.length === 1 ? 'it' : 'them'} out.`} />
      </span>
      <Link to={priceFixHref(first.instrumentId)} className="link relative z-10 text-sm">
        Add price
      </Link>
    </span>
  )
}

export function GoalLinks({ goals, className }: { goals: { id: string; name: string }[]; className?: string }) {
  if (goals.length === 0) return null
  return (
    <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-x-1.5', className)}>
      <span className="text-muted">Funds</span>
      {goals.map((g, i) => (
        <span key={g.id} className="min-w-0">
          <Link to={`/goals/${g.id}`} className="link relative z-10">
            {g.name}
          </Link>
          {i < goals.length - 1 ? ',' : null}
        </span>
      ))}
    </span>
  )
}

/** Value label for an account: liabilities read "Owed" in the negative tone (with the word, not colour alone). */
export function ValueLabel({ account, children }: { account: Pick<Account, 'isLiability'>; children?: ReactNode }) {
  return <span className={cn('text-xs font-medium', account.isLiability ? 'text-negative' : 'text-muted')}>{children ?? (account.isLiability ? 'Owed' : 'Value')}</span>
}
