import { ArrowRight, ChevronRight, Clock, Layers, PieChart, RotateCcw } from 'lucide-react'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { Account, AllocationItem, ReportAllocation, ReportSummary } from '@/api/types'
import { ChartEmpty, ChartFrame } from '@/components/charts/ChartFrame'
import { DonutChart } from '@/components/charts/DonutChart'
import { HBarList } from '@/components/charts/HBarList'
import { chartColor, TOKENS } from '@/components/charts/utils'
import { DateText, Money, Percent, Quantity, Unavailable, UnitPrice } from '@/components/format'
import { Badge } from '@/components/ui/Badge'
import { Button, buttonClass } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { Notice } from '@/components/ui/Notice'
import { Segmented } from '@/components/ui/Segmented'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { decimalToChartNumber, formatPercent, toChartNumber } from '@/lib/money'
import { usePrefs } from '@/lib/prefs'
import { useAccountAnalytics, useAccountExtras, useAccounts, useCategories, useReportAllocation, useReportSummary } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { EmptyPortfolio, IncompleteTotalsNotice, InsightsSkeleton, SectionTitle, useIsMdUp } from './common'

type By = 'category' | 'institution' | 'currency' | 'instrument'
type Scope = 'total' | 'investible'

const BY_OPTIONS: { value: By; label: string }[] = [
  { value: 'category', label: 'Category' },
  { value: 'institution', label: 'Institution' },
  { value: 'currency', label: 'Currency' },
  { value: 'instrument', label: 'Instrument' },
]
const BY_NOUN: Record<By, { one: string; many: string }> = {
  category: { one: 'category', many: 'categories' },
  institution: { one: 'institution', many: 'institutions' },
  currency: { one: 'currency', many: 'currencies' },
  instrument: { one: 'holding', many: 'holdings' },
}

/** All allocation state lives in the URL so any view can be linked to and restored. */
function useAllocationParams() {
  const [params, setParams] = useSearchParams()
  const rawBy = params.get('by')
  const by: By = BY_OPTIONS.some((o) => o.value === rawBy) ? (rawBy as By) : 'category'
  const scope: Scope = by === 'category' && params.get('scope') === 'investible' ? 'investible' : 'total'
  const excluded = params.getAll('exclude')
  const drill = by === 'instrument' ? null : params.get('drill')
  const accountId = drill ? params.get('account') : null
  const update = useCallback(
    (fn: (p: URLSearchParams) => void, replace = true) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          fn(p)
          return p
        },
        { replace },
      ),
    [setParams],
  )
  return {
    by,
    scope,
    excluded,
    drill,
    accountId,
    setBy: (v: By) =>
      update((p) => {
        p.set('by', v)
        for (const k of ['exclude', 'drill', 'account']) p.delete(k)
        if (v !== 'category') p.delete('scope')
      }),
    setScope: (v: Scope) =>
      update((p) => {
        p.set('scope', v)
        for (const k of ['exclude', 'drill', 'account']) p.delete(k)
      }),
    toggleExcluded: (name: string) =>
      update((p) => {
        const cur = p.getAll('exclude')
        p.delete('exclude')
        for (const n of cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name]) p.append('exclude', n)
      }),
    clearExcluded: () => update((p) => p.delete('exclude')),
    setDrill: (name: string | null) =>
      update((p) => {
        p.delete('account')
        if (name) p.set('drill', name)
        else p.delete('drill')
      }, false),
    setAccount: (id: string | null) =>
      update((p) => {
        if (id) p.set('account', id)
        else p.delete('account')
      }, false),
  }
}

type Params = ReturnType<typeof useAllocationParams>

function itemsFor(rep: ReportAllocation, by: By, scope: Scope): AllocationItem[] {
  if (by === 'institution') return rep.institutions
  if (by === 'currency') return rep.currencies
  if (by === 'instrument') return rep.instruments
  return scope === 'investible' ? rep.investibleCategories : rep.categories
}

function accountMatches(a: Account, by: By, name: string): boolean {
  if (a.isLiability || !a.isIncludedInNetWorth) return false
  if (by === 'category') return a.categoryName === name
  if (by === 'institution') return (a.institutionName ?? 'No institution') === name
  if (by === 'currency') return a.currency === name
  return false
}

