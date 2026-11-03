import { AlertTriangle, LineChart } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import type { Goal } from '@/api/types'
import { ChartEmpty, ChartFrame } from '@/components/charts/ChartFrame'
import { TimeSeriesChart, type TSSeries } from '@/components/charts/TimeSeriesChart'
import { chartColor, TOKENS } from '@/components/charts/utils'
import { DateText, Money } from '@/components/format'
import { formatDate } from '@/lib/dates'
import { formatMoney, maskedMoney, toChartNumber } from '@/lib/money'
import { usePrefs } from '@/lib/prefs'
import { usePrivacy } from '@/lib/privacy'
import { missingRateHref } from './goalMeta'

function LegendSwatch({ color, dashed, label }: { color: string; dashed?: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <svg width="18" height="6" aria-hidden className="shrink-0">
        <line x1="1" x2="17" y1="3" y2="3" style={{ stroke: color }} strokeWidth={2} strokeLinecap="round" strokeDasharray={dashed ? '4 3' : undefined} />
      </svg>
      {label}
    </span>
  )
}

/** Server-computed projection: projected balance, cumulative contributions, target line, and target-date marker. */
export function ProjectionChart({ goal }: { goal: Goal }) {
  const { hidden } = usePrivacy()
  const { dateFormat, timezone } = usePrefs()
  const ccy = goal.currency
  const points = goal.projection
  const complete = !goal.valueIncomplete

  const series = useMemo<TSSeries[]>(
    () => [
      {
        id: 'projected',
        label: 'Projected balance',
        color: TOKENS.accent,
        area: true,
        width: 2.25,
        points: points.map((p) => ({
          date: p.date,
          value: toChartNumber(p.projectedMinor, ccy),
          complete,
        })),
      },
      {
        id: 'contributions',
        label: 'Saved plus contributions',
        color: chartColor(0),
        dashed: true,
        width: 1.75,
        points: points.map((p) => ({
          date: p.date,
          value: toChartNumber(p.contributionsMinor, ccy),
          complete,
        })),
      },
    ],
    [points, ccy, complete],
  )

  const money = (minor: string) => (hidden ? maskedMoney(ccy) : formatMoney(minor, ccy))
  const first = points[0]
  const last = points.at(-1)
  const targetDateText = formatDate(goal.targetDate, dateFormat, timezone)
  const summary =
    first && last
      ? `Projected balance grows from ${money(first.projectedMinor)} today to ${money(last.projectedMinor)} by ${targetDateText}, against a target of ${money(goal.targetAmountMinor)}. Your saved amount plus planned contributions comes to ${money(last.contributionsMinor)}.`
      : 'No projection is available for this goal.'

  const rateHref = missingRateHref(goal)
  const empty =
    goal.valueIncomplete && rateHref ? (
      <ChartEmpty title="Projection unavailable" icon={<AlertTriangle size={18} aria-hidden />}>
        It starts from the current amount, which needs the {goal.missingCurrencies[0]} → {goal.currency} exchange rate.{' '}
        <Link to={rateHref} className="link">
          Add the rate
        </Link>
      </ChartEmpty>
    ) : points.length < 2 ? (
      <ChartEmpty title="Nothing left to project" icon={<LineChart size={18} aria-hidden />}>
        {goal.status === 'completed' ? 'This goal is complete.' : 'The target date is this month or has passed, so there are no future months to project.'}
      </ChartEmpty>
    ) : undefined

  return (
    <ChartFrame
      summary={summary}
      height={300}
      empty={empty}
      toolbar={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <LegendSwatch color={TOKENS.accent} label="Projected balance" />
          <LegendSwatch color={chartColor(0)} dashed label="Saved plus contributions" />
          <LegendSwatch color={TOKENS.text} dashed label="Target" />
        </div>
      }
      table={{
        caption: `${goal.name} projection by month`,
        columns: [{ label: 'Month end' }, { label: 'Projected balance', align: 'right' }, { label: 'Saved plus contributions', align: 'right' }, { label: 'Target', align: 'right' }],
        rows: points.map((p) => [
          <DateText key="d" value={p.date} />,
          <Money key="p" minor={p.projectedMinor} currency={ccy} />,
          <Money key="c" minor={p.contributionsMinor} currency={ccy} />,
          <Money key="t" minor={p.targetMinor} currency={ccy} />,
        ]),
      }}
      caption={
        empty
          ? undefined
          : goal.valueIncomplete
            ? 'Dashed with hollow points: the starting value is incomplete, so the whole projection is too.'
            : `Assumes the saved plan and a constant return. The vertical marker is the target date (${targetDateText}).`
      }
    >
      <TimeSeriesChart
        series={series}
        height={300}
        ariaLabel={`${goal.name} projection`}
        includeZero
        refLines={[
          {
            value: toChartNumber(goal.targetAmountMinor, ccy),
            label: hidden ? 'Target' : `Target ${formatMoney(goal.targetAmountMinor, ccy, { compact: true })}`,
            color: TOKENS.text,
          },
        ]}
        vLines={[{ date: goal.targetDate, label: 'Target date' }]}
        renderTooltip={(i) => {
          const p = points[i]
          if (!p) return null
          return (
            <div className="grid gap-1">
              <DateText value={p.date} className="text-xs text-muted" />
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted">Projected</span>
                <Money minor={p.projectedMinor} currency={ccy} className="font-semibold text-ink" />
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted">Contributions</span>
                <Money minor={p.contributionsMinor} currency={ccy} className="text-ink" />
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted">Target</span>
                <Money minor={p.targetMinor} currency={ccy} className="text-ink" />
              </div>
              {!complete ? <span className="text-xs text-warning">Incomplete: the starting value is missing data</span> : null}
            </div>
          )
        }}
      />
    </ChartFrame>
  )
}
