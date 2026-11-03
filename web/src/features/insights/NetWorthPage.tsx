import { AlertTriangle, BarChart3, Crown, LineChart } from 'lucide-react'
import type { NetWorthStats } from '@/api/extensions'
import { BarChart } from '@/components/charts/BarChart'
import { ChartEmpty, ChartFrame } from '@/components/charts/ChartFrame'
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart'
import { chartColor, TOKENS } from '@/components/charts/utils'
import { DateText, Delta, Money, Percent } from '@/components/format'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { cn } from '@/lib/cn'
import { formatMonthLong } from '@/lib/dates'
import { minorSign, toChartNumber } from '@/lib/money'
import { usePrefs } from '@/lib/prefs'
import { useNetWorthStats } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { EmptyPortfolio, IncompleteTotalsNotice, InsightsSkeleton, monthTick, useIsMdUp, useMoneyText } from './common'

type Month = NetWorthStats['months'][number]

export default function NetWorthPage() {
  usePageTitle('Net-worth history')
  const q = useNetWorthStats()
  if (q.isPending) return <InsightsSkeleton charts={2} />
  if (q.isError)
    return (
      <div className="card">
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Net-worth history could not be loaded" />
      </div>
    )
  const stats = q.data
  if (stats.months.length === 0) return <EmptyPortfolio what="Net-worth history and trends" />
  return <NetWorthInsights stats={stats} />
}

function MonthLabel({ date }: { date: string }) {
  const { timezone } = usePrefs()
  if (date.endsWith('-01')) return <span className="whitespace-nowrap">{formatMonthLong(date, timezone)}</span>
  return <DateText value={date} />
}

