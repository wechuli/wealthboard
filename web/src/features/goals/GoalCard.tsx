import { Link2, PenLine } from 'lucide-react'
import { Link } from 'react-router'
import type { Goal } from '@/api/types'
import { DateText, Money, Percent, Unavailable } from '@/components/format'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { usePrefs } from '@/lib/prefs'
import { GoalIcon, GoalStateBadge, perFrequency, progressTone, timeLeftLabel } from './goalMeta'

export function incompleteReason(goal: Goal): string {
  if (goal.missingCurrencies.length > 0) return `Missing ${goal.missingCurrencies.map((c) => `${c} → ${goal.currency}`).join(', ')} exchange rate`
  return 'Part of the linked account has no price, so its value is incomplete'
}

/** Current amount: never shows a value that is really a missing conversion. */
export function GoalCurrent({ goal, className }: { goal: Goal; className?: string }) {
  if (goal.valueIncomplete) return <Unavailable reason={incompleteReason(goal)} />
  return <Money minor={goal.currentAmountMinor} currency={goal.currentAmountCurrency} className={className} />
}

export function GoalCard({ goal }: { goal: Goal }) {
  const { today } = usePrefs()
  const muted = goal.status === 'paused' || goal.status === 'cancelled'
  return (
    <article
      className={cn('card group relative flex flex-col p-4 transition-[box-shadow,border-color] duration-[var(--dur-2)] hover:border-line-strong/50 hover:shadow-e2 md:p-5', muted && 'bg-surface/70')}
    >
      <header className="flex items-start gap-3">
        <GoalIcon name={goal.icon} />
        <div className="min-w-0 flex-1">
          <h3 className="display text-lg leading-snug text-ink">
            <Link
              to={`/goals/${goal.id}`}
              className="rounded-sm outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[var(--focus-ring)] group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4"
            >
              {goal.name}
            </Link>
          </h3>
          <p className="mt-0.5 text-sm text-muted">
            <Money minor={goal.targetAmountMinor} currency={goal.currency} /> by <DateText value={goal.targetDate} />
          </p>
        </div>
        <div className="shrink-0 pt-0.5">
          <GoalStateBadge goal={goal} />
        </div>
      </header>

      <div className="mt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="relative z-[1] text-xl font-semibold text-ink">
            <GoalCurrent goal={goal} />
          </span>
          {goal.valueIncomplete ? null : (
            <span className="text-sm text-muted">
              <Percent value={goal.progressPercent} className="font-medium text-ink" /> saved
            </span>
          )}
        </div>
        <ProgressBar percent={goal.progressPercent} tone={progressTone(goal)} incomplete={goal.valueIncomplete} label={`${goal.name} progress`} className="mt-3" />
        <p className="mt-2 text-xs text-subtle">{goal.status === 'completed' ? 'Goal complete!' : timeLeftLabel(goal.targetDate, today)}</p>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3 border-t border-line pt-4 text-sm min-[420px]:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs text-subtle">Progress from</dt>
          <dd className="mt-0.5 min-w-0">
            {goal.linkedAccount ? (
              <Link to={`/accounts/${goal.linkedAccount.id}`} className="relative z-[1] inline-flex max-w-full items-center gap-1.5 text-ink hover:underline">
                <Link2 size={14} aria-hidden className="shrink-0 text-subtle" />
                <span className="truncate">{goal.linkedAccount.name}</span>
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-muted">
                <PenLine size={14} aria-hidden className="text-subtle" />
                Manual amount
              </span>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-subtle">Planned contribution</dt>
          <dd className="mt-0.5 text-ink">
            {goal.plan && goal.plan.plannedContributionMinor !== '0' ? (
              <>
                <Money minor={goal.plan.plannedContributionMinor} currency={goal.currency} /> <span className="text-muted">{perFrequency(goal.plan.frequency)}</span>
              </>
            ) : (
              <span className="text-muted">No plan set</span>
            )}
          </dd>
        </div>
      </dl>
    </article>
  )
}

export function GoalCardSkeleton() {
  return (
    <div className="card p-4 md:p-5">
      <div className="flex items-start gap-3">
        <Skeleton className="size-10 rounded-lg" />
        <div className="flex-1">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-2 h-3.5 w-52 max-w-full" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <Skeleton className="mt-6 h-6 w-44" />
      <Skeleton className="mt-3 h-2 w-full rounded-full" />
      <Skeleton className="mt-2 h-3 w-24" />
      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4">
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
      </div>
    </div>
  )
}
