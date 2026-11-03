import { ArrowRight, CheckCircle2, Pause, Plus, Target, TrendingDown } from 'lucide-react'
import { Link } from 'react-router'
import type { Goal } from '@/api/types'
import { CategoryIcon } from '@/components/CategoryIcon'
import { DateText, Money, Percent, Unavailable } from '@/components/format'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Skeleton } from '@/components/ui/Skeleton'
import { useGoals } from '@/lib/queries'
import { useRecorder } from '@/features/recording/recorder'
import { Panel } from './Panel'

const STATUS_ORDER: Record<string, number> = { active: 0, paused: 1, completed: 2, cancelled: 3 }
const TRACK_ORDER: Record<Goal['trackingStatus'], number> = { behind: 0, incomplete: 1, on_track: 2 }

export function GoalStatusBadge({ goal }: { goal: Goal }) {
  if (goal.status === 'completed')
    return (
      <Badge tone="positive" icon={<CheckCircle2 size={12} aria-hidden />}>
        Completed
      </Badge>
    )
  if (goal.status === 'paused')
    return (
      <Badge tone="neutral" icon={<Pause size={12} aria-hidden />}>
        Paused
      </Badge>
    )
  if (goal.status === 'cancelled') return <Badge tone="neutral">Cancelled</Badge>
  if (goal.trackingStatus === 'behind')
    return (
      <Badge tone="warning" icon={<TrendingDown size={12} aria-hidden />}>
        Behind plan
      </Badge>
    )
  if (goal.trackingStatus === 'incomplete') return <Badge tone="warning">Incomplete</Badge>
  return (
    <Badge tone="positive" icon={<CheckCircle2 size={12} aria-hidden />}>
      On track
    </Badge>
  )
}

function tone(goal: Goal): 'accent' | 'warning' | 'positive' | 'muted' {
  if (goal.status === 'completed') return 'positive'
  if (goal.status !== 'active') return 'muted'
  return goal.trackingStatus === 'behind' ? 'warning' : 'accent'
}

/** Compact goal progress: status first, then how far along and by when. */
export function GoalsPanel({ limit = 5 }: { limit?: number }) {
  const goals = useGoals()
  const recorder = useRecorder()
  const list = (goals.data ?? [])
    .filter((g) => g.status !== 'cancelled')
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
        (a.status === 'active' ? TRACK_ORDER[a.trackingStatus] - TRACK_ORDER[b.trackingStatus] : 0) ||
        a.priority - b.priority,
    )
  const shown = list.slice(0, limit)
  const active = list.filter((g) => g.status === 'active')
  const onTrack = active.filter((g) => g.trackingStatus === 'on_track').length

  return (
    <Panel
      title="Goals"
      description={
        goals.data && active.length
          ? onTrack === active.length
            ? `All ${active.length} active goals on track`
            : `${onTrack} of ${active.length} active goals on track`
          : 'Progress toward what you are saving for'
      }
      action={
        list.length ? (
          <Link to="/goals" className="link inline-flex min-h-9 items-center gap-1 text-sm">
            All goals <ArrowRight size={14} aria-hidden />
          </Link>
        ) : undefined
      }
    >
      {goals.isPending ? (
        <div role="status" aria-label="Loading goals" className="flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-9 rounded-md" />
              <div className="flex-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-2 h-2 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : goals.isError ? (
        <ErrorState compact error={goals.error} onRetry={() => goals.refetch()} />
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-md bg-sunken/60 p-4">
          <p className="text-sm text-muted">
            Give your savings a destination: a car, school fees, an emergency fund. Link a goal to an account and its value counts toward the target
            automatically.
          </p>
          <Button size="sm" variant="secondary" icon={<Plus size={15} aria-hidden />} onClick={() => recorder.open({ action: 'goal' })}>
            Set a goal
          </Button>
        </div>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {shown.map((g) => (
            <li key={g.id}>
              <Link to={`/goals/${g.id}`} className="group flex gap-3 rounded-md px-2 py-3 transition-colors hover:bg-sunken">
                <CategoryIcon name={g.icon || 'target'} framed size={17} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium text-ink group-hover:underline">{g.name}</span>
                    <GoalStatusBadge goal={g} />
                  </div>
                  <ProgressBar className="mt-2" percent={g.progressPercent} tone={tone(g)} incomplete={g.valueIncomplete} label={`${g.name} progress`} />
                  <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs text-muted">
                    <span className="min-w-0">
                      {g.valueIncomplete ? (
                        <Unavailable />
                      ) : (
                        <Money minor={g.currentAmountMinor} currency={g.currentAmountCurrency} className="text-ink" />
                      )}{' '}
                      of <Money minor={g.targetAmountMinor} currency={g.currency} />
                    </span>
                    <span className="whitespace-nowrap">
                      <Percent value={g.progressPercent} /> · by <DateText value={g.targetDate} />
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
          {list.length > shown.length ? (
            <li className="px-2 pt-1 text-xs text-subtle">
              <Target size={12} aria-hidden className="mr-1 inline" />
              {list.length - shown.length} more on the goals page
            </li>
          ) : null}
        </ul>
      )}
    </Panel>
  )
}
