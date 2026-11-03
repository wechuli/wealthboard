/** Privacy-aware display components. Every financial figure in the UI renders through these. */
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Clock, HelpCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Freshness } from '@/api/extensions'
import { cn } from '@/lib/cn'
import { formatDate, formatDateTime, relativeDays } from '@/lib/dates'
import { UNIT_DECIMALS, formatDecimal, formatMoneyParts, formatPercent, formatBps, MASK, minorSign } from '@/lib/money'
import { usePrefs } from '@/lib/prefs'
import { usePrivacy } from '@/lib/privacy'
import { Badge } from './ui/Badge'
import { Tooltip } from './ui/Tooltip'

function Masked({ code, className }: { code?: string; className?: string }) {
  return (
    <span className={cn('num whitespace-nowrap', className)} aria-label="Hidden value" title="Values are hidden">
      {code ? <span className="ccy mr-[0.3em]">{code}</span> : null}
      <span aria-hidden className="tracking-[0.12em] text-muted">
        {MASK}
      </span>
    </span>
  )
}

export interface MoneyProps {
  minor: string | null | undefined
  currency: string
  compact?: boolean
  /** "always" shows + / − (use for changes). */
  sign?: 'auto' | 'always'
  hideCode?: boolean
  className?: string
  /** Shown instead of a value when `minor` is null (never zero). */
  unavailable?: ReactNode
}

/** "KES 4,576,918.00" with the code de-emphasised. Null renders as unavailable, never as zero. */
export function Money({ minor, currency, compact, sign = 'auto', hideCode, className, unavailable }: MoneyProps) {
  const { hidden } = usePrivacy()
  if (minor === null || minor === undefined) return <>{unavailable ?? <Unavailable />}</>
  if (hidden) return <Masked code={hideCode ? undefined : currency} className={className} />
  const p = formatMoneyParts(minor, currency, { compact, sign })
  return (
    <span className={cn('num whitespace-nowrap', className)}>
      {p.sign}
      {hideCode ? null : <span className="ccy mr-[0.3em]">{p.code}</span>}
      {p.amount}
    </span>
  )
}

export function Unavailable({ label = 'Incomplete', reason }: { label?: string; reason?: string }) {
  const body = (
    <span className="inline-flex items-center gap-1 rounded-sm border border-dashed border-warning/60 px-1.5 text-sm font-medium text-warning">
      <AlertTriangle size={13} aria-hidden />
      {label}
    </span>
  )
  return reason ? (
    <Tooltip content={reason}>
      <button type="button" className="cursor-help rounded-sm" aria-label={`${label}: ${reason}`}>
        {body}
      </button>
    </Tooltip>
  ) : (
    body
  )
}

/** A change with direction arrow, sign, and semantic colour. `invert` for liabilities (a decrease is good). */
export function Delta({
  minor,
  currency,
  compact,
  invert,
  suffix,
  className,
  showIcon = true,
  emptyLabel = 'Not enough history',
}: {
  minor: string | null | undefined
  currency: string
  compact?: boolean
  invert?: boolean
  suffix?: ReactNode
  className?: string
  showIcon?: boolean
  /** Shown when the change is null (for example "Incomplete" when a rate is missing). */
  emptyLabel?: string
}) {
  const { hidden } = usePrivacy()
  if (minor === null || minor === undefined)
    return (
      <span className={cn('inline-flex items-center gap-1 text-sm text-subtle', className)}>
        <HelpCircle size={14} aria-hidden />
        {emptyLabel}
      </span>
    )
  const s = minorSign(minor)
  const good = invert ? s < 0 : s > 0
  const tone = s === 0 ? 'text-muted' : good ? 'text-positive' : 'text-negative'
  const Icon = s > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span className={cn('inline-flex items-center gap-1 font-medium', tone, className)}>
      {showIcon && s !== 0 ? <Icon size={15} aria-hidden className="shrink-0" /> : null}
      {hidden ? <Masked code={currency} /> : <Money minor={minor} currency={currency} compact={compact} sign="always" />}
      {suffix ? <span className="font-normal text-muted">{suffix}</span> : null}
      <span className="sr-only">{s > 0 ? 'increase' : s < 0 ? 'decrease' : 'no change'}</span>
    </span>
  )
}

export function Quantity({ value, className, maxFraction = UNIT_DECIMALS }: { value: string | null | undefined; className?: string; maxFraction?: number }) {
  const { hidden } = usePrivacy()
  if (value === null || value === undefined) return <span className="text-subtle">—</span>
  if (hidden) return <Masked className={className} />
  return <span className={cn('num', className)}>{formatDecimal(value, { maxFraction })}</span>
}

export function UnitPrice({ value, currency, className }: { value: string | null | undefined; currency: string; className?: string }) {
  const { hidden } = usePrivacy()
  if (value === null || value === undefined) return <Unavailable label="No price" />
  if (hidden) return <Masked code={currency} className={className} />
  return (
    <span className={cn('num whitespace-nowrap', className)}>
      <span className="ccy mr-[0.3em]">{currency}</span>
      {formatDecimal(value, { minFraction: 2, maxFraction: UNIT_DECIMALS })}
    </span>
  )
}

export function Percent({ value, sign, className }: { value: string | null | undefined; sign?: 'always'; className?: string }) {
  if (value === null || value === undefined) return <span className="text-subtle">—</span>
  return <span className={cn('num', className)}>{formatPercent(value, { sign })}</span>
}

export function Bps({ value, sign, className }: { value: number | null | undefined; sign?: 'always'; className?: string }) {
  if (value === null || value === undefined) return <span className="text-subtle">—</span>
  return <span className={cn('num', className)}>{formatBps(value, { sign })}</span>
}

/** A date (YYYY-MM-DD) or timestamp in the user's format and timezone. */
export function DateText({ value, withTime, className }: { value: string | null | undefined; withTime?: boolean; className?: string }) {
  const { dateFormat, timezone } = usePrefs()
  if (!value) return <span className="text-subtle">—</span>
  return (
    <time dateTime={value} className={cn('num whitespace-nowrap', className)}>
      {withTime ? formatDateTime(value, dateFormat, timezone) : formatDate(value, dateFormat, timezone)}
    </time>
  )
}

export function RelativeDate({ value, className }: { value: string; className?: string }) {
  const { dateFormat, timezone, today } = usePrefs()
  return (
    <time dateTime={value} title={formatDate(value, dateFormat, timezone)} className={cn('whitespace-nowrap', className)}>
      {relativeDays(value, today, timezone)}
    </time>
  )
}

/** Price/valuation freshness with an as-of date. Colour is never the only signal. */
export function FreshnessBadge({ freshness, asOf }: { freshness: Freshness; asOf?: string | null }) {
  const { dateFormat, timezone } = usePrefs()
  const date = asOf ? formatDate(asOf, dateFormat, timezone) : null
  if (freshness === 'stale')
    return (
      <Badge tone="warning" icon={<Clock size={12} aria-hidden />} title={date ? `Last priced ${date}` : undefined}>
        Stale{date ? ` · ${date}` : ''}
      </Badge>
    )
  if (freshness === 'missing')
    return (
      <Badge tone="warning" icon={<AlertTriangle size={12} aria-hidden />}>
        Price missing
      </Badge>
    )
  if (freshness === 'fresh')
    return (
      <Badge tone="neutral" title={date ? `As of ${date}` : undefined}>
        As of {date}
      </Badge>
    )
  return null
}
