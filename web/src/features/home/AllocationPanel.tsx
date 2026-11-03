import { ArrowRight, PieChart } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { Dashboard } from '@/api/types'
import { ChartEmpty, ChartFrame } from '@/components/charts/ChartFrame'
import { DonutChart } from '@/components/charts/DonutChart'
import { HBarList } from '@/components/charts/HBarList'
import { chartColor } from '@/components/charts/utils'
import { Money, Percent } from '@/components/format'
import { decimalToChartNumber, formatPercent, toChartNumber } from '@/lib/money'
import { Panel } from './Panel'

/** Where wealth sits, by category, with a path into the full allocation view. */
export function AllocationPanel({ dash }: { dash: Dashboard }) {
  const navigate = useNavigate()
  const [active, setActive] = useState<string | null>(null)
  const ccy = dash.baseCurrency
  const items = dash.allocation
  const top = items[0]
  const activeItem = items.find((i) => i.name === active)
  const drill = (name: string) => navigate(`/insights/allocation?by=category&drill=${encodeURIComponent(name)}`)

  return (
    <Panel
      title="Allocation"
      description="Assets by category. Select a category to see its accounts."
      teaser={top ? `Largest: ${top.name}, ${formatPercent(top.sharePercent)}` : undefined}
      collapsible
      action={
        <Link to="/insights/allocation" className="link inline-flex min-h-9 items-center gap-1 text-sm">
          Explore <ArrowRight size={14} aria-hidden />
        </Link>
      }
    >
      <ChartFrame
        summary={
          items.length
            ? `Assets by category: ${items
                .slice(0, 5)
                .map((i) => `${i.name} ${formatPercent(i.sharePercent)}`)
                .join(', ')}${items.length > 5 ? `, and ${items.length - 5} more` : ''}.`
            : 'No assets to allocate yet.'
        }
        height={200}
        empty={
          items.length ? undefined : (
            <ChartEmpty icon={<PieChart size={18} aria-hidden />} title="No assets yet">
              Add an asset account to see how your wealth is spread.
            </ChartEmpty>
          )
        }
        table={{
          caption: 'Assets by category',
          columns: [{ label: 'Category' }, { label: `Value (${ccy})`, align: 'right' }, { label: 'Share', align: 'right' }],
          rows: items.map((i) => [i.name, <Money key="v" minor={i.valueMinor} currency={ccy} />, <Percent key="p" value={i.sharePercent} />]),
        }}
        caption={!dash.compositionComplete ? 'Some values are missing a rate or price and are left out of these shares.' : 'Liabilities are not included; they reduce net worth, not allocation.'}
      >
        <div className="flex h-full items-center justify-center gap-8 sm:justify-start">
          <DonutChart
            size={200}
            ariaLabel="Allocation by category"
            activeId={active}
            onActiveChange={setActive}
            onSelect={drill}
            items={items.map((it, i) => ({ id: it.name, label: it.name, value: toChartNumber(it.valueMinor, ccy), color: chartColor(i) }))}
            center={
              activeItem ? (
                <span className="flex flex-col items-center">
                  <span className="max-w-[8rem] truncate text-xs text-muted">{activeItem.name}</span>
                  <Money minor={activeItem.valueMinor} currency={ccy} compact className="text-md font-semibold text-ink" />
                  <Percent value={activeItem.sharePercent} className="text-xs text-muted" />
                </span>
              ) : (
                <span className="flex flex-col items-center">
                  <span className="text-xs text-muted">Assets</span>
                  <Money minor={dash.totals.assets} currency={ccy} compact className="text-md font-semibold text-ink" />
                </span>
              )
            }
          />
          <dl className="hidden min-w-0 flex-col gap-4 sm:flex">
            <div>
              <dt className="text-xs text-muted">Liquid</dt>
              <dd className="mt-0.5 text-sm font-medium text-ink">
                <Money minor={dash.totals.liquid} currency={ccy} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Investible</dt>
              <dd className="mt-0.5 text-sm font-medium text-ink">
                <Money minor={dash.totals.investible} currency={ccy} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Total assets</dt>
              <dd className="mt-0.5 text-sm font-medium text-ink">
                <Money minor={dash.totals.assets} currency={ccy} />
              </dd>
            </div>
          </dl>
        </div>
      </ChartFrame>
      {items.length ? (
        <div className="mt-4">
          <HBarList
            ariaLabel="Allocation by category"
            onSelect={drill}
            items={items.map((it, i) => ({
              id: it.name,
              label: it.name,
              percent: decimalToChartNumber(it.sharePercent),
              color: chartColor(i),
              value: <Money minor={it.valueMinor} currency={ccy} />,
              meta: <Percent value={it.sharePercent} />,
            }))}
          />
        </div>
      ) : null}
    </Panel>
  )
}
