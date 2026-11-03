import { LineChart } from 'lucide-react'
import { ChartEmpty, ChartFrame } from '@/components/charts/ChartFrame'
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart'
import { chartColor } from '@/components/charts/utils'
import { DateText, UnitPrice } from '@/components/format'
import { usePrefs } from '@/lib/prefs'
import { formatDate } from '@/lib/dates'
import { decimalToChartNumber } from '@/lib/money'

export interface PricePoint {
  date: string
  price: string
}

/** Per-instrument price history with stale ranges shaded. Labels re-format from the decimal strings. */
export function PriceHistoryChart({
  name,
  currency,
  points,
  staleRanges,
  height = 220,
  colorIndex = 0,
  toolbar,
}: {
  name: string
  currency: string
  points: PricePoint[]
  staleRanges: { from: string; to: string }[]
  height?: number
  colorIndex?: number
  toolbar?: React.ReactNode
}) {
  const { dateFormat, timezone } = usePrefs()
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const series = [{ id: 'price', label: `${name} price`, color: chartColor(colorIndex), points: sorted.map((p) => ({ date: p.date, value: decimalToChartNumber(p.price) })) }]
  const first = sorted[0]
  const last = sorted.at(-1)
  const summary =
    first && last
      ? `${name} unit price in ${currency}, ${sorted.length} recorded prices from ${formatDate(first.date, dateFormat, timezone)} to ${formatDate(last.date, dateFormat, timezone)}.${staleRanges.length ? ` ${staleRanges.length} ${staleRanges.length === 1 ? 'period' : 'periods'} where the price was stale are shaded.` : ''}`
      : `No prices recorded for ${name}.`
  return (
    <ChartFrame
      summary={summary}
      height={height}
      toolbar={toolbar}
      empty={
        sorted.length < 2 ? (
          <ChartEmpty title={sorted.length === 0 ? 'No prices yet' : 'One price so far'} icon={<LineChart size={18} aria-hidden />}>
            {sorted.length === 0 ? 'Add a price to value this holding. A line appears once there are two.' : 'Add another price to see how it moves over time.'}
          </ChartEmpty>
        ) : undefined
      }
      table={{
        caption: `${name} price history`,
        columns: [{ label: 'Date' }, { label: 'Price', align: 'right' }],
        rows: [...sorted].reverse().map((p) => [<DateText key="d" value={p.date} />, <UnitPrice key="p" value={p.price} currency={currency} />]),
      }}
      caption={
        staleRanges.length ? (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="inline-block h-3 w-4 rounded-[3px] bg-warning-soft ring-1 ring-warning/30" />
            Shaded: the price was older than its freshness threshold, so values used a stale price.
          </span>
        ) : undefined
      }
    >
      <TimeSeriesChart
        series={series}
        height={height}
        ariaLabel={`${name} price history`}
        bands={staleRanges.map((r) => ({ ...r, label: 'Stale price' }))}
        renderTooltip={(i) => {
          const p = sorted[i]
          if (!p) return null
          return (
            <div>
              <p className="text-xs text-muted">
                <DateText value={p.date} />
              </p>
              <p className="mt-0.5 font-medium text-ink">
                <UnitPrice value={p.price} currency={currency} />
              </p>
            </div>
          )
        }}
      />
    </ChartFrame>
  )
}
