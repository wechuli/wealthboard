import { BarChart3, Coins } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { IncomeReport, MonthlyFlowPoint } from '@/api/extensions'
import { BarChart, type BarSeries } from '@/components/charts/BarChart'
import { ChartEmpty, ChartFrame } from '@/components/charts/ChartFrame'
import { chartColor } from '@/components/charts/utils'
import { DateText, Money, Unavailable } from '@/components/format'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { Segmented } from '@/components/ui/Segmented'
import { cn } from '@/lib/cn'
import { formatMonthLong } from '@/lib/dates'
import { toChartNumber } from '@/lib/money'
import { usePrefs } from '@/lib/prefs'
import { useAccounts, useFlows, useIncome } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { EmptyPortfolio, FlowsBridge, FlowsIncomplete, InsightsSkeleton, monthTick, negateMinor, RANGE_OPTIONS, rangePhrase, SignedMoney, useIsMdUp, useMoneyText, useRangeParam } from './common'

const SERIES: (BarSeries & { key: keyof MonthlyFlowPoint; outflow?: boolean })[] = [
  { id: 'contributions', key: 'contributionsMinor', label: 'Contributions', color: chartColor(0) },
  { id: 'income', key: 'incomeMinor', label: 'Interest and dividends', color: chartColor(2) },
  { id: 'growth', key: 'growthMinor', label: 'Growth', color: chartColor(1) },
  { id: 'withdrawals', key: 'withdrawalsMinor', label: 'Withdrawals', color: chartColor(3), outflow: true },
  { id: 'fees', key: 'feesMinor', label: 'Fees', color: chartColor(7), outflow: true },
]

export default function IncomePage() {
  usePageTitle('Income and returns')
  const [range, setRange] = useRangeParam()
  const income = useIncome(range)
  const flows = useFlows(range)
  const accounts = useAccounts('active')
  const isMd = useIsMdUp()

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Segmented label="Period" value={range} onChange={setRange} options={RANGE_OPTIONS} />
      {income.data ? (
        <p className="text-sm text-muted">
          <DateText value={income.data.from} /> to <DateText value={income.data.to} />
          {income.isPlaceholderData || flows.isPlaceholderData ? <span className="ml-2 text-subtle">Updating…</span> : null}
        </p>
      ) : null}
    </div>
  )

  if (accounts.data && accounts.data.length === 0) return <EmptyPortfolio what="Income and returns" />
  if (income.isPending || flows.isPending || accounts.isPending)
    return (
      <div className="flex flex-col gap-6">
        {toolbar}
        <InsightsSkeleton charts={2} />
      </div>
    )
  const err = income.error ?? flows.error
  if (err || !income.data || !flows.data)
    return (
      <div className="flex flex-col gap-6">
        {toolbar}
        <div className="card">
          <ErrorState
            error={err}
            title="Income and returns could not be loaded"
            onRetry={() => {
              void income.refetch()
              void flows.refetch()
            }}
          />
        </div>
      </div>
    )

  const inc = income.data
  const ccy = inc.baseCurrency
  return (
    <div className="flex flex-col gap-6">
      {toolbar}
      <Totals inc={inc} />

      <Card aria-labelledby="inc-bridge">
        <CardHeader id="inc-bridge" title="Contributions versus growth" description={`From your starting value to today's, over ${rangePhrase(range)}: what you put in, what it earned, and what went out.`} />
        <CardBody>
          <FlowsBridge flows={flows.data} compactLabels={!isMd} />
          {!flows.data.complete ? <FlowsIncomplete /> : null}
        </CardBody>
      </Card>

      <MonthlyFlows months={inc.months} ccy={ccy} />

      <div className="grid gap-6 xl:grid-cols-2">
        <Breakdown
          id="inc-interest"
          title="Interest by account"
          description="Interest credited in each account's currency, with the base-currency equivalent."
          empty="No interest recorded in this period."
          ccy={ccy}
          total={inc.totals.interestMinor}
          rows={inc.interestByAccount.map((r) => ({ key: r.accountId, name: <Link to={`/accounts/${r.accountId}`} className="font-medium text-ink hover:underline">{r.name}</Link>, sub: null, currency: r.currency, nativeMinor: r.nativeMinor, baseMinor: r.baseMinor }))}
        />
        <Breakdown
          id="inc-dividends"
          title="Dividends by instrument"
          nameLabel="Instrument"
          description="Dividends received, by the instrument that paid them."
          empty="No dividends recorded in this period."
          ccy={ccy}
          total={inc.totals.dividendsMinor}
          rows={inc.dividends.map((r) => ({
            key: `${r.accountId}-${r.instrumentId ?? 'none'}`,
            name: r.instrumentId ? (
              <Link to={`/instruments/${r.instrumentId}`} className="font-medium text-ink hover:underline">
                {r.name}
              </Link>
            ) : (
              <span className="font-medium text-ink">{r.name}</span>
            ),
            sub: r.accountName,
            currency: r.currency,
            nativeMinor: r.nativeMinor,
            baseMinor: r.baseMinor,
          }))}
        />
      </div>
      <Breakdown
        id="inc-fees"
        title="Fees by account"
        description="Account fees and trading costs. These reduce your returns."
        empty="No fees recorded in this period."
        ccy={ccy}
        total={inc.totals.feesMinor}
        outflow
        rows={inc.feesByAccount.map((r) => ({ key: r.accountId, name: <Link to={`/accounts/${r.accountId}`} className="font-medium text-ink hover:underline">{r.name}</Link>, sub: null, currency: r.currency, nativeMinor: r.nativeMinor, baseMinor: r.baseMinor }))}
      />
    </div>
  )
}

