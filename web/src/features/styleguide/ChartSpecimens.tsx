import { addMonths, format } from 'date-fns'
import { useMemo, useState } from 'react'
import { BarChart, type BarDatum } from '@/components/charts/BarChart'
import { BridgeChart, type BridgeStep } from '@/components/charts/BridgeChart'
import { ChartEmpty, ChartFrame } from '@/components/charts/ChartFrame'
import { DonutChart, type DonutItem } from '@/components/charts/DonutChart'
import { HBarList } from '@/components/charts/HBarList'
import { Sparkline } from '@/components/charts/Sparkline'
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart'
import { chartColor, TOKENS } from '@/components/charts/utils'
import { DateText, Delta, Money, Percent } from '@/components/format'
import { formatMonthLong, parseDateOnly } from '@/lib/dates'
import { toChartNumber } from '@/lib/money'
import { usePrefs } from '@/lib/prefs'
import { LineChart } from 'lucide-react'
import { Specimen, SpecimenGroup } from './specimen'

/** Deterministic illustrative history: whole shillings, converted to minor-unit strings without floats. */
function buildHistory(today: string) {
  const start = addMonths(parseDateOnly(today), -23)
  const rows: { date: string; minor: string; complete: boolean }[] = []
  for (let i = 0; i < 24; i++) {
    const date = format(addMonths(start, i), 'yyyy-MM-01')
    const major = 9_400_000 + i * 168_000 + Math.round(Math.sin(i / 2.1) * 240_000) + (i > 15 ? 120_000 : 0)
    rows.push({ date, minor: `${major}00`, complete: i < 21 })
  }
  return rows
}

function diffMinor(a: string, b: string): string {
  return (BigInt(a) - BigInt(b)).toString()
}

const ALLOCATION = [
  { id: 'land', label: 'Land and real estate', minor: '500000000', percent: '40.6' },
  { id: 'fixed', label: 'Fixed income', minor: '457691800', percent: '37.2' },
  { id: 'mmf', label: 'Money market funds', minor: '151561700', percent: '12.3' },
  { id: 'veh', label: 'Vehicle', minor: '75000000', percent: '6.1' },
  { id: 'sec', label: 'Securities', minor: '46634675', percent: '3.8' },
]