function NetWorthInsights({ stats }: { stats: NetWorthStats }) {
  const ccy = stats.baseCurrency
  const isMd = useIsMdUp()
  const { timezone } = usePrefs()
  const moneyText = useMoneyText()
  const months = stats.months
  const sparse = months.length < 2
  const first = months[0]
  const last = months.at(-1)
  const hasHigh = months.some((m) => m.month === stats.highest.date)
  const incomplete = months.filter((m) => !m.complete).length

  return (
    <div className="flex flex-col gap-6">
      {!stats.complete ? <IncompleteTotalsNotice scope="historical totals" /> : null}

      <StatStrip stats={stats} />

      <Card aria-labelledby="nw-monthly">
        <CardHeader id="nw-monthly" title="Net worth by month" description="Month-end values in your base currency, with the highest recorded value marked." />
        <CardBody>
          <ChartFrame
            height={isMd ? 300 : 230}
            summary={
              first && last
                ? `Net worth from ${moneyText(first.netWorthMinor, ccy)} on ${first.month} to ${moneyText(last.netWorthMinor, ccy)} on ${last.month}, across ${months.length} points. Highest recorded ${moneyText(stats.highest.netWorthMinor, ccy)} on ${stats.highest.date}.`
                : 'Not enough history yet.'
            }
            empty={sparse ? <SparseEmpty /> : undefined}
            table={{
              caption: 'Net worth by month',
              columns: [{ label: 'Month' }, { label: 'Net worth', align: 'right' }, { label: 'Change', align: 'right' }],
              rows: months.map((m) => [<MonthLabel key="m" date={m.month} />, <Money key="n" minor={m.netWorthMinor} currency={ccy} />, <Delta key="c" minor={m.changeMinor} currency={ccy} />]),
            }}
            caption={
              <span className="flex flex-wrap gap-x-4 gap-y-1">
                <span className="inline-flex items-center gap-1.5">
                  <Crown size={13} aria-hidden style={{ color: TOKENS.gold }} /> Highest recorded
                </span>
                {incomplete ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="inline-block w-5 border-t-2 border-dashed border-warning" /> Dashed where a month is incomplete
                  </span>
                ) : null}
              </span>
            }
          >
            <TimeSeriesChart
              height={isMd ? 300 : 230}
              ariaLabel="Net worth by month"
              series={[{ id: 'nw', label: 'Net worth', color: TOKENS.accent, area: true, width: 2.25, points: months.map((m) => ({ date: m.month, value: toChartNumber(m.netWorthMinor, ccy), complete: m.complete })) }]}
              markers={hasHigh ? [{ date: stats.highest.date, seriesId: 'nw', kind: 'high', label: 'Highest' }] : []}
              renderTooltip={(i) => <MonthTooltip m={months[i]} ccy={ccy} high={months[i]?.month === stats.highest.date} />}
            />
          </ChartFrame>
        </CardBody>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card aria-labelledby="nw-al">
          <CardHeader id="nw-al" title="Assets and liabilities" description="What you own and what you owe, month by month." />
          <CardBody>
            <ChartFrame
              height={240}
              summary={first && last ? `Assets went from ${moneyText(first.assetsMinor, ccy)} to ${moneyText(last.assetsMinor, ccy)}; liabilities from ${moneyText(first.liabilitiesMinor, ccy)} to ${moneyText(last.liabilitiesMinor, ccy)}.` : 'Not enough history yet.'}
              empty={sparse ? <SparseEmpty /> : undefined}
              toolbar={
                <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
                  <li className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="inline-block h-0.5 w-4 rounded" style={{ background: chartColor(0) }} /> Assets
                  </li>
                  <li className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="inline-block h-0.5 w-4 rounded" style={{ background: TOKENS.negative }} /> Liabilities
                  </li>
                </ul>
              }
              table={{
                caption: 'Assets and liabilities by month',
                columns: [{ label: 'Month' }, { label: 'Assets', align: 'right' }, { label: 'Liabilities', align: 'right' }],
                rows: months.map((m) => [<MonthLabel key="m" date={m.month} />, <Money key="a" minor={m.assetsMinor} currency={ccy} />, <Money key="l" minor={m.liabilitiesMinor} currency={ccy} />]),
              }}
            >
              <TimeSeriesChart
                height={240}
                ariaLabel="Assets and liabilities by month"
                includeZero
                series={[
                  { id: 'assets', label: 'Assets', color: chartColor(0), points: months.map((m) => ({ date: m.month, value: toChartNumber(m.assetsMinor, ccy), complete: m.complete })) },
                  { id: 'liab', label: 'Liabilities', color: TOKENS.negative, points: months.map((m) => ({ date: m.month, value: toChartNumber(m.liabilitiesMinor, ccy), complete: m.complete })) },
                ]}
                renderTooltip={(i) => <ALTooltip m={months[i]} ccy={ccy} />}
              />
            </ChartFrame>
          </CardBody>
        </Card>

        <Card aria-labelledby="nw-change">
          <CardHeader id="nw-change" title="Monthly change" description="Gains and losses in net worth from one point to the next." />
          <CardBody>
            <ChartFrame
              height={240}
              summary={`Monthly net-worth change across ${months.length} points. ${months.filter((m) => m.changeMinor && minorSign(m.changeMinor) > 0).length} rose and ${months.filter((m) => m.changeMinor && minorSign(m.changeMinor) < 0).length} fell.`}
              empty={sparse ? <SparseEmpty bars /> : undefined}
              toolbar={
                <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
                  <li className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="inline-block size-2.5 rounded-[3px]" style={{ background: TOKENS.positive }} /> ▲ Gain
                  </li>
                  <li className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="inline-block size-2.5 rounded-[3px]" style={{ background: TOKENS.negative }} /> ▼ Loss
                  </li>
                </ul>
              }
              table={{
                caption: 'Monthly change in net worth',
                columns: [{ label: 'Month' }, { label: 'Change', align: 'right' }],
                rows: months.map((m) => [<MonthLabel key="m" date={m.month} />, <Delta key="c" minor={m.changeMinor} currency={ccy} />]),
              }}
            >
              <BarChart
                height={240}
                ariaLabel="Monthly change in net worth"
                colorBySign
                series={[{ id: 'change', label: 'Change', color: TOKENS.accent }]}
                data={months.map((m) => ({
                  key: m.month,
                  label: monthTick(m.month, timezone),
                  complete: m.complete && m.changeMinor !== null,
                  segments: m.changeMinor === null ? [] : [{ seriesId: 'change', value: toChartNumber(m.changeMinor, ccy) }],
                }))}
                renderTooltip={(i) => <ChangeTooltip m={months[i]} ccy={ccy} />}
              />
            </ChartFrame>
          </CardBody>
        </Card>
      </div>

      <MonthlyLedger months={months} ccy={ccy} highest={stats.highest.date} />
    </div>
  )
}