function Totals({ inc }: { inc: IncomeReport }) {
  const ccy = inc.baseCurrency
  const t = inc.totals
  const cells: { label: string; value: ReactNode; note: string }[] = [
    { label: 'Contributions', value: <Money minor={t.contributionsMinor} currency={ccy} />, note: 'Money you added' },
    { label: 'Interest', value: <Money minor={t.interestMinor} currency={ccy} />, note: 'Credited to accounts' },
    { label: 'Dividends', value: <Money minor={t.dividendsMinor} currency={ccy} />, note: 'Paid by holdings' },
    { label: 'Capital growth', value: <SignedMoney minor={t.capitalGrowthMinor} currency={ccy} />, note: 'Prices and revaluations' },
    { label: 'Fees', value: <SignedMoney minor={negateMinor(t.feesMinor)} currency={ccy} />, note: 'Charges and costs' },
  ]
  return (
    <section aria-labelledby="inc-totals" className="card overflow-hidden">
      <h2 id="inc-totals" className="sr-only">
        Totals for the period
      </h2>
      <dl className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-5">
        {cells.map((c, i) => (
          <div key={c.label} className={cn('min-w-0 bg-surface p-4 md:p-5', i === cells.length - 1 && 'sm:col-span-2 lg:col-span-1')}>
            <dt className="text-sm text-muted">{c.label}</dt>
            <dd className="mt-1 truncate text-md font-semibold text-ink">{c.value}</dd>
            <dd className="mt-0.5 text-xs text-subtle">{c.note}</dd>
          </div>
        ))}
      </dl>
      {!inc.complete ? <p className="border-t border-line px-4 py-2.5 text-xs text-warning md:px-5">Some amounts could not be converted to {ccy}, so these totals are incomplete.</p> : null}
    </section>
  )
}

function MonthlyFlows({ months, ccy }: { months: MonthlyFlowPoint[]; ccy: string }) {
  const isMd = useIsMdUp()
  const { timezone } = usePrefs()
  const moneyText = useMoneyText()
  const height = isMd ? 280 : 220
  const value = (m: MonthlyFlowPoint, s: (typeof SERIES)[number]) => {
    const v = m[s.key] as string
    return s.outflow ? negateMinor(v) : v
  }
  const label = (d: string) => (d.endsWith('-01') ? formatMonthLong(d, timezone) : null)
  return (
    <Card aria-labelledby="inc-monthly">
      <CardHeader id="inc-monthly" title="Month by month" description="Inflows stack above the line; withdrawals and fees below it. Growth can fall either side." />
      <CardBody>
        <ChartFrame
          height={height}
          summary={`Monthly flows across ${months.length} months: contributions, interest and dividends, growth, withdrawals, and fees. ${months
            .slice(-3)
            .map((m) => `${m.month.slice(0, 7)} net change ${moneyText(m.netChangeMinor, ccy)}`)
            .join('; ')}.`}
          empty={
            months.length === 0 ? (
              <ChartEmpty icon={<BarChart3 size={18} aria-hidden />} title="No months to show yet">
                Monthly flows appear once you have recorded activity in this period.
              </ChartEmpty>
            ) : undefined
          }
          toolbar={
            <ul aria-label="Legend" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
              {SERIES.map((s) => (
                <li key={s.id} className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
                  {s.label}
                  {s.outflow ? <span className="text-subtle">(−)</span> : null}
                </li>
              ))}
            </ul>
          }
          table={{
            caption: 'Monthly flows',
            columns: [{ label: 'Month' }, ...SERIES.map((s) => ({ label: s.label, align: 'right' as const })), { label: 'Net change', align: 'right' }],
            rows: months.map((m) => [
              label(m.month) ?? <DateText key="d" value={m.month} />,
              ...SERIES.map((s) => <SignedMoney key={s.id} minor={value(m, s)} currency={ccy} />),
              <SignedMoney key="n" minor={m.netChangeMinor} currency={ccy} />,
            ]),
          }}
        >
          <BarChart
            height={height}
            ariaLabel="Monthly flows"
            series={SERIES}
            data={months.map((m) => ({
              key: m.month,
              label: monthTick(m.month, timezone),
              complete: m.complete,
              segments: SERIES.map((s) => ({ seriesId: s.id, value: toChartNumber(value(m, s), ccy) })),
            }))}
            renderTooltip={(i) => {
              const m = months[i]
              if (!m) return null
              return (
                <div>
                  <p className="text-xs text-muted">{label(m.month) ?? <DateText value={m.month} />}</p>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                    {SERIES.map((s) => (
                      <div key={s.id} className="contents">
                        <dt className="inline-flex items-center gap-1.5 text-muted">
                          <span aria-hidden className="size-2 rounded-[2px]" style={{ background: s.color }} />
                          {s.label}
                        </dt>
                        <dd className="text-right">
                          <SignedMoney minor={value(m, s)} currency={ccy} />
                        </dd>
                      </div>
                    ))}
                    <dt className="border-t border-line pt-1 font-medium text-ink">Net change</dt>
                    <dd className="border-t border-line pt-1 text-right font-medium">
                      <SignedMoney minor={m.netChangeMinor} currency={ccy} />
                    </dd>
                  </dl>
                  {!m.complete ? <p className="mt-1.5 text-xs text-warning">Incomplete: some amounts are missing a rate</p> : null}
                </div>
              )
            }}
          />
        </ChartFrame>
      </CardBody>
    </Card>
  )
}