export function ChartSpecimens() {
  const { today, timezone } = usePrefs()
  const history = useMemo(() => buildHistory(today), [today])
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [active, setActive] = useState<string | null>(null)

  const series = useMemo(
    () => [{ id: 'nw', label: 'Net worth', color: TOKENS.accent, area: true, points: history.map((h) => ({ date: h.date, value: toChartNumber(h.minor, 'KES'), complete: h.complete })) }],
    [history],
  )
  const band = { from: history[14]!.date, to: history[17]!.date, label: 'KCB Group price stale' }

  const changes: BarDatum[] = history.slice(1).map((h, i) => ({
    key: h.date,
    label: format(parseDateOnly(h.date), 'MMM'),
    segments: [{ seriesId: 'chg', value: toChartNumber(diffMinor(h.minor, history[i]!.minor), 'KES') }],
    complete: h.complete,
  }))

  const bridge: BridgeStep[] = [
    { id: 'start', label: 'Start value', value: toChartNumber('1005200000', 'KES'), kind: 'total', display: <Money minor="1005200000" currency="KES" compact /> },
    { id: 'contrib', label: 'Contributions', value: toChartNumber('144000000', 'KES'), kind: 'delta', display: <Delta minor="144000000" currency="KES" compact showIcon={false} /> },
    { id: 'income', label: 'Interest and dividends', value: toChartNumber('61250000', 'KES'), kind: 'delta', display: <Delta minor="61250000" currency="KES" compact showIcon={false} /> },
    { id: 'growth', label: 'Market and valuation', value: toChartNumber('38400000', 'KES'), kind: 'delta', display: <Delta minor="38400000" currency="KES" compact showIcon={false} /> },
    { id: 'wd', label: 'Withdrawals', value: toChartNumber('-12000000', 'KES'), kind: 'delta', display: <Delta minor="-12000000" currency="KES" compact showIcon={false} /> },
    { id: 'fees', label: 'Fees', value: toChartNumber('-1450000', 'KES'), kind: 'delta', display: <Delta minor="-1450000" currency="KES" compact showIcon={false} /> },
    { id: 'end', label: 'End value', value: toChartNumber('1235400000', 'KES'), kind: 'total', display: <Money minor="1235400000" currency="KES" compact /> },
  ]

  const donut: DonutItem[] = ALLOCATION.filter((a) => !excluded.has(a.id)).map((a) => ({ id: a.id, label: a.label, value: toChartNumber(a.minor, 'KES'), color: chartColor(ALLOCATION.indexOf(a)) }))
  const last = history.at(-1)!

  return (
    <SpecimenGroup title="Charts" description="Every chart sits in a ChartFrame with a summary and a table view. Incomplete data is dashed; stale ranges are shaded.">
      <Specimen label="TimeSeriesChart: incomplete dashed tail and a stale band" wide>
        <ChartFrame
          summary="Illustrative net worth over 24 months, rising overall. The last three months are incomplete and a stale-price period is shaded."
          height={240}
          table={{
            caption: 'Illustrative net worth by month',
            columns: [{ label: 'Month' }, { label: 'Net worth', align: 'right' }, { label: 'Status' }],
            rows: history.map((h) => [formatMonthLong(h.date, timezone), <Money key="m" minor={h.minor} currency="KES" />, h.complete ? 'Complete' : 'Incomplete']),
          }}
        >
          <TimeSeriesChart
            series={series}
            height={240}
            ariaLabel="Illustrative net worth"
            bands={[band]}
            markers={[{ date: history[19]!.date, seriesId: 'nw', kind: 'high', label: 'Highest recorded' }]}
            renderTooltip={(i) => {
              const h = history[i]
              if (!h) return null
              return (
                <div className="text-sm">
                  <p className="text-xs text-muted">
                    <DateText value={h.date} />
                  </p>
                  <p className="font-semibold text-ink">
                    <Money minor={h.minor} currency="KES" />
                  </p>
                  {!h.complete ? <p className="text-xs text-warning">Incomplete: a USD rate is missing</p> : null}
                </div>
              )
            }}
          />
        </ChartFrame>
      </Specimen>
      <Specimen label="BarChart: diverging monthly change (colorBySign)" wide>
        <ChartFrame
          summary="Illustrative month-over-month change in net worth, mostly gains with a few losses."
          height={200}
          table={{
            caption: 'Illustrative monthly change',
            columns: [{ label: 'Month' }, { label: 'Change', align: 'right' }],
            rows: history.slice(1).map((h, i) => [formatMonthLong(h.date, timezone), <Delta key="d" minor={diffMinor(h.minor, history[i]!.minor)} currency="KES" />]),
          }}
        >
          <BarChart
            data={changes}
            series={[{ id: 'chg', label: 'Monthly change', color: TOKENS.positive }]}
            height={200}
            ariaLabel="Illustrative monthly change"
            colorBySign
            renderTooltip={(i) => {
              const h = history[i + 1]
              if (!h) return null
              return (
                <div className="text-sm">
                  <p className="text-xs text-muted">{formatMonthLong(h.date, timezone)}</p>
                  <Delta minor={diffMinor(h.minor, history[i]!.minor)} currency="KES" />
                </div>
              )
            }}
          />
        </ChartFrame>
      </Specimen>
      <Specimen label="BridgeChart: start → drivers → end" wide>
        <ChartFrame summary="Illustrative bridge from start to end value through contributions, income, growth, withdrawals, and fees." height={260}>
          <BridgeChart steps={bridge} ariaLabel="Illustrative contributions versus growth" />
        </ChartFrame>
      </Specimen>
      <Specimen label="DonutChart with HBarList as an interactive legend" wide>
        <ChartFrame summary="Illustrative allocation by category; land and fixed income are the largest shares." height={260}>
          <div className="grid h-full items-center gap-6 sm:grid-cols-[220px_minmax(0,1fr)]">
            <div className="mx-auto">
              <DonutChart
                items={donut}
                activeId={active}
                onActiveChange={setActive}
                ariaLabel="Illustrative allocation by category"
                center={
                  <div className="text-center">
                    <p className="text-xs text-muted">Total</p>
                    <Money minor="1230888175" currency="KES" compact className="text-md font-semibold text-ink" />
                  </div>
                }
              />
            </div>
            <HBarList
              ariaLabel="Allocation by category"
              items={ALLOCATION.map((a, i) => ({
                id: a.id,
                label: a.label,
                percent: Number(a.percent),
                color: chartColor(i),
                value: <Money minor={a.minor} currency="KES" compact />,
                meta: <Percent value={a.percent} />,
                excluded: excluded.has(a.id),
              }))}
              onToggle={(id) =>
                setExcluded((prev) => {
                  const next = new Set(prev)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return next
                })
              }
            />
          </div>
        </ChartFrame>
      </Specimen>
      <Specimen label="Sparkline: rising, falling, incomplete, sparse">
        <div className="flex flex-wrap items-center gap-5">
          <Sparkline values={series[0]!.points.map((p) => p.value)} tone="accent" />
          <Sparkline values={[9, 8.6, 8.4, 8.1, 7.9, 7.5]} tone="negative" />
          <Sparkline values={[3, 3.2, 3.1, 3.4, 3.6]} tone="positive" incomplete />
          <Sparkline values={[5]} tone="muted" />
        </div>
        <p className="mt-2 text-xs text-muted">
          Latest: <Money minor={last.minor} currency="KES" />
        </p>
      </Specimen>
      <Specimen label="Chart empty state (sparse history)">
        <ChartFrame summary="Not enough history to draw a chart." height={160} empty={<ChartEmpty icon={<LineChart size={18} aria-hidden />} title="Not enough history yet">Update this account’s value next month to start a trend line.</ChartEmpty>}>
          <div />
        </ChartFrame>
      </Specimen>
    </SpecimenGroup>
  )
}