function SparseEmpty({ bars }: { bars?: boolean }) {
  return (
    <ChartEmpty icon={bars ? <BarChart3 size={18} aria-hidden /> : <LineChart size={18} aria-hidden />} title="Not enough history yet">
      Trends need at least two months of values. Keep your accounts current and this fills in on its own.
    </ChartEmpty>
  )
}

function StatStrip({ stats }: { stats: NetWorthStats }) {
  const ccy = stats.baseCurrency
  const yoy = stats.yearOverYear
  const since = stats.sinceStart
  return (
    <section aria-labelledby="nw-stats" className="card">
      <h2 id="nw-stats" className="sr-only">
        Key figures
      </h2>
      <dl className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="min-w-0 p-4 md:p-5">
          <dt className="text-sm text-muted">Year over year</dt>
          <dd className="mt-1.5">
            <span className="flex flex-wrap items-baseline gap-x-2 text-lg">
              <Delta minor={yoy.changeMinor} currency={ccy} />
              {yoy.changePercent !== null ? <Percent value={yoy.changePercent} sign="always" className="text-sm text-muted" /> : null}
            </span>
            <span className="mt-1 block text-xs text-subtle">
              <DateText value={yoy.fromDate} /> to <DateText value={yoy.toDate} />
            </span>
          </dd>
        </div>
        <div className="min-w-0 p-4 md:p-5">
          <dt className="flex items-center gap-1.5 text-sm text-muted">
            <Crown size={14} aria-hidden style={{ color: TOKENS.gold }} /> Highest recorded
          </dt>
          <dd className="mt-1.5">
            <span className="block text-lg font-semibold text-ink">
              <Money minor={stats.highest.netWorthMinor} currency={ccy} />
            </span>
            <span className="mt-1 block text-xs text-subtle">
              On <DateText value={stats.highest.date} />
            </span>
          </dd>
        </div>
        <div className="min-w-0 p-4 md:p-5">
          <dt className="text-sm text-muted">Since tracking began</dt>
          <dd className="mt-1.5">
            <span className="flex flex-wrap items-baseline gap-x-2 text-lg">
              <Delta minor={since.changeMinor} currency={ccy} />
              {since.changePercent !== null ? <Percent value={since.changePercent} sign="always" className="text-sm text-muted" /> : null}
            </span>
            <span className="mt-1 block text-xs text-subtle">
              From <Money minor={since.startMinor} currency={ccy} /> on <DateText value={since.startDate} />
            </span>
          </dd>
        </div>
      </dl>
    </section>
  )
}

function HighMark() {
  return (
    <span className="inline-flex items-center" style={{ color: TOKENS.gold }}>
      <Crown size={13} aria-hidden />
      <span className="sr-only">Highest recorded</span>
    </span>
  )
}

function IncompleteLine() {
  return (
    <p className="mt-1.5 flex items-start gap-1 text-xs text-warning">
      <AlertTriangle size={12} aria-hidden className="mt-0.5 shrink-0" /> Incomplete: a rate or price is missing for this month
    </p>
  )
}

function MonthTooltip({ m, ccy, high }: { m: Month | undefined; ccy: string; high: boolean }) {
  if (!m) return null
  return (
    <div>
      <p className="text-xs text-muted">
        <MonthLabel date={m.month} />
      </p>
      <p className="mt-0.5 text-md font-semibold text-ink">
        <Money minor={m.netWorthMinor} currency={ccy} />
      </p>
      <p className="mt-1 text-xs">
        <Delta minor={m.changeMinor} currency={ccy} suffix="vs previous" />
      </p>
      {high ? (
        <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium" style={{ color: TOKENS.gold }}>
          <Crown size={12} aria-hidden /> Highest recorded
        </p>
      ) : null}
      {!m.complete ? <IncompleteLine /> : null}
    </div>
  )
}

