import { Check, FlaskConical, Info, RotateCcw, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { Goal, GoalScenario } from '@/api/types'
import { Bps, DateText, Money, Percent } from '@/components/format'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { AmountField, TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Skeleton } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/cn'
import { decimalToMinor, minorSign, minorToDecimal, PrecisionError, percentToBps } from '@/lib/money'
import { useGoalScenarios } from '@/lib/queries'
import { bpsToPercentInput } from './goalMeta'
import { useDebouncedValue } from './useDebouncedValue'

const DEBOUNCE_MS = 400

interface Parsed {
  params: { monthlyContributionMinor: string; annualReturnBps: number } | null
  monthlyError?: string
  returnError?: string
}

function parseInputs(monthly: string, annualReturn: string, currency: string): Parsed {
  let monthlyContributionMinor: string | null = null
  let annualReturnBps: number | null = null
  let monthlyError: string | undefined
  let returnError: string | undefined
  try {
    monthlyContributionMinor = decimalToMinor(monthly === '' ? '0' : monthly, currency)
    if (minorSign(monthlyContributionMinor) < 0) {
      monthlyContributionMinor = null
      monthlyError = 'Use zero or more'
    }
  } catch (e) {
    monthlyError = e instanceof PrecisionError ? e.message : 'Enter an amount'
  }
  try {
    annualReturnBps = percentToBps(annualReturn === '' ? '0' : annualReturn)
    if (annualReturnBps < 0 || annualReturnBps > 10_000) {
      annualReturnBps = null
      returnError = 'Use a return between 0% and 100%'
    }
  } catch (e) {
    returnError = e instanceof Error ? e.message : 'Enter a percentage'
  }
  return {
    params: monthlyContributionMinor !== null && annualReturnBps !== null ? { monthlyContributionMinor, annualReturnBps } : null,
    monthlyError,
    returnError,
  }
}

const SCENARIOS: {
  key: 'savedPlan' | 'requiredPace' | 'lowerReturn'
  title: string
  describe(edited: boolean): string
}[] = [
  {
    key: 'savedPlan',
    title: 'Saved plan',
    describe: (edited) => (edited ? 'Your amount and return from above' : 'Your plan as it is saved today'),
  },
  {
    key: 'requiredPace',
    title: 'Required pace',
    describe: () => 'The monthly amount that reaches the target by its date',
  },
  {
    key: 'lowerReturn',
    title: 'Lower return',
    describe: () => 'Your amount, with a more cautious return',
  },
]

function Row({ label, children, emphasis }: { label: string; children: ReactNode; emphasis?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className={cn('text-right', emphasis ? 'font-semibold text-accent' : 'text-ink')}>{children}</dd>
    </div>
  )
}

function ScenarioCard({
  title,
  description,
  scenario,
  currency,
  targetDate,
  highlightMonthly,
}: {
  title: string
  description: string
  scenario: GoalScenario
  currency: string
  targetDate: string
  highlightMonthly?: boolean
}) {
  return (
    <article className="card min-w-0 p-4 sm:grid sm:grid-cols-2 sm:gap-x-8 md:p-5 xl:block">
      <div className="min-w-0">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-md font-semibold text-ink">{title}</h3>
            <p className="mt-0.5 text-xs text-muted">{description}</p>
          </div>
          {scenario.reachesTarget ? (
            <Badge tone="positive" icon={<Check size={13} aria-hidden />}>
              Reaches target
            </Badge>
          ) : (
            <Badge tone="warning" icon={<X size={13} aria-hidden />}>
              Falls short
            </Badge>
          )}
        </header>
        <p className="mt-5 text-xs text-subtle">
          Projected by <DateText value={targetDate} />
        </p>
        <p className="mt-1 text-lg font-semibold text-ink">
          <Money minor={scenario.projectedAtTargetMinor} currency={currency} />
        </p>
        <ProgressBar percent={scenario.projectedProgressPercent} tone={scenario.reachesTarget ? 'positive' : 'warning'} label={`${title}: projected progress`} className="mt-3" />
        <p className="mt-1.5 text-xs text-muted">
          <Percent value={scenario.projectedProgressPercent} className="font-medium text-ink" /> of the target
        </p>
      </div>
      <dl className="mt-4 divide-y divide-line border-t border-line text-sm sm:mt-0 sm:border-t-0 xl:mt-4 xl:border-t">
        <Row label="Monthly contribution" emphasis={highlightMonthly}>
          <Money minor={scenario.monthlyContributionMinor} currency={currency} />
        </Row>
        <Row label="Annual return">
          <Bps value={scenario.annualReturnBps} />
        </Row>
        <Row label="New contributions">
          <Money minor={scenario.newContributionsMinor} currency={currency} />
        </Row>
        <Row label="Estimated growth">
          <Money minor={scenario.estimatedGrowthMinor} currency={currency} sign="always" />
        </Row>
        <Row label="Estimated completion">{scenario.estimatedCompletion ? <DateText value={scenario.estimatedCompletion} /> : <span className="text-muted">Not within 50 years</span>}</Row>
      </dl>
    </article>
  )
}

function ScenarioSkeleton() {
  return (
    <div className="card p-4 md:p-5">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="mt-2 h-3 w-48 max-w-full" />
      <Skeleton className="mt-6 h-6 w-40" />
      <Skeleton className="mt-3 h-2 w-full rounded-full" />
      <div className="mt-5 grid gap-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </div>
  )
}

/** What-if exploration. Inputs fetch fresh scenarios from the data layer and are never saved to the goal. */
export function WhatIfPanel({ goal }: { goal: Goal }) {
  const initialMonthly = useMemo(() => {
    const minor = goal.scenarios?.savedPlan.monthlyContributionMinor ?? (goal.plan?.frequency === 'monthly' ? goal.plan.plannedContributionMinor : '0')
    return minorToDecimal(minor, goal.currency)
  }, [goal])
  const initialReturn = useMemo(() => bpsToPercentInput(goal.assumedAnnualReturnBps), [goal.assumedAnnualReturnBps])

  const [monthly, setMonthly] = useState(initialMonthly)
  const [annualReturn, setAnnualReturn] = useState(initialReturn)
  const edited = monthly !== initialMonthly || annualReturn !== initialReturn

  const now = parseInputs(monthly, annualReturn, goal.currency)
  const debouncedMonthly = useDebouncedValue(monthly, DEBOUNCE_MS)
  const debouncedReturn = useDebouncedValue(annualReturn, DEBOUNCE_MS)
  const settled = debouncedMonthly === monthly && debouncedReturn === annualReturn
  const params = useMemo(() => parseInputs(debouncedMonthly, debouncedReturn, goal.currency).params, [debouncedMonthly, debouncedReturn, goal.currency])

  const scenarios = useGoalScenarios(goal.id, params)
  const updating = (!settled && !!now.params) || (scenarios.isFetching && !scenarios.isPending)
  const data = scenarios.data ?? goal.scenarios ?? undefined

  const reset = () => {
    setMonthly(initialMonthly)
    setAnnualReturn(initialReturn)
  }

  return (
    <section aria-labelledby="whatif-title" className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="whatif-title" className="text-lg font-semibold text-ink">
            What if…
          </h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
            <FlaskConical size={15} aria-hidden className="shrink-0 text-info" />
            Exploring only. These changes are not saved to your goal.
          </p>
        </div>
        <Button size="sm" variant="ghost" icon={<RotateCcw size={15} aria-hidden />} onClick={reset} disabled={!edited}>
          Reset to saved plan
        </Button>
      </div>

      <div className="rounded-lg border border-dashed border-line-strong/70 bg-sunken/50 p-4 md:p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto] lg:items-start">
          <AmountField
            label="Monthly contribution"
            currency={goal.currency}
            value={monthly}
            onChange={setMonthly}
            error={now.monthlyError}
            hint={edited ? 'Edited for this exploration only' : 'From your saved plan'}
          />
          <TextField
            label="Annual return"
            inputMode="decimal"
            autoComplete="off"
            value={annualReturn}
            onChange={(e) => {
              const v = e.target.value.replace(/[%\s]/g, '')
              if (/^\d{0,3}(\.\d{0,2})?$/.test(v)) setAnnualReturn(v)
            }}
            error={now.returnError}
            hint="Percent per year, before fees and tax"
            className="[&_input]:text-right [&_input]:tabular-nums"
          />
          <div className="flex min-h-6 items-center gap-2 text-xs text-subtle sm:col-span-2 lg:col-span-1 lg:pt-8" aria-live="polite">
            {updating ? (
              <>
                <Spinner size={13} />
                Recalculating
              </>
            ) : edited ? (
              <Badge tone="info">Not saved</Badge>
            ) : null}
          </div>
        </div>
      </div>

      {scenarios.isError && !data ? (
        <div className="card">
          <ErrorState compact error={scenarios.error} onRetry={() => void scenarios.refetch()} title="Scenarios couldn't be calculated" />
        </div>
      ) : !data ? (
        <div className="grid gap-4 xl:grid-cols-3" role="status" aria-label="Calculating scenarios">
          <ScenarioSkeleton />
          <ScenarioSkeleton />
          <ScenarioSkeleton />
        </div>
      ) : (
        <>
          {goal.valueIncomplete ? (
            <Notice tone="warning" title="These scenarios start from an incomplete value">
              Part of this goal's current amount is missing, so every projection below may be understated.
            </Notice>
          ) : null}
          <div className={cn('grid gap-4 xl:grid-cols-3 transition-opacity duration-[var(--dur-2)]', updating && 'opacity-60')} aria-busy={updating || undefined}>
            {SCENARIOS.map((s) => (
              <ScenarioCard
                key={s.key}
                title={s.title}
                description={s.describe(edited)}
                scenario={data[s.key]}
                currency={goal.currency}
                targetDate={goal.targetDate}
                highlightMonthly={s.key === 'requiredPace' && data.requiredPace.monthlyContributionMinor !== data.savedPlan.monthlyContributionMinor}
              />
            ))}
          </div>
        </>
      )}

      <aside aria-labelledby="assumptions-title" className="flex gap-3 rounded-lg border border-line px-4 py-3.5 text-sm">
        <Info size={17} aria-hidden className="mt-0.5 shrink-0 text-info" />
        <div className="min-w-0">
          <h3 id="assumptions-title" className="font-medium text-ink">
            How these projections work
          </h3>
          <ul className="mt-1.5 grid gap-x-6 gap-y-1 text-muted sm:grid-cols-2">
            <li>Returns compound monthly at the assumed annual rate.</li>
            <li>Contributions arrive at the end of each month.</li>
            <li>The target amount and target date stay fixed.</li>
            <li>No fees, taxes, or inflation are included.</li>
          </ul>
          <p className="mt-2 text-xs text-subtle">Projections are estimates, not guarantees.</p>
        </div>
      </aside>
    </section>
  )
}