interface BreakdownRow {
  key: string
  name: ReactNode
  sub: string | null
  currency: string
  nativeMinor: string
  baseMinor: string | null
}

/** A per-account or per-instrument breakdown: a table from 768 px, a list below, with the server total. */
function Breakdown({
  id,
  title,
  nameLabel = 'Account',
  description,
  empty,
  rows,
  total,
  ccy,
  outflow,
}: {
  id: string
  title: string
  nameLabel?: string
  description: string
  empty: string
  rows: BreakdownRow[]
  total: string
  ccy: string
  outflow?: boolean
}) {
  const { baseCurrency } = usePrefs()
  const base = (r: BreakdownRow) =>
    r.baseMinor === null ? (
      <span className="inline-flex flex-col items-end gap-0.5">
        <Unavailable reason={`Missing ${r.currency} → ${baseCurrency} rate`} />
        <Link to={`/settings/currencies?add=${r.currency}-${baseCurrency}`} className="link text-xs">
          Add rate
        </Link>
      </span>
    ) : (
      <Money minor={r.baseMinor} currency={ccy} className="font-medium text-ink" />
    )
  return (
    <Card aria-labelledby={id}>
      <CardHeader id={id} title={title} description={description} />
      <CardBody className="px-0 pb-1 md:px-0 md:pb-1">
        {rows.length === 0 ? (
          <div className="mx-4 mb-3 flex items-center gap-3 rounded-md bg-sunken/60 p-4 text-sm text-muted md:mx-5">
            <Coins size={18} aria-hidden className="shrink-0 text-subtle" strokeWidth={1.75} />
            {empty}
          </div>
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <caption className="sr-only">{title}</caption>
              <thead className="border-y border-line bg-sunken/60 text-xs text-muted">
                <tr>
                  <th scope="col" className="px-5 py-2 text-left font-medium">
                    {nameLabel}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Amount
                  </th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">
                    In {ccy}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-line">
                    <th scope="row" className="px-5 py-2.5 text-left font-normal">
                      {r.name}
                      {r.sub ? <span className="block text-xs text-muted">{r.sub}</span> : null}
                    </th>
                    <td className="px-3 py-2.5 text-right text-muted">
                      <Money minor={r.nativeMinor} currency={r.currency} />
                    </td>
                    <td className="px-5 py-2.5 text-right">{base(r)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2} className="px-5 py-3 text-left font-semibold text-ink">
                    Total{outflow ? ' fees' : ''}
                  </th>
                  <td className="px-5 py-3 text-right font-semibold text-ink">
                    <Money minor={total} currency={ccy} />
                  </td>
                </tr>
              </tfoot>
            </table>
            <ul className="md:hidden" aria-label={title}>
              {rows.map((r) => (
                <li key={r.key} className="flex items-start justify-between gap-3 border-t border-line px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate">{r.name}</div>
                    <p className="truncate text-xs text-muted">
                      {r.sub ? `${r.sub} · ` : ''}
                      {r.currency !== ccy ? <Money minor={r.nativeMinor} currency={r.currency} /> : null}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">{base(r)}</div>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm font-semibold text-ink">
                <span>Total</span>
                <Money minor={total} currency={ccy} />
              </li>
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  )
}