export default function AllocationPage() {
  usePageTitle('Allocation')
  const rep = useReportAllocation()
  const summary = useReportSummary()
  const accounts = useAccounts('active')
  const params = useAllocationParams()

  if (rep.isPending || accounts.isPending) return <InsightsSkeleton charts={2} stats={false} />
  const err = rep.error ?? accounts.error
  if (err || !rep.data || !accounts.data)
    return (
      <div className="card">
        <ErrorState
          error={err}
          title="Allocation could not be loaded"
          onRetry={() => {
            void rep.refetch()
            void accounts.refetch()
          }}
        />
      </div>
    )
  if (accounts.data.length === 0) return <EmptyPortfolio what="Allocation views" />

  return (
    <div className="flex flex-col gap-6">
      <Toolbar params={params} />
      {!rep.data.currentComplete ? <IncompleteTotalsNotice missingCurrencies={rep.data.missingCurrencies} scope="allocation totals" /> : null}
      {params.accountId ? (
        <HoldingsView params={params} account={accounts.data.find((a) => a.id === params.accountId)} />
      ) : params.drill ? (
        <AccountsView params={params} rep={rep.data} accounts={accounts.data} />
      ) : (
        <OverviewView params={params} rep={rep.data} summary={summary.data} />
      )}
      {!params.drill ? <LiquiditySection summary={summary.data} summaryError={summary.error} onRetry={() => summary.refetch()} /> : null}
    </div>
  )
}

function Toolbar({ params }: { params: Params }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="scroll-x -mx-1 max-w-full px-1 py-0.5">
        <Segmented<By> label="Group allocation by" value={params.by} onChange={params.setBy} options={BY_OPTIONS} />
      </div>
      {params.by === 'category' ? (
        <Segmented<Scope>
          label="Scope"
          value={params.scope}
          onChange={params.setScope}
          options={[
            { value: 'total', label: 'All assets' },
            { value: 'investible', label: 'Investible' },
          ]}
        />
      ) : null}
    </div>
  )
}

// ---- level 0: overview ---------------------------------------------------------------

