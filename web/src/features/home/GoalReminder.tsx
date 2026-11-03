import { ArrowRight, Target } from 'lucide-react'
import { Link } from 'react-router'
import { api } from '@/api'
import { DateText, Money, Percent } from '@/components/format'
import { Button, buttonClass } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { useApiMutation, useGoalAlerts } from '@/lib/queries'

/** A calm, dismissible monthly reminder for the first goal that is behind plan. */
export function GoalReminder({ className }: { className?: string }) {
  const alerts = useGoalAlerts()
  const online = useOnline()
  const dismiss = useApiMutation({
    mutationFn: (goalId: string) => api.goals.dismissAlert(goalId),
    success: 'Reminder dismissed until next month',
  })
  const alert = alerts.data?.[0]
  if (!alert) return null
  const more = (alerts.data?.length ?? 1) - 1
  return (
    <section aria-labelledby="goal-reminder" className={cn('rounded-lg border border-line bg-accent-soft/60 p-4 md:p-5', className)}>
      <div className="flex gap-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-surface text-accent">
          <Target size={18} aria-hidden strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="goal-reminder" className="text-md font-semibold text-ink">
            {alert.goalName} is behind plan
          </h2>
          <p className="mt-1 text-sm text-muted">
            <Money minor={alert.currentAmountMinor} currency={alert.currency} className="text-ink" /> saved of{' '}
            <Money minor={alert.targetAmountMinor} currency={alert.currency} /> (<Percent value={alert.progressPercent} />) for <DateText value={alert.targetDate} />.
            A small change to the monthly plan can bring it back on track.
            {more > 0 ? ` ${more} other ${more === 1 ? 'goal is' : 'goals are'} also behind.` : ''}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link to={`/goals/${alert.goalId}`} className={buttonClass({ variant: 'primary', size: 'sm' })}>
              Review plan <ArrowRight size={15} aria-hidden />
            </Link>
            <Button
              size="sm"
              variant="ghost"
              loading={dismiss.isPending}
              disabled={!online}
              title={online ? undefined : OFFLINE_REASON}
              onClick={() => dismiss.mutate(alert.goalId)}
            >
              Dismiss for this month
            </Button>
          </div>
          {!online ? <p className="mt-2 text-xs text-subtle">{OFFLINE_REASON}</p> : null}
        </div>
      </div>
    </section>
  )
}
