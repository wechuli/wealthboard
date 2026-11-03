import { AlertTriangle, ArrowRight, Crown, LineChart } from 'lucide-react'
import { Link } from 'react-router'
import type { NetWorthStats } from '@/api/extensions'
import type { Dashboard, DashboardRange, HistoricalPoint } from '@/api/types'
import { ChartEmpty, ChartFrame } from '@/components/charts/ChartFrame'
import { TimeSeriesChart, type TSMarker } from '@/components/charts/TimeSeriesChart'
import { TOKENS } from '@/components/charts/utils'
import { DateText, Delta, Money } from '@/components/format'
import { Segmented } from '@/components/ui/Segmented'
import { cn } from '@/lib/cn'
import { toChartNumber } from '@/lib/money'
import { usePrefs } from '@/lib/prefs'
import { RANGE_OPTIONS, rangePhrase, useIsMdUp, useMoneyText } from '@/features/insights/common'

const PERIODS: { key: keyof Dashboard['periodChanges']; label: string }[] = [
  { key: 'threeMonths', label: '3 months' },
  { key: 'oneYear', label: '1 year' },
  { key: 'allTime', label: 'All time' },
]

/** The net-worth hero: one editorial block with the figure, its change, and its history. */
export function NetWorthHero({
  dash,
  range,
  onRange,
  highest,
  updating,
}: {
  dash: Dashboard
  range: DashboardRange
  onRange: (r: DashboardRange) => void
  highest: NetWorthStats['highest'] | undefined
  updating: boolean
}) {
  const ccy = dash.baseCurrency
  const t = dash.totals
  const { baseCurrency } = usePrefs()
  const missing = dash.missingCurrencies
  return (
    <section aria-labelledby="nw-hero" className="card overflow-hidden rounded-xl">
      <div className="grid lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col p-4 sm:p-6 lg:border-r lg:border-line lg:p-7">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id="nw-hero" className="text-md font-semibold text-ink">
              Net worth
            </h2>
            <p className="text-xs text-subtle">
              As of <DateText value={dash.asOf} />
            </p>
          </div>

          <p className="display mt-3 text-[1.875rem] leading-[2.375rem] text-ink sm:text-[2.25rem] sm:leading-[2.75rem] lg:text-[2.375rem] xl:text-[2.625rem] xl:leading-[3rem]">
            <span className={cn(!dash.currentComplete && 'incomplete-outline rounded-sm')}>
              <Money minor={t.netWorth} currency={ccy} />
            </span>
          </p>

          <p className="mt-2 text-base">
            <Delta minor={dash.periodChanges.oneMonth} currency={ccy} suffix="this month" emptyLabel={dash.currentComplete ? undefined : 'Change unavailable while values are incomplete'} />
          </p>

          {!dash.currentComplete ? (
            <p className="mt-3 flex items-start gap-1.5 text-sm text-warning">
              <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0" />
              <span>
                Incomplete: {missing.length ? <>excludes {missing.join(', ')} values until a rate is added.</> : <>some values are missing.</>}{' '}
                {missing[0] ? (
                  <Link to={`/settings/currencies?add=${missing[0]}-${baseCurrency}`} className="link font-medium">
                    Add {missing[0]}/{baseCurrency} rate
                  </Link>
                ) : null}
              </span>
            </p>
          ) : null}

          <dl className="mt-6 grid grid-cols-2 gap-x-4 border-t border-line pt-4">
            <div className="min-w-0">
              <dt className="text-xs text-muted">Assets</dt>
              <dd className="mt-0.5 truncate text-sm font-medium text-ink">
                <Money minor={t.assets} currency={ccy} />
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted">Liabilities</dt>
              <dd className="mt-0.5 truncate text-sm font-medium text-ink">
                <Money minor={t.liabilities} currency={ccy} />
              </dd>
            </div>
          </dl>

          <div className="mt-4 border-t border-line pt-3">
            <h3 className="sr-only">Change over time</h3>
            <ul className="flex flex-col">
              {PERIODS.map((p) => (
                <li key={p.key} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1 text-sm">
                  <span className="text-muted">{p.label}</span>
                  <Delta minor={dash.periodChanges[p.key]} currency={ccy} emptyLabel={dash.currentComplete ? undefined : 'Incomplete'} />
                </li>
              ))}
            </ul>
            <Link to="/insights/net-worth" className="link mt-3 inline-flex min-h-8 items-center gap-1 text-sm">
              Net-worth history <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
        </div>

        <div className="min-w-0 border-t border-line p-4 sm:p-6 lg:border-t-0 lg:p-7">
          <HeroChart dash={dash} range={range} onRange={onRange} highest={highest} updating={updating} />
        </div>
      </div>
    </section>
  )
}

