import { Link2, PenLine } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { Goal } from '@/api/types'
import { Bps, DateText, Money, Percent } from '@/components/format'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { usePrefs } from '@/lib/prefs'
import { GoalCurrent } from './GoalCard'
import { GoalStateBadge, perFrequency, progressTone, timeLeftLabel } from './goalMeta'

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0 md:block md:py-0">
      <dt className="text-xs text-subtle md:mb-0.5">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-ink md:text-left">{children}</dd>
    </div>
  )
}

/** Plain-language explanation of the server's tracking status. */
function Explanation({ goal }: { goal: Goal }) {
  const ccy = goal.currency
  const saved = goal.scenarios?.savedPlan
  const required = goal.scenarios?.requiredPace
  const date = <DateText value={goal.targetDate} />

  if (goal.status === 'completed')
    return (
      <p>
        Goal complete! You reached <GoalCurrent goal={goal} className="font-medium" /> towards a target of <Money minor={goal.targetAmountMinor} currency={ccy} />. Reopen it if you want to keep
        tracking.
      </p>
    )
  if (goal.status === 'cancelled') return <p>This goal is cancelled. It no longer appears in your active goals or sends reminders. Reactivate it to start tracking again.</p>

  let body: ReactNode
  if (goal.trackingStatus === 'incomplete')
    body = (
      <>
        Whether this goal is on track can't be worked out yet: part of its current amount is missing
        {goal.missingCurrencies.length > 0 ? ' an exchange rate' : ' a price'}. Add the missing data and the projection updates straight away.
      </>
    )
  else if (goal.trackingStatus === 'on_track')
    body = saved ? (
      <>
        Saving <Money minor={saved.monthlyContributionMinor} currency={ccy} className="font-medium" /> a month at an assumed <Bps value={saved.annualReturnBps} /> return, you're projected to have{' '}
        <Money minor={saved.projectedAtTargetMinor} currency={ccy} className="font-medium" /> by {date}, which is <Percent value={saved.projectedProgressPercent} /> of the target.
      </>
    ) : (
      <>Your saved plan is projected to reach the target by {date}.</>
    )
  else
    body = saved ? (
      <>
        At <Money minor={saved.monthlyContributionMinor} currency={ccy} className="font-medium" /> a month you're projected to have{' '}
        <Money minor={saved.projectedAtTargetMinor} currency={ccy} className="font-medium" /> by {date}, only <Percent value={saved.projectedProgressPercent} /> of the target.
        {required && required.reachesTarget ? (
          <>
            {' '}
            Saving <Money minor={required.monthlyContributionMinor} currency={ccy} className="font-semibold text-accent" /> a month gets you there on time.
          </>
        ) : (
          <> Even a higher monthly amount may not close the gap by this date; consider a later target date.</>
        )}
      </>
    ) : (
      <>Your saved plan falls short of the target by {date}.</>
    )

  return (
    <p>
      {goal.status === 'paused' ? <span className="font-medium">Paused, so reminders are off. </span> : null}
      {body}
    </p>
  )
}

export function GoalHero({ goal }: { goal: Goal }) {
  const { today } = usePrefs()
  const plan = goal.plan
  return (
    <section aria-labelledby="goal-progress-title" className="card grid overflow-hidden md:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
      <div className="p-5 md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="goal-progress-title" className="text-sm font-medium text-muted">
            Saved so far
          </h2>
          <GoalStateBadge goal={goal} />
        </div>
        <p className="display mt-2 text-[1.75rem] leading-9 text-ink sm:text-[2.125rem] sm:leading-[2.5rem] xl:text-3xl">
          <GoalCurrent goal={goal} />
        </p>
        <p className="mt-1.5 text-sm text-muted">
          of <Money minor={goal.targetAmountMinor} currency={goal.currency} className="text-ink" /> target
        </p>
        <ProgressBar percent={goal.progressPercent} tone={progressTone(goal)} incomplete={goal.valueIncomplete} label={`${goal.name} progress`} className="mt-5" />
        <div className="mt-2 flex flex-wrap justify-between gap-x-4 text-sm text-muted">
          <span>
            {goal.valueIncomplete ? (
              'Progress incomplete'
            ) : (
              <>
                <Percent value={goal.progressPercent} className="font-medium text-ink" /> saved
              </>
            )}
          </span>
          <span>{timeLeftLabel(goal.targetDate, today)}</span>
        </div>
        <div className="mt-5 max-w-[62ch] border-t border-line pt-4 text-base leading-relaxed text-ink">
          <Explanation goal={goal} />
        </div>
      </div>
      <dl className="grid content-start divide-y divide-line border-t border-line bg-sunken/40 px-5 py-4 md:gap-5 md:divide-y-0 md:border-l md:border-t-0 md:p-7">
        <Fact label="Target">
          <Money minor={goal.targetAmountMinor} currency={goal.currency} />
        </Fact>
        <Fact label="Target date">
          <DateText value={goal.targetDate} />
        </Fact>
        <Fact label="Planned contribution">
          {plan && plan.plannedContributionMinor !== '0' ? (
            <>
              <Money minor={plan.plannedContributionMinor} currency={goal.currency} /> <span className="text-muted">{perFrequency(plan.frequency)}</span>
            </>
          ) : (
            <span className="text-muted">No plan set</span>
          )}
        </Fact>
        <Fact label="Assumed return">
          <Bps value={goal.assumedAnnualReturnBps} /> <span className="text-muted">a year</span>
        </Fact>
        <Fact label="Progress from">
          {goal.linkedAccount ? (
            <Link to={`/accounts/${goal.linkedAccount.id}`} className="link inline-flex max-w-full items-center gap-1.5">
              <Link2 size={14} aria-hidden className="shrink-0" />
              <span className="truncate">{goal.linkedAccount.name}</span>
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-muted">
              <PenLine size={14} aria-hidden />
              Manual amount
            </span>
          )}
        </Fact>
      </dl>
    </section>
  )
}