function ALTooltip({ m, ccy }: { m: Month | undefined; ccy: string }) {
  if (!m) return null
  return (
    <div>
      <p className="text-xs text-muted">
        <MonthLabel date={m.month} />
      </p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="inline-flex items-center gap-1.5 text-muted">
          <span aria-hidden className="size-2 rounded-full" style={{ background: chartColor(0) }} /> Assets
        </dt>
        <dd className="text-right text-ink">
          <Money minor={m.assetsMinor} currency={ccy} />
        </dd>
        <dt className="inline-flex items-center gap-1.5 text-muted">
          <span aria-hidden className="size-2 rounded-full" style={{ background: TOKENS.negative }} /> Liabilities
        </dt>
        <dd className="text-right text-ink">
          <Money minor={m.liabilitiesMinor} currency={ccy} />
        </dd>
        <dt className="text-muted">Net worth</dt>
        <dd className="text-right font-semibold text-ink">
          <Money minor={m.netWorthMinor} currency={ccy} />
        </dd>
      </dl>
      {!m.complete ? <IncompleteLine /> : null}
    </div>
  )
}

function ChangeTooltip({ m, ccy }: { m: Month | undefined; ccy: string }) {
  if (!m) return null
  return (
    <div>
      <p className="text-xs text-muted">
        <MonthLabel date={m.month} />
      </p>
      <p className="mt-0.5 text-sm">
        {m.changeMinor === null && !m.complete ? <span className="text-warning">Change unavailable: this or the previous month is incomplete</span> : <Delta minor={m.changeMinor} currency={ccy} />}
      </p>
      <p className="mt-1 text-xs text-muted">
        Net worth <Money minor={m.netWorthMinor} currency={ccy} />
      </p>
    </div>
  )
}

/** Every point, newest first: a table from 768 px, a list below. */
function MonthlyLedger({ months, ccy, highest }: { months: Month[]; ccy: string; highest: string }) {
  const rows = [...months].reverse()
  return (
    <Card aria-labelledby="nw-ledger">
      <CardHeader id="nw-ledger" title="Monthly ledger" description="Every recorded point, newest first." />
      <CardBody className="px-0 pb-2 md:px-0 md:pb-2">
        <div className="hidden md:block">
          <table className="w-full text-sm">
            <caption className="sr-only">Net worth by month, newest first</caption>
            <thead className="border-y border-line bg-sunken/60 text-xs text-muted">
              <tr>
                <th scope="col" className="px-5 py-2 text-left font-medium">
                  Month
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Assets
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Liabilities
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Net worth
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  Change
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.month} className="border-b border-line last:border-b-0 hover:bg-sunken/40">
                  <th scope="row" className="px-5 py-2.5 text-left font-normal text-ink">
                    <span className="inline-flex items-center gap-2">
                      <MonthLabel date={m.month} />
                      {m.month === highest ? <HighMark /> : null}
                      {!m.complete ? <span className="text-xs text-warning">Incomplete</span> : null}
                    </span>
                  </th>
                  <td className="px-3 py-2.5 text-right text-muted">
                    <Money minor={m.assetsMinor} currency={ccy} />
                  </td>
                  <td className="px-3 py-2.5 text-right text-muted">
                    <Money minor={m.liabilitiesMinor} currency={ccy} />
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium text-ink">
                    <Money minor={m.netWorthMinor} currency={ccy} />
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <Delta minor={m.changeMinor} currency={ccy} className="justify-end" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="md:hidden">
          {rows.map((m) => (
            <li key={m.month} className={cn('flex items-start justify-between gap-3 border-t border-line px-4 py-3')}>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  <MonthLabel date={m.month} />
                  {m.month === highest ? <HighMark /> : null}
                </p>
                {!m.complete ? <p className="text-xs text-warning">Incomplete</p> : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5 text-sm">
                <Money minor={m.netWorthMinor} currency={ccy} className="font-medium text-ink" />
                <Delta minor={m.changeMinor} currency={ccy} className="text-xs" />
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}