function HeroChart({ dash, range, onRange, highest, updating }: { dash: Dashboard; range: DashboardRange; onRange: (r: DashboardRange) => void; highest: NetWorthStats['highest'] | undefined; updating: boolean }) {
  const ccy = dash.baseCurrency
  const isMd = useIsMdUp()
  const moneyText = useMoneyText()
  const history = dash.history
  const height = isMd ? 290 : 220
  const sparse = history.length < 2
  const highDay = highest?.date.slice(0, 10)
  const highPoint = highDay ? history.find((h) => h.date.slice(0, 10) === highDay) : undefined
  const markers: TSMarker[] = highPoint ? [{ date: highPoint.date, seriesId: 'nw', kind: 'high', label: 'All-time high' }] : []
  const incompleteCount = history.filter((h) => !h.complete).length
  const first = history[0]
  const last = history.at(-1)

  const summary =
    first && last
      ? `Net worth over ${rangePhrase(range)}: ${moneyText(first.netWorthMinor, ccy)} on ${first.date.slice(0, 10)} and ${moneyText(last.netWorthMinor, ccy)} on ${last.date.slice(0, 10)}.${highPoint ? ' The all-time high is marked.' : ''}${incompleteCount ? ` ${incompleteCount} points are incomplete and drawn dashed.` : ''}`
      : 'Not enough history to draw a net-worth chart yet.'

  return (
    <ChartFrame
      summary={summary}
      height={height}
      toolbar={
        <>
          <Segmented label="Chart range" value={range} onChange={onRange} options={RANGE_OPTIONS} />
          <span aria-live="polite" className="text-xs text-subtle">
            {updating ? 'Updating…' : ''}
          </span>
        </>
      }
      table={
        sparse
          ? undefined
          : {
              caption: `Net worth history, ${rangePhrase(range)}`,
              columns: [{ label: 'Date' }, { label: 'Net worth', align: 'right' }, { label: 'Assets', align: 'right' }, { label: 'Liabilities', align: 'right' }],
              rows: history.map((h) => [
                <span key="d" className="inline-flex items-center gap-1.5">
                  <DateText value={h.date} />
                  {!h.complete ? <span className="text-xs text-warning">Incomplete</span> : null}
                </span>,
                <Money key="n" minor={h.netWorthMinor} currency={ccy} />,
                <Money key="a" minor={h.assetsMinor} currency={ccy} />,
                <Money key="l" minor={h.liabilitiesMinor} currency={ccy} />,
              ]),
            }
      }
      caption={
        !sparse ? (
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {highPoint && highest ? (
              <span className="inline-flex items-center gap-1.5">
                <Crown size={13} aria-hidden style={{ color: TOKENS.gold }} />
                Highest <Money minor={highest.netWorthMinor} currency={ccy} compact /> on <DateText value={highest.date} />
              </span>
            ) : null}
            {incompleteCount ? (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block w-5 border-t-2 border-dashed border-warning" />
                Dashed where values are incomplete
              </span>
            ) : null}
          </span>
        ) : undefined
      }
    >
      {sparse ? (
        <div className="grid h-full place-items-center rounded-md border border-dashed border-line bg-sunken/40">
          <ChartEmpty icon={<LineChart size={18} aria-hidden />} title="Your history starts here">
            The chart draws itself after your next update. Each value you record adds a point.
          </ChartEmpty>
        </div>
      ) : (
        <TimeSeriesChart
          height={height}
          ariaLabel={`Net worth chart, ${rangePhrase(range)}`}
          series={[
            {
              id: 'nw',
              label: 'Net worth',
              color: TOKENS.accent,
              area: true,
              width: 2.25,
              points: history.map((h) => ({ date: h.date, value: toChartNumber(h.netWorthMinor, ccy), complete: h.complete })),
            },
          ]}
          markers={markers}
          renderTooltip={(i) => <HeroTooltip point={history[i]} ccy={ccy} isHigh={!!highPoint && history[i]?.date === highPoint.date} />}
        />
      )}
    </ChartFrame>
  )
}

function HeroTooltip({ point, ccy, isHigh }: { point: HistoricalPoint | undefined; ccy: string; isHigh: boolean }) {
  if (!point) return null
  return (
    <div>
      <p className="text-xs text-muted">
        <DateText value={point.date} />
      </p>
      <p className="mt-0.5 text-md font-semibold text-ink">
        <Money minor={point.netWorthMinor} currency={ccy} />
      </p>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted">Assets</dt>
        <dd className="text-right text-ink">
          <Money minor={point.assetsMinor} currency={ccy} />
        </dd>
        <dt className="text-muted">Liabilities</dt>
        <dd className="text-right text-ink">
          <Money minor={point.liabilitiesMinor} currency={ccy} />
        </dd>
      </dl>
      {isHigh ? (
        <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium" style={{ color: TOKENS.gold }}>
          <Crown size={12} aria-hidden /> All-time high
        </p>
      ) : null}
      {!point.complete ? (
        <p className="mt-1.5 flex items-start gap-1 text-xs text-warning">
          <AlertTriangle size={12} aria-hidden className="mt-0.5 shrink-0" />
          Incomplete: missing {point.missingCurrencies.length ? `${point.missingCurrencies.join(', ')} rate` : 'prices'}
        </p>
      ) : null}
    </div>
  )
}
