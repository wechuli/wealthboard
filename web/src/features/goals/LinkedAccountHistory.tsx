import { ArrowUpRight, LineChart, PenLine } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import type { Goal } from '@/api/types'
import { ChartEmpty, ChartFrame } from '@/components/charts/ChartFrame'
import { TimeSeriesChart, type TSSeries } from '@/components/charts/TimeSeriesChart'
import { chartColor } from '@/components/charts/utils'
import { DateText, Money } from '@/components/format'
import { buttonClass } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { formatMoney, maskedMoney, toChartNumber } from '@/lib/money'
import { formatDate } from '@/lib/dates'
import { usePrefs } from '@/lib/prefs'
import { usePrivacy } from '@/lib/privacy'
import { useAccountAnalytics } from '@/lib/queries'

function History({ accountId, accountName, goalCurrency }: { accountId: string; accountName: string; goalCurrency: string }) {
  const { hidden } = usePrivacy()
  const { dateFormat, timezone } = usePrefs()
  const query = useAccountAnalytics(accountId)
  const data = query.data
  const series = useMemo<TSSeries[]>(
    () =>
      data
        ? [
            {
              id: 'value',
              label: accountName,
              color: chartColor(2),
              area: true,
              points: data.history.map((p) => ({
                date: p.date,
                value: toChartNumber(p.valueMinor, data.currency),
                complete: p.complete,
              })),
            },
          ]
        : [],
    [data, accountName],
  )

  if (query.isPending) return <Skeleton className="h-[220px] w-full" label="Loading account history" />
  if (query.isError) return <ErrorState compact error={query.error} onRetry={() => void query.refetch()} title="Account history couldn't be loaded" />

  const ccy = query.data.currency
  const history = query.data.history
  const first = history[0]
  const last = history.at(-1)
  const money = (m: string) => (hidden ? maskedMoney(ccy) : formatMoney(m, ccy))
  const summary =
    first && last
      ? `${accountName} went from ${money(first.valueMinor)} on ${formatDate(first.date, dateFormat, timezone)} to ${money(last.valueMinor)} on ${formatDate(last.date, dateFormat, timezone)}.`
      : `${accountName} has no value history yet.`
  const anyIncomplete = history.some((p) => !p.complete)

  return (
    <>
      <ChartFrame
        summary={summary}
        height={220}
        empty={
          history.length < 2 ? (
            <ChartEmpty title="Not enough history yet" icon={<LineChart size={18} aria-hidden />}>
              The chart appears once the account has at least two recorded values.
            </ChartEmpty>
          ) : undefined
        }
        table={{
          caption: `${accountName} value history`,
          columns: [{ label: 'Date' }, { label: 'Value', align: 'right' }],
          rows: history.map((p) => [<DateText key="d" value={p.date} />, <Money key="v" minor={p.valueMinor} currency={ccy} />]),
        }}
        caption={anyIncomplete ? 'Dashed segments and hollow points mark values with missing prices or exchange rates.' : undefined}
      >
        <TimeSeriesChart
          series={series}
          height={220}
          ariaLabel={`${accountName} value history`}
          renderTooltip={(i) => {
            const p = history[i]
            if (!p) return null
            return (
              <div className="grid gap-0.5">
                <DateText value={p.date} className="text-xs text-muted" />
                <Money minor={p.valueMinor} currency={ccy} className="font-semibold text-ink" />
                {!p.complete ? <span className="text-xs text-warning">Incomplete: missing price or rate</span> : null}
              </div>
            )
          }}
        />
      </ChartFrame>
      {ccy !== goalCurrency ? (
        <p className="mt-3 text-xs text-muted">
          Shown in {ccy}, the account's currency. The goal converts it to {goalCurrency} at the latest exchange rate.
        </p>
      ) : null}
    </>
  )
}

/** The linked account is the source of truth for progress; manual goals say so plainly. */
export function LinkedAccountHistory({ goal }: { goal: Goal }) {
  const linked = goal.linkedAccount
  if (!linked)
    return (
      <Card aria-labelledby="progress-source-title">
        <CardHeader id="progress-source-title" title="Manual amount" description="This goal isn't linked to an account" />
        <CardBody>
          <div className="flex gap-3 rounded-md border border-line bg-sunken/50 px-4 py-3.5">
            <PenLine size={18} aria-hidden className="mt-0.5 shrink-0 text-subtle" />
            <div className="min-w-0 text-sm">
              <p className="text-ink">
                Progress is the amount you entered: <Money minor={goal.currentAmountMinor} currency={goal.currentAmountCurrency} className="font-medium" />.
              </p>
              <p className="mt-1 text-muted">It changes only when you update it. Linking an account instead makes its value the goal's progress, with no double counting.</p>
            </div>
          </div>
        </CardBody>
      </Card>
    )
  return (
    <Card aria-labelledby="progress-source-title">
      <CardHeader
        id="progress-source-title"
        title={linked.name}
        description="Linked account. Its value is this goal's progress."
        action={
          <Link to={`/accounts/${linked.id}`} className={buttonClass({ size: 'sm', variant: 'ghost' })}>
            Open account
            <ArrowUpRight size={15} aria-hidden />
          </Link>
        }
      />
      <CardBody>
        <History accountId={linked.id} accountName={linked.name} goalCurrency={goal.currency} />
      </CardBody>
    </Card>
  )
}
