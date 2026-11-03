import { AlertTriangle, CheckCircle2, Plus, Target, TrendingDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { Goal, GoalStatus } from '@/api/types'
import { Money } from '@/components/format'
import { Button, buttonClass } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { PageHeader } from '@/components/ui/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { useRecorder } from '@/features/recording/recorder'
import { cn } from '@/lib/cn'
import { useGoals } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { GoalAlerts } from './GoalAlerts'
import { GoalCard, GoalCardSkeleton } from './GoalCard'
import { isGoalStatus, perFrequency, STATUS_LABELS, STATUSES } from './goalMeta'

type Filter = GoalStatus | 'all'

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: string }) {
  return (
    <div className="min-w-0 px-3 py-3 md:px-4">
      <dt className={cn('flex items-center gap-1.5 text-xs font-medium', tone)}>
        {icon}
        <span className="truncate">{label}</span>
      </dt>
      <dd className="display num mt-1 text-2xl leading-none text-ink">{value}</dd>
    </div>
  )
}

/**
 * Counts are computed here (counting is not money arithmetic). Money totals across goals need a
 * server-side summary, so the plan is listed per goal instead of summed.
 */
function GoalsSummary({ goals }: { goals: Goal[] }) {
  const active = goals.filter((g) => g.status === 'active')
  const onTrack = active.filter((g) => g.trackingStatus === 'on_track').length
  const behind = active.filter((g) => g.trackingStatus === 'behind').length
  const incomplete = active.filter((g) => g.trackingStatus === 'incomplete').length
  const planned = active.flatMap((g) => (g.plan && g.plan.plannedContributionMinor !== '0' ? [{ goal: g, plan: g.plan }] : []))

  const headline =
    active.length === 0
      ? 'No active goals right now'
      : onTrack === active.length
        ? active.length === 1
          ? 'Your active goal is on track'
          : `All ${active.length} active goals are on track`
        : `${onTrack} of ${plural(active.length, 'active goal', 'active goals')} on track`

  const notes: string[] = []
  if (behind > 0) notes.push(`${plural(behind, 'goal is', 'goals are')} behind plan. Open ${behind === 1 ? 'it' : 'each one'} to see the monthly amount that closes the gap.`)
  if (incomplete > 0) notes.push(`${plural(incomplete, 'goal', 'goals')} can't be assessed until missing exchange rates or prices are added.`)
  if (active.length === 0) notes.push('Resume a paused goal or create a new one to track progress here.')
  if (notes.length === 0) notes.push('Every saved plan is projected to reach its target by its date.')

  return (
    <section aria-labelledby="goals-summary-title" className="card mb-8 grid overflow-hidden md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="p-5 md:p-6">
        <h2 id="goals-summary-title" className="text-lg font-semibold text-ink">
          {headline}
        </h2>
        <p className="mt-1 max-w-[56ch] text-sm text-muted">{notes.join(' ')}</p>
        <dl className="mt-5 grid grid-cols-3 divide-x divide-line rounded-md border border-line bg-sunken/40">
          <Stat icon={<CheckCircle2 size={14} aria-hidden />} label="On track" value={onTrack} tone="text-positive" />
          <Stat icon={<TrendingDown size={14} aria-hidden />} label="Behind" value={behind} tone={behind > 0 ? 'text-warning' : 'text-muted'} />
          <Stat icon={<AlertTriangle size={14} aria-hidden />} label="Incomplete" value={incomplete} tone={incomplete > 0 ? 'text-warning' : 'text-muted'} />
        </dl>
      </div>
      <div className="border-t border-line bg-sunken/30 p-5 md:border-l md:border-t-0 md:p-6">
        <h3 className="text-sm font-semibold text-ink">Planned contributions</h3>
        <p className="mt-0.5 text-xs text-muted">What each active goal's saved plan sets aside</p>
        {planned.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No active goal has a contribution plan yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {planned.map(({ goal: g, plan }) => (
              <li key={g.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <Link to={`/goals/${g.id}`} className="min-w-0 truncate text-ink hover:underline">
                  {g.name}
                </Link>
                <span className="shrink-0 text-right">
                  <Money minor={plan.plannedContributionMinor} currency={g.currency} className="font-medium text-ink" /> <span className="text-xs text-muted">{perFrequency(plan.frequency)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function StatusFilter({ value, counts }: { value: Filter; counts: Record<Filter, number> }) {
  const options: Filter[] = [...STATUSES, 'all']
  return (
    <nav aria-label="Filter goals by status">
      <ul className="flex flex-wrap gap-1.5">
        {options.map((s) => {
          const current = s === value
          return (
            <li key={s}>
              <Link
                to={{ search: s === 'active' ? '' : `?status=${s}` }}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'inline-flex h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors duration-[var(--dur-1)] md:h-9',
                  current ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink',
                )}
              >
                {s === 'all' ? 'All' : STATUS_LABELS[s]}
                <span className={cn('num text-xs', current ? 'text-accent' : 'text-subtle')}>{counts[s]}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function GoalsSkeleton() {
  return (
    <div role="status" aria-label="Loading goals">
      <div className="card mb-8 grid gap-6 p-5 md:grid-cols-2 md:p-6">
        <div>
          <Skeleton className="h-6 w-64 max-w-full" />
          <Skeleton className="mt-2 h-4 w-80 max-w-full" />
          <Skeleton className="mt-5 h-[68px] w-full" />
        </div>
        <div className="grid content-start gap-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
      <Skeleton className="mb-4 h-9 w-72 max-w-full" />
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <GoalCardSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}

export default function GoalsPage() {
  usePageTitle('Goals')
  const recorder = useRecorder()
  const [params] = useSearchParams()
  const raw = params.get('status')
  const filter: Filter = raw === 'all' ? 'all' : isGoalStatus(raw) ? raw : 'active'
  const goals = useGoals()

  const newGoal = (
    <Button variant="primary" icon={<Plus size={17} aria-hidden />} onClick={() => recorder.open({ action: 'goal' })}>
      New goal
    </Button>
  )

  let content: ReactNode
  if (goals.isPending) content = <GoalsSkeleton />
  else if (goals.isError)
    content = (
      <div className="card">
        <ErrorState error={goals.error} onRetry={() => void goals.refetch()} title="Goals couldn't be loaded" />
      </div>
    )
  else if (goals.data.length === 0)
    content = (
      <div className="card">
        <EmptyState
          icon={<Target size={22} aria-hidden />}
          title="Give your money somewhere to go"
          action={
            <Button variant="primary" icon={<Plus size={16} aria-hidden />} onClick={() => recorder.open({ action: 'goal' })}>
              Create your first goal
            </Button>
          }
        >
          A goal is a target amount and a date: a car, an emergency fund, school fees. Link an account and its value becomes your progress, or enter the amount yourself. You'll see whether your
          monthly plan gets you there, and what to change if it doesn't.
        </EmptyState>
      </div>
    )
  else {
    const all = goals.data
    const counts: Record<Filter, number> = {
      active: 0,
      paused: 0,
      completed: 0,
      cancelled: 0,
      all: all.length,
    }
    for (const g of all) if (isGoalStatus(g.status)) counts[g.status] += 1
    const shown = filter === 'all' ? all : all.filter((g) => g.status === filter)
    content = (
      <>
        <GoalAlerts />
        <GoalsSummary goals={all} />
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="goal-list-title" className="text-md font-semibold text-ink">
            {filter === 'all' ? 'All goals' : `${STATUS_LABELS[filter]} goals`}
          </h2>
          <StatusFilter value={filter} counts={counts} />
        </div>
        {shown.length === 0 ? (
          <div className="card">
            <EmptyState
              compact
              icon={<Target size={22} aria-hidden />}
              title={`No ${STATUS_LABELS[filter as GoalStatus].toLowerCase()} goals`}
              action={
                <Link to={{ search: '?status=all' }} className={buttonClass()}>
                  Show all goals
                </Link>
              }
            >
              {filter === 'active'
                ? 'Every goal is paused, completed, or cancelled. Resume one or create a new goal.'
                : `Goals you mark as ${STATUS_LABELS[filter as GoalStatus].toLowerCase()} appear here.`}
            </EmptyState>
          </div>
        ) : (
          <ul aria-labelledby="goal-list-title" className="grid gap-4 md:grid-cols-2">
            {shown.map((g) => (
              <li key={g.id} className="min-w-0">
                <GoalCard goal={g} />
              </li>
            ))}
          </ul>
        )}
      </>
    )
  }

  return (
    <div className="page">
      <PageHeader title="Goals" description="What you're saving towards, and whether your plan gets you there on time." actions={newGoal} />
      {content}
    </div>
  )
}
