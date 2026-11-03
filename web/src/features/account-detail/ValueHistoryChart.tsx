import { format, subMonths } from 'date-fns'
import { LineChart } from 'lucide-react'
import { useState } from 'react'
import type { Account, AccountHistoryPoint } from '@/api/types'
import { ChartEmpty, ChartFrame } from '@/components/charts/ChartFrame'
import { TimeSeriesChart, type TSMarker } from '@/components/charts/TimeSeriesChart'
import { DateText, Money } from '@/components/format'
import { Segmented } from '@/components/ui/Segmented'
import { formatDate, parseDateOnly } from '@/lib/dates'
import { formatMoney, toChartNumber } from '@/lib/money'
import { usePrefs } from '@/lib/prefs'
import { usePrivacy } from '@/lib/privacy'

type Range = '6m' | '1y' | 'all'
const RANGE_MONTHS: Record<Exclude<Range, 'all'>, number> = { '6m': 6, '1y': 12 }

export interface ValueMarker {
  date: string
  kind: 'valuation' | 'buy' | 'sell'
  label: string
}

/** Account value history with markers (valuations or trades), dashed where incomplete, and a range switch. */
export function ValueHistoryChart({
  account,
  history,
  historyComplete,
  markers = [],
  color,
  height = 260,
  label,
}: {
  account: Account
  history: AccountHistoryPoint[]
  historyComplete: boolean
  markers?: ValueMarker[]
  color: string
  height?: number
  label: string
}) {
  const { today, dateFormat, timezone } = usePrefs()
  const { hidden } = usePrivacy()
  const [range, setRange] = useState<Range>('all')
  const cutoff = range === 'all' ? '' : format(subMonths(parseDateOnly(today), RANGE_MONTHS[range]), 'yyyy-MM-dd')
  const points = history.filter((p) => p.date >= cutoff)
  const shownMarkers = markers.filter((m) => m.date >= cutoff)
  const c = account.currency
  const first = points[0]
  const last = points.at(-1)
  const fmt = (d: string) => formatDate(d, dateFormat, timezone)
  const summary =
    first && last
      ? `${label} from ${fmt(first.date)} to ${fmt(last.date)}${hidden ? '' : `, from ${formatMoney(first.valueMinor, c)} to ${formatMoney(last.valueMinor, c)}`}.${shownMarkers.length ? ` ${shownMarkers.length} ${shownMarkers[0]?.kind === 'valuation' ? 'valuations' : 'trades'} are marked.` : ''}${historyComplete ? '' : ' Dashed segments are incomplete.'}`
      : `${label}: not enough history yet.`

  const tsMarkers: TSMarker[] = shownMarkers.map((m) => ({ date: m.date, seriesId: 'value', kind: m.kind, label: m.label }))
  const markersByDate = new Map<string, ValueMarker[]>()
  for (const m of shownMarkers) markersByDate.set(m.date, [...(markersByDate.get(m.date) ?? []), m])

  return (
    <ChartFrame
      summary={summary}
      height={height}
      toolbar={
        <Segmented<Range>
          size="sm"
          label="Range"
          value={range}
          onChange={setRange}
          options={[
            { value: '6m', label: '6M', ariaLabel: 'Last 6 months' },
            { value: '1y', label: '1Y', ariaLabel: 'Last year' },
            { value: 'all', label: 'All', ariaLabel: 'Since opening' },
          ]}
        />
      }
      empty={
        history.length < 2 ? (
          <ChartEmpty title="Not enough history yet" icon={<LineChart size={18} aria-hidden />}>
            A line appears once the account has two dated values. Record activity or import past transactions to fill it in.
          </ChartEmpty>
        ) : undefined
      }
      table={{
        caption: `${label}, ${account.name}`,
        columns: [{ label: 'Date' }, { label: 'Value', align: 'right' }, { label: 'Note' }],
        rows: [...points].reverse().map((p) => [
          <DateText key="d" value={p.date} />,
          <Money key="v" minor={p.valueMinor} currency={c} />,
          <span key="n" className="text-muted">
            {[...(markersByDate.get(p.date) ?? []).map((m) => m.label), p.complete ? '' : 'Incomplete'].filter(Boolean).join(' · ') || '—'}
          </span>,
        ]),
      }}
      caption={
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {markers.some((m) => m.kind === 'valuation') ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block size-2 rotate-45 border-[1.5px] border-current text-ink" />
              Valuation
            </span>
          ) : null}
          {markers.some((m) => m.kind === 'buy') ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="text-positive">▲</span>
              Buy
            </span>
          ) : null}
          {markers.some((m) => m.kind === 'sell') ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="text-negative">▼</span>
              Sell
            </span>
          ) : null}
          {!historyComplete ? (
            <span className="inline-flex items-center gap-1.5 text-warning">
              <span aria-hidden className="inline-block w-5 border-t-2 border-dashed border-current" />
              Incomplete: a price or rate is missing for these dates
            </span>
          ) : null}
        </span>
      }
    >
      {points.length < 2 ? (
        <div className="grid h-full place-items-center rounded-md border border-dashed border-line bg-sunken/40">
          <ChartEmpty title="Too little history in this range">Choose a longer range to see the line.</ChartEmpty>
        </div>
      ) : (
        <TimeSeriesChart
          series={[{ id: 'value', label, color, area: true, points: points.map((p) => ({ date: p.date, value: toChartNumber(p.valueMinor, c), complete: p.complete })) }]}
          markers={tsMarkers}
          height={height}
          ariaLabel={label}
          includeZero={account.isLiability}
          renderTooltip={(i) => {
            const p = points[i]
            if (!p) return null
            const ms = markersByDate.get(p.date) ?? []
            return (
              <div>
                <p className="text-xs text-muted">
                  <DateText value={p.date} />
                </p>
                <p className="mt-0.5 font-semibold text-ink">
                  <Money minor={p.valueMinor} currency={c} />
                </p>
                {ms.map((m, k) => (
                  <p key={k} className="mt-1 text-xs text-muted">
                    {m.label}
                  </p>
                ))}
                {!p.complete ? <p className="mt-1 text-xs font-medium text-warning">Incomplete: excludes unpriced holdings</p> : null}
              </div>
            )
          }}
        />
      )}
    </ChartFrame>
  )
}
