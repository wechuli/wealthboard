import { BellOff } from 'lucide-react'
import { Link } from 'react-router'
import { api } from '@/api'
import type { GoalAlert } from '@/api/types'
import { DateText, Money, Percent } from '@/components/format'
import { Button, buttonClass } from '@/components/ui/Button'
import { Notice } from '@/components/ui/Notice'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { useApiMutation, useGoalAlerts } from '@/lib/queries'

function AlertNotice({ alert }: { alert: GoalAlert }) {
  const online = useOnline()
  const dismiss = useApiMutation({
    mutationFn: () => api.goals.dismissAlert(alert.goalId),
    success: `Reminder for ${alert.goalName} dismissed until next month`,
  })
  return (
    <Notice
      tone="warning"
      title={`${alert.goalName} is behind plan`}
      action={
        <>
          <Link to={`/goals/${alert.goalId}`} className={buttonClass({ size: 'sm' })}>
            Review plan
          </Link>
          <Button
            size="sm"
            variant="ghost"
            icon={<BellOff size={15} aria-hidden />}
            onClick={() => dismiss.mutate(undefined)}
            loading={dismiss.isPending}
            disabled={!online}
            title={online ? undefined : OFFLINE_REASON}
          >
            Dismiss for this month
          </Button>
        </>
      }
    >
      <Money minor={alert.currentAmountMinor} currency={alert.currency} /> of <Money minor={alert.targetAmountMinor} currency={alert.currency} /> saved (
      <Percent value={alert.progressPercent} />) for <DateText value={alert.targetDate} />. The saved plan falls short; the goal page shows the monthly amount that gets it back on track.
    </Notice>
  )
}

/** Goal-behind reminders. Each can be dismissed until the next calendar month. */
export function GoalAlerts() {
  const { data } = useGoalAlerts()
  if (!data || data.length === 0) return null
  return (
    <div className="mb-6 grid gap-2" role="region" aria-label="Goal reminders">
      {data.map((a) => (
        <AlertNotice key={a.alertKey} alert={a} />
      ))}
    </div>
  )
}
