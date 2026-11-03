import { differenceInCalendarMonths } from 'date-fns'
import { AlertTriangle, Ban, CheckCircle2, Pause, PartyPopper, TrendingDown } from 'lucide-react'
import type { Goal, GoalStatus } from '@/api/types'
import { CategoryIcon } from '@/components/CategoryIcon'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/cn'
import { parseDateOnly } from '@/lib/dates'

export const STATUSES: GoalStatus[] = ['active', 'paused', 'completed', 'cancelled']

export const STATUS_LABELS: Record<GoalStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export function isGoalStatus(value: string | null): value is GoalStatus {
  return value !== null && (STATUSES as string[]).includes(value)
}

export function TrackingBadge({ status }: { status: Goal['trackingStatus'] }) {
  if (status === 'on_track')
    return (
      <Badge tone="positive" icon={<CheckCircle2 size={13} aria-hidden />}>
        On track
      </Badge>
    )
  if (status === 'behind')
    return (
      <Badge tone="warning" icon={<TrendingDown size={13} aria-hidden />}>
        Behind plan
      </Badge>
    )
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-warning/60 bg-warning-soft px-2 text-xs font-medium text-warning">
      <AlertTriangle size={13} aria-hidden />
      Incomplete
    </span>
  )
}

export function GoalStatusBadge({ status }: { status: string }) {
  if (status === 'paused')
    return (
      <Badge tone="neutral" icon={<Pause size={12} aria-hidden />}>
        Paused
      </Badge>
    )
  if (status === 'completed')
    return (
      <Badge tone="positive" icon={<PartyPopper size={13} aria-hidden />}>
        Completed
      </Badge>
    )
  if (status === 'cancelled')
    return (
      <Badge tone="neutral" icon={<Ban size={12} aria-hidden />}>
        Cancelled
      </Badge>
    )
  return null
}

/** Active goals show how they are tracking; other goals show their status. */
export function GoalStateBadge({ goal }: { goal: Goal }) {
  return goal.status === 'active' ? <TrackingBadge status={goal.trackingStatus} /> : <GoalStatusBadge status={goal.status} />
}

export function progressTone(goal: Goal): 'accent' | 'warning' | 'positive' | 'muted' {
  if (goal.status === 'completed') return 'positive'
  if (goal.status !== 'active') return 'muted'
  if (goal.trackingStatus === 'behind') return 'warning'
  return 'accent'
}

export function GoalIcon({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  return (
    <span className={cn('grid shrink-0 place-items-center rounded-lg bg-accent-soft text-accent', size === 'lg' ? 'size-12' : 'size-10')}>
      <CategoryIcon name={name} size={size === 'lg' ? 22 : 19} />
    </span>
  )
}

const FREQUENCY: Record<string, string> = {
  weekly: 'a week',
  monthly: 'a month',
  quarterly: 'a quarter',
  annually: 'a year',
  yearly: 'a year',
}

export function perFrequency(frequency: string): string {
  return FREQUENCY[frequency] ?? frequency
}

/** Calendar months from today to the target date (date math, not money). */
export function monthsUntil(targetDate: string, today: string): number {
  return differenceInCalendarMonths(parseDateOnly(targetDate), parseDateOnly(today))
}

export function timeLeftLabel(targetDate: string, today: string): string {
  if (targetDate < today) {
    const over = monthsUntil(today, targetDate)
    return over <= 0 ? 'Target date passed' : `${over} ${over === 1 ? 'month' : 'months'} past the target date`
  }
  const n = monthsUntil(targetDate, today)
  if (n <= 0) return 'Due this month'
  if (n < 24) return `${n} ${n === 1 ? 'month' : 'months'} left`
  const years = Math.floor(n / 12)
  const months = n % 12
  return `${years} years${months ? `, ${months} ${months === 1 ? 'month' : 'months'}` : ''} left`
}

/** Basis points to an exact percent input string: 800 → "8", 825 → "8.25" (string operations only). */
export function bpsToPercentInput(bps: number): string {
  const negative = bps < 0
  const abs = Math.abs(Math.trunc(bps)).toString().padStart(3, '0')
  const whole = abs.slice(0, -2).replace(/^0+(?=\d)/, '')
  const frac = abs.slice(-2).replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`
}

export function missingRateHref(goal: Goal): string | null {
  const from = goal.missingCurrencies.find((c) => c !== goal.currency) ?? goal.missingCurrencies[0]
  if (!from) return null
  return `/settings/currencies?add=${from}-${goal.currency}`
}