function OverviewView({ params, rep, summary }: { params: Params; rep: ReportAllocation; summary: ReportSummary | undefined }) {
  const { by, scope, excluded } = params
  const ccy = rep.baseCurrency
  const isMd = useIsMdUp()
  const [active, setActive] = useState<string | null>(null)
  const items = itemsFor(rep, by, scope)
  const colors = useMemo(() => new Map(items.map((it, i) => [it.name, chartColor(i)])), [items])
  const visible = items.filter((i) => !excluded.includes(i.name))
  const excludedHere = items.filter((i) => excluded.includes(i.name))
  const activeItem = items.find((i) => i.name === active && !excluded.includes(i.name))
  const drillable = by !== 'instrument'
  const noun = BY_NOUN[by]
  const total = by === 'instrument' ? null : scope === 'investible' ? summary?.totals.investible : summary?.totals.assets
  const title = by === 'instrument' ? 'By instrument' : scope === 'investible' ? 'Investible assets by category' : `By ${noun.one}`
  const description =
    by === 'instrument'
      ? 'Holdings in position-tracked accounts, including broker cash.'
      : scope === 'investible'
        ? 'Only categories marked investible. Lifestyle assets such as a home or a car are left out.'
        : `Assets by ${noun.one}. Liabilities reduce net worth and are not part of allocation.`

  const size = isMd ? 240 : 220
  const center: ReactNode = activeItem ? (
    <span className="flex flex-col items-center">
      <span className="max-w-[9rem] truncate text-xs text-muted">{activeItem.name}</span>
      <Money minor={activeItem.valueMinor} currency={ccy} compact className="text-lg font-semibold text-ink" />
      <Percent value={activeItem.sharePercent} className="text-xs text-muted" />
    </span>
  ) : excludedHere.length ? (
    <span className="flex flex-col items-center">
      <span className="text-xs text-muted">Showing</span>
      <span className="num text-lg font-semibold text-ink">
        {visible.length} of {items.length}
      </span>
      <span className="text-xs text-muted">{noun.many}</span>
    </span>
  ) : total ? (
    <span className="flex flex-col items-center">
      <span className="text-xs text-muted">{scope === 'investible' ? 'Investible' : 'Total assets'}</span>
      <Money minor={total} currency={ccy} compact className="text-lg font-semibold text-ink" />
    </span>
  ) : (
    <span className="flex flex-col items-center">
      <span className="num text-lg font-semibold text-ink">{items.length}</span>
      <span className="text-xs text-muted">{items.length === 1 ? noun.one : noun.many}</span>
    </span>
  )

  return (
    <Card aria-labelledby="alloc-main">
      <CardHeader
        id="alloc-main"
        title={title}
        description={
          <>
            {description} As of <DateText value={rep.asOf} />.
          </>
        }
      />
      <CardBody>
        {excludedHere.length ? (
          <Notice
            tone="info"
            className="mb-4"
            title={`Excluding ${excludedHere.map((i) => i.name).join(', ')}`}
            action={
              <Button size="sm" variant="ghost" icon={<RotateCcw size={14} aria-hidden />} onClick={params.clearExcluded}>
                Include all
              </Button>
            }
          >
            The chart is redrawn from the remaining {noun.many}. Values and shares are unchanged: each share is a percentage of your full total, including what you
            excluded.
          </Notice>
        ) : null}
        <div className="grid items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10">
          <ChartFrame
            height={size}
            summary={
              items.length
                ? `${title}: ${items
                    .slice(0, 6)
                    .map((i) => `${i.name} ${formatPercent(i.sharePercent)}`)
                    .join(', ')}${items.length > 6 ? `, and ${items.length - 6} more` : ''}.${excludedHere.length ? ` Excluded from the chart: ${excludedHere.map((i) => i.name).join(', ')}.` : ''}`
                : 'Nothing to allocate yet.'
            }
            table={{
              caption: title,
              columns: [{ label: BY_NOUN[by].one.replace(/^./, (c) => c.toUpperCase()) }, { label: `Value (${ccy})`, align: 'right' }, { label: 'Share of full total', align: 'right' }],
              rows: items.map((it) => [
                excluded.includes(it.name) ? `${it.name} (excluded)` : it.name,
                <Money key="v" minor={it.valueMinor} currency={ccy} />,
                <Percent key="p" value={it.sharePercent} />,
              ]),
            }}
            empty={
              visible.length === 0 ? (
                <ChartEmpty icon={<PieChart size={18} aria-hidden />} title={items.length ? 'Everything is excluded' : `No ${noun.many} to show yet`}>
                  {items.length
                    ? 'Include at least one item in the list to draw the chart.'
                    : by === 'instrument'
                      ? 'Add a position-tracked account and record holdings to see them here.'
                      : 'Add an asset account with a value to see its share.'}
                </ChartEmpty>
              ) : undefined
            }
          >
            <div className="flex h-full items-center justify-center">
              <DonutChart
                size={size}
                ariaLabel={title}
                activeId={active}
                onActiveChange={setActive}
                onSelect={drillable ? (id) => params.setDrill(id) : undefined}
                items={visible.map((it) => ({ id: it.name, label: it.name, value: toChartNumber(it.valueMinor, ccy), color: colors.get(it.name) ?? TOKENS.muted }))}
                center={center}
              />
            </div>
          </ChartFrame>
          <div className="min-w-0">
            <p className="mb-1 text-xs text-muted">
              {drillable ? `Select a ${noun.one} to see its accounts. ` : ''}Use the swatch to exclude an item from the chart.
            </p>
            <HBarList
              ariaLabel={`Allocation by ${noun.one}`}
              onToggle={params.toggleExcluded}
              onSelect={drillable ? (id) => params.setDrill(id) : undefined}
              items={items.map((it) => ({
                id: it.name,
                label: it.name,
                percent: decimalToChartNumber(it.sharePercent),
                color: colors.get(it.name) ?? TOKENS.muted,
                value: <Money minor={it.valueMinor} currency={ccy} />,
                meta: excluded.includes(it.name) ? 'Excluded' : <Percent value={it.sharePercent} />,
                excluded: excluded.includes(it.name),
              }))}
            />
            {items.length ? (
              <p className="mt-2 text-xs text-subtle">
                {excludedHere.length ? 'Shares are of the full total, including excluded items.' : `Shares are of ${scope === 'investible' ? 'investible assets' : 'total assets'}.`}
              </p>
            ) : null}
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

// ---- breadcrumb ------------------------------------------------------------------------

function Crumbs({ params, accountName }: { params: Params; accountName?: string }) {
  const noun = BY_NOUN[params.by]
  return (
    <nav aria-label="Allocation breadcrumb" className="min-w-0">
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        <li>
          <button type="button" onClick={() => params.setDrill(null)} className="inline-flex min-h-9 items-center rounded-sm px-1 font-medium text-accent hover:underline">
            All {noun.many}
          </button>
        </li>
        <li aria-hidden className="text-subtle">
          <ChevronRight size={14} />
        </li>
        <li className="min-w-0">
          {accountName ? (
            <button type="button" onClick={() => params.setAccount(null)} className="inline-flex min-h-9 max-w-[16rem] items-center truncate rounded-sm px-1 font-medium text-accent hover:underline">
              {params.drill}
            </button>
          ) : (
            <span aria-current="page" className="block max-w-[16rem] truncate px-1 font-medium text-ink">
              {params.drill}
            </span>
          )}
        </li>
        {accountName ? (
          <>
            <li aria-hidden className="text-subtle">
              <ChevronRight size={14} />
            </li>
            <li className="min-w-0">
              <span aria-current="page" className="block max-w-[16rem] truncate px-1 font-medium text-ink">
                {accountName}
              </span>
            </li>
          </>
        ) : null}
      </ol>
    </nav>
  )
}

// ---- level 1: accounts in a group ------------------------------------------------------

function AccountsView({ params, rep, accounts }: { params: Params; rep: ReportAllocation; accounts: Account[] }) {
  const { baseCurrency } = usePrefs()
  const navigate = useNavigate()
  const ccy = rep.baseCurrency
  const name = params.drill ?? ''
  const items = itemsFor(rep, params.by, params.scope)
  const group = items.find((i) => i.name === name)
  const list = accounts.filter((a) => accountMatches(a, params.by, name))
  const geo = list.map((a) => (a.convertedValueMinor === null ? 0 : Math.max(0, toChartNumber(a.convertedValueMinor, ccy))))
  const maxGeo = Math.max(1, ...geo)

  return (
    <Card aria-labelledby="alloc-drill">
      <div className="px-4 pt-4 md:px-5 md:pt-5">
        <Crumbs params={params} />
      </div>
      <CardHeader
        id="alloc-drill"
        className="pt-2 md:pt-2"
        title={name}
        description={
          group ? (
            <>
              <Money minor={group.valueMinor} currency={ccy} className="text-ink" /> · <Percent value={group.sharePercent} /> of{' '}
              {params.scope === 'investible' ? 'investible assets' : 'total assets'} · {list.length} {list.length === 1 ? 'account' : 'accounts'}
            </>
          ) : (
            `${list.length} ${list.length === 1 ? 'account' : 'accounts'}`
          )
        }
      />
      <CardBody>
        {list.length === 0 ? (
          <p className="rounded-md bg-sunken/60 p-4 text-sm text-muted">No active asset accounts in {name}.</p>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
            <ChartFrame
              height={220}
              summary={`${name}: ${list.length} accounts. Largest is ${list[geo.indexOf(Math.max(...geo))]?.name ?? 'unknown'}.`}
              empty={geo.every((g) => g === 0) ? <ChartEmpty title="No values to draw">These accounts are missing a rate or a value.</ChartEmpty> : undefined}
              table={{
                caption: `Accounts in ${name}`,
                columns: [{ label: 'Account' }, { label: `Value (${ccy})`, align: 'right' }],
                rows: list.map((a) => [a.name, <Money key="v" minor={a.convertedValueMinor} currency={ccy} />]),
              }}
            >
              <div className="flex h-full items-center justify-center">
                <DonutChart
                  size={200}
                  ariaLabel={`Accounts in ${name}`}
                  onSelect={(id) => {
                    const a = list.find((x) => x.id === id)
                    if (a?.trackingMode === 'positions') params.setAccount(id)
                    else if (a) navigate(`/accounts/${a.id}`)
                  }}
                  items={list.map((a, i) => ({ id: a.id, label: a.name, value: geo[i] ?? 0, color: chartColor(i) }))}
                  center={
                    group ? (
                      <span className="flex flex-col items-center">
                        <span className="text-xs text-muted">{name}</span>
                        <Money minor={group.valueMinor} currency={ccy} compact className="text-md font-semibold text-ink" />
                      </span>
                    ) : undefined
                  }
                />
              </div>
            </ChartFrame>
            <ul aria-label={`Accounts in ${name}`} className="flex flex-col">
              {list.map((a, i) => (
                <li key={a.id} className="border-t border-line py-3 first:border-t-0 first:pt-0">
                  <div className="flex items-start gap-3">
                    <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: chartColor(i) }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <div className="min-w-0">
                          {a.trackingMode === 'positions' ? (
                            <button type="button" onClick={() => params.setAccount(a.id)} className="max-w-full truncate text-left text-sm font-medium text-ink hover:underline">
                              {a.name}
                            </button>
                          ) : (
                            <Link to={`/accounts/${a.id}`} className="block max-w-full truncate text-sm font-medium text-ink hover:underline">
                              {a.name}
                            </Link>
                          )}
                          <p className="truncate text-xs text-muted">
                            {[a.institutionName, a.trackingMode === 'positions' ? 'Tracked by position' : 'Tracked by value'].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <div className="text-right text-sm">
                          {a.convertedValueMinor === null ? (
                            <span className="flex flex-col items-end gap-1">
                              <Unavailable reason={`Missing ${a.currency} → ${baseCurrency} rate`} />
                              <Link to={`/settings/currencies?add=${a.currency}-${baseCurrency}`} className="link text-xs">
                                Add {a.currency}/{baseCurrency} rate
                              </Link>
                            </span>
                          ) : (
                            <Money minor={a.convertedValueMinor} currency={ccy} className="font-medium text-ink" />
                          )}
                          {a.currency !== ccy ? (
                            <p className="text-xs text-muted">
                              <Money minor={a.currentValueMinor} currency={a.currency} />
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
                        <div className="h-full rounded-full transition-[width] duration-[var(--dur-3)]" style={{ width: `${((geo[i] ?? 0) / maxGeo) * 100}%`, background: chartColor(i) }} />
                      </div>
                      {a.trackingMode === 'positions' ? (
                        <button type="button" onClick={() => params.setAccount(a.id)} className="mt-1.5 inline-flex min-h-8 items-center gap-1 text-xs font-medium text-accent hover:underline">
                          <Layers size={13} aria-hidden /> View holdings
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-4 text-xs text-subtle">Bar lengths compare accounts within {name}; values are in {ccy}.</p>
      </CardBody>
    </Card>
  )
}

// ---- level 2: holdings -------------------------------------------------------------------

function HoldingsView({ params, account }: { params: Params; account: Account | undefined }) {
  const analytics = useAccountAnalytics(params.accountId ?? undefined)
  const extras = useAccountExtras(params.accountId ?? undefined)
  const isMd = useIsMdUp()
  const name = account?.name ?? 'Account'

  const body = () => {
    if (analytics.isPending) return <Skeleton className="h-64" label="Loading holdings" />
    if (analytics.isError) return <ErrorState compact error={analytics.error} onRetry={() => analytics.refetch()} />
    const ps = analytics.data.positionSummary
    if (!ps) return <p className="rounded-md bg-sunken/60 p-4 text-sm text-muted">This account is tracked by value, so it has no holdings to break down.</p>
    const weights = new Map((extras.data?.weights ?? []).map((w) => [w.instrumentId, w.weightPercent]))
    const cashWeight = extras.data?.cashWeightPercent ?? null
    const donut = [
      ...ps.positions.map((p, i) => ({ id: p.instrumentId, label: p.instrumentSymbol || p.instrumentName, value: decimalToChartNumber(weights.get(p.instrumentId) ?? '0') || 0, color: chartColor(i) })),
      ...(cashWeight ? [{ id: 'cash', label: 'Cash', value: decimalToChartNumber(cashWeight) || 0, color: chartColor(7) }] : []),
    ]
    const acctCcy = analytics.data.currency
    return (
      <div className="grid items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
        <ChartFrame
          height={220}
          summary={`Holdings in ${name} by weight: ${donut.map((d) => d.label).join(', ')}.`}
          empty={donut.every((d) => d.value === 0) ? <ChartEmpty title="No weights yet">Weights appear once every holding has a price.</ChartEmpty> : undefined}
          table={{
            caption: `Holdings in ${name} by weight`,
            columns: [{ label: 'Holding' }, { label: 'Weight', align: 'right' }],
            rows: [
              ...ps.positions.map((p) => [p.instrumentSymbol || p.instrumentName, <Percent key="w" value={weights.get(p.instrumentId) ?? null} />]),
              ['Cash', <Percent key="c" value={cashWeight} />],
            ],
          }}
        >
          <div className="flex h-full items-center justify-center">
            <DonutChart size={200} ariaLabel={`Holdings in ${name}`} items={donut} center={<span className="text-xs text-muted">{ps.positions.length} holdings</span>} />
          </div>
        </ChartFrame>
        <div className="min-w-0">
          {isMd ? (
            <table className="w-full text-sm">
              <caption className="sr-only">Holdings in {name}</caption>
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 text-left font-medium">
                    Holding
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Quantity
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Price
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Value
                  </th>
                  <th scope="col" className="py-2 pl-3 text-right font-medium">
                    Weight
                  </th>
                </tr>
              </thead>
              <tbody>
                {ps.positions.map((p, i) => (
                  <tr key={p.instrumentId} className="border-b border-line last:border-b-0">
                    <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                      <span className="flex items-center gap-2">
                        <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: chartColor(i) }} />
                        <span className="min-w-0">
                          <Link to={`/instruments/${p.instrumentId}`} className="block truncate font-medium text-ink hover:underline">
                            {p.instrumentSymbol || p.instrumentName}
                          </Link>
                          <span className="block truncate text-xs text-muted">{p.instrumentName}</span>
                        </span>
                      </span>
                    </th>
                    <td className="px-3 py-2.5 text-right">
                      <Quantity value={p.quantity} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <PriceCell p={p} />
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium text-ink">
                      <Money minor={p.valueMinor} currency={p.quoteCurrency} unavailable={<Unavailable label="No price" />} />
                    </td>
                    <td className="py-2.5 pl-3 text-right text-muted">
                      <Percent value={weights.get(p.instrumentId) ?? null} />
                    </td>
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                    <span className="flex items-center gap-2">
                      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: chartColor(7) }} />
                      <span className="font-medium text-ink">Cash</span>
                    </span>
                  </th>
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 text-right font-medium text-ink">
                    <Money minor={ps.cashMinor} currency={acctCcy} />
                  </td>
                  <td className="py-2.5 pl-3 text-right text-muted">
                    <Percent value={cashWeight} />
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <ul aria-label={`Holdings in ${name}`} className="flex flex-col">
              {ps.positions.map((p, i) => (
                <li key={p.instrumentId} className="flex items-start gap-3 border-t border-line py-3 first:border-t-0">
                  <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: chartColor(i) }} />
                  <div className="min-w-0 flex-1">
                    <Link to={`/instruments/${p.instrumentId}`} className="block truncate text-sm font-medium text-ink hover:underline">
                      {p.instrumentSymbol || p.instrumentName}
                    </Link>
                    <p className="text-xs text-muted">
                      <Quantity value={p.quantity} /> × <PriceCell p={p} inline />
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    <Money minor={p.valueMinor} currency={p.quoteCurrency} className="font-medium text-ink" unavailable={<Unavailable label="No price" />} />
                    <p className="text-xs text-muted">
                      <Percent value={weights.get(p.instrumentId) ?? null} />
                    </p>
                  </div>
                </li>
              ))}
              <li className="flex items-start gap-3 border-t border-line py-3">
                <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: chartColor(7) }} />
                <span className="flex-1 text-sm font-medium text-ink">Cash</span>
                <span className="text-right text-sm">
                  <Money minor={ps.cashMinor} currency={acctCcy} className="font-medium text-ink" />
                  <span className="block text-xs text-muted">
                    <Percent value={cashWeight} />
                  </span>
                </span>
              </li>
            </ul>
          )}
          {!ps.complete ? <p className="mt-3 text-xs text-warning">Some holdings have no price, so their value and weight are left out.</p> : null}
        </div>
      </div>
    )
  }

  return (
    <Card aria-labelledby="alloc-holdings">
      <div className="px-4 pt-4 md:px-5 md:pt-5">
        <Crumbs params={params} accountName={name} />
      </div>
      <CardHeader
        id="alloc-holdings"
        className="pt-2 md:pt-2"
        title={name}
        description="Holdings by weight in the account's own currencies."
        action={
          params.accountId ? (
            <Link to={`/accounts/${params.accountId}`} className={buttonClass({ size: 'sm', variant: 'secondary' })}>
              Open account <ArrowRight size={14} aria-hidden />
            </Link>
          ) : undefined
        }
      />
      <CardBody>{body()}</CardBody>
    </Card>
  )
}

function PriceCell({ p, inline }: { p: { instrumentId: string; unitPrice: string | null; quoteCurrency: string; priceDate: string | null; stale: boolean }; inline?: boolean }) {
  if (p.unitPrice === null)
    return (
      <Link to={`/instruments/${p.instrumentId}?addPrice=1`} className="link text-xs">
        Add a price
      </Link>
    )
  return (
    <span className={cn('inline-flex items-center gap-1.5', !inline && 'justify-end')}>
      <UnitPrice value={p.unitPrice} currency={p.quoteCurrency} />
      {p.stale ? (
        <Badge tone="warning" icon={<Clock size={11} aria-hidden />} title={p.priceDate ? `Last priced ${p.priceDate}` : undefined}>
          Stale
        </Badge>
      ) : null}
    </span>
  )
}

// ---- liquidity and purpose ----------------------------------------------------------------

function LiquiditySection({ summary, summaryError, onRetry }: { summary: ReportSummary | undefined; summaryError: Error | null; onRetry: () => void }) {
  const categories = useCategories()
  if (summaryError) return <ErrorState compact error={summaryError} onRetry={onRetry} />
  if (!summary) return <Skeleton className="h-48 rounded-lg" label="Loading liquidity" />
  const ccy = summary.baseCurrency
  const t = summary.totals
  const cats = (categories.data ?? []).filter((c) => !c.isArchived && c.assetOrLiability === 'asset')
  const liquid = cats.filter((c) => c.isLiquid).map((c) => c.name)
  const investible = cats.filter((c) => c.isInvestible).map((c) => c.name)
  return (
    <section aria-labelledby="alloc-split">
      <SectionTitle id="alloc-split" title="Liquidity and purpose" description="How much you could reach quickly, and how much is working as an investment rather than being used day to day." />
      <div className="card grid divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
        <SplitRow
          title="Liquid"
          part={t.liquid}
          whole={t.assets}
          ccy={ccy}
          partLabel="Liquid"
          restLabel="Illiquid"
          color={TOKENS.accent}
          explain={liquid.length ? `Counts as liquid: ${liquid.join(', ')}.` : 'Categories marked liquid count here.'}
        />
        <SplitRow
          title="Investible"
          part={t.investible}
          whole={t.assets}
          ccy={ccy}
          partLabel="Investible"
          restLabel="Lifestyle"
          color={chartColor(0)}
          explain={investible.length ? `Counts as investible: ${investible.join(', ')}.` : 'Categories marked investible count here.'}
        />
      </div>
      <p className="mt-2 text-xs text-subtle">
        Category flags decide what counts.{' '}
        <Link to="/settings/categories" className="link">
          Edit categories
        </Link>
      </p>
    </section>
  )
}

function SplitRow({ title, part, whole, ccy, partLabel, restLabel, color, explain }: { title: string; part: string; whole: string; ccy: string; partLabel: string; restLabel: string; color: string; explain: string }) {
  const p = Math.max(0, toChartNumber(part, ccy))
  const w = Math.max(0, toChartNumber(whole, ccy))
  const width = w > 0 ? Math.min(100, (p / w) * 100) : 0
  return (
    <div className="min-w-0 p-4 md:p-5">
      <h3 className="text-md font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-sm text-muted">
        <Money minor={part} currency={ccy} className="text-base font-semibold text-ink" /> of <Money minor={whole} currency={ccy} /> total assets
      </p>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-sunken" aria-hidden>
        <div className="h-full transition-[width] duration-[var(--dur-3)]" style={{ width: `${width}%`, background: color }} />
        <div className="h-full flex-1" style={{ backgroundImage: `repeating-linear-gradient(135deg, transparent 0 4px, ${TOKENS.grid} 4px 6px)` }} />
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label={`${title} legend`}>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: color }} /> {partLabel}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[3px] border border-line-strong/60 bg-sunken" /> {restLabel}
        </li>
      </ul>
      <p className="mt-2 text-xs text-subtle">{explain}</p>
    </div>
  )
}
