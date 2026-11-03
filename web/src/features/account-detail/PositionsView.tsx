import { ArrowUpRight, Flag, Info, Layers } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import type { AccountPosition } from '@/api/types'
import { HBarList, type HBarItem } from '@/components/charts/HBarList'
import { chartColor, TOKENS } from '@/components/charts/utils'
import { DateText, FreshnessBadge, Money, Percent, Quantity, Unavailable, UnitPrice } from '@/components/format'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Segmented } from '@/components/ui/Segmented'
import { Skeleton } from '@/components/ui/Skeleton'
import { priceFixHref, rateFixHref } from '@/features/accounts/model'
import { ToolbarSelect } from '@/features/accounts/parts'
import { PriceHistoryChart } from '@/features/instruments/PriceHistoryChart'
import { useRecorder } from '@/features/recording/recorder'
import { cn } from '@/lib/cn'
import { decimalToChartNumber } from '@/lib/money'
import { usePositionEvents } from '@/lib/queries'
import { useAdvancedParams } from './advanced'
import { HoldingMenu, usePositionRowActions } from './row-menus'
import { ActivityFeed, CompletenessNotice, FlowLedger, LinkedGoalsCard, NotesCard, TabSection, ValueHero } from './sections'
import { ValueHistoryChart } from './ValueHistoryChart'
import { MovementAttributionCard } from './MovementAttributionCard'
import type { ViewProps } from './view-props'

const sourceLabel = (s: string) => (s === 'none' ? '—' : s === 'manual' ? 'Manual' : s === 'import' ? 'Imported' : s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()))

function PositionFreshness({ p }: { p: AccountPosition }) {
  if (p.unitPrice === null)
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <FreshnessBadge freshness="missing" />
        <Link to={priceFixHref(p.instrumentId)} className="link text-xs">
          Add price
        </Link>
      </span>
    )
  if (p.stale)
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <FreshnessBadge freshness="stale" asOf={p.priceDate} />
        <Link to={priceFixHref(p.instrumentId)} className="link text-xs">
          Update
        </Link>
      </span>
    )
  return <FreshnessBadge freshness="fresh" asOf={p.priceDate} />
}

function PositionValue({ p, currency }: { p: AccountPosition; currency: string }) {
  if (p.valueMinor !== null) return <Money minor={p.valueMinor} currency={currency} />
  if (p.unitPrice === null) return <Unavailable label="No price" reason={`Add a ${p.instrumentSymbol || p.instrumentName} price to value this holding. It is left out of the total, not counted as zero.`} />
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      <Unavailable label={`Missing ${p.quoteCurrency} rate`} reason={`Add a ${p.quoteCurrency} → ${currency} rate to value this holding in ${currency}.`} />
      <Link to={rateFixHref(p.quoteCurrency, currency)} className="link text-xs">
        Add rate
      </Link>
    </span>
  )
}

/** Position-tracked investment: leads with holdings, cash, and price freshness. */
export function PositionsView({ account, summary, analytics, extras, tab, onEdit }: ViewProps) {
  const recorder = useRecorder()
  const advanced = useAdvancedParams()
  const rowActions = usePositionRowActions(account)
  const archived = !!account.archivedAt
  const events = usePositionEvents(account.id, { limit: 100 })
  const a = analytics.data
  const ps = a?.positionSummary ?? null
  const positions = ps?.positions ?? []
  const c = account.currency
  const markers = (events.data?.items ?? []).flatMap((e) =>
    e.type === 'buy' || e.type === 'opening_position' || e.type === 'sell'
      ? [{ date: e.tradeDate, kind: e.type === 'sell' ? ('sell' as const) : ('buy' as const), label: `${e.type === 'sell' ? 'Sold' : e.type === 'buy' ? 'Bought' : 'Opening position'} · ${positions.find((p) => p.instrumentId === e.instrumentId)?.instrumentSymbol ?? ''}` }]
      : [],
  )

  const cashPct = extras.data?.cashWeightPercent ? Math.min(100, Math.max(0, decimalToChartNumber(extras.data.cashWeightPercent))) : null

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <TabSection tab="overview" current={tab} className="space-y-5">
          <CompletenessNotice account={account} analytics={a} summary={summary} />
          <Card aria-label={`${account.name} value`}>
            <ValueHero
              account={account}
              summary={summary}
              label="Total value · cash and holdings"
              extra={
                ps ? (
                  <div className="mt-5">
                    {cashPct !== null ? (
                      <div className="flex h-2 overflow-hidden rounded-full bg-sunken" aria-hidden>
                        <div className={cn(!ps.complete && 'opacity-60')} style={{ width: `${100 - cashPct}%`, background: chartColor(0) }} />
                        <div style={{ width: `${cashPct}%`, background: chartColor(7) }} />
                      </div>
                    ) : null}
                    <dl className="mt-3 grid grid-cols-2 gap-4 text-sm sm:max-w-md">
                      <div>
                        <dt className="flex items-center gap-1.5 text-xs text-muted">
                          <span aria-hidden className="size-2 rounded-full" style={{ background: chartColor(0) }} />
                          Holdings
                        </dt>
                        <dd className="mt-0.5 font-medium text-ink">
                          <Money minor={ps.positionsMinor} currency={c} />
                          {!ps.complete ? (
                            <span className="mt-1 block">
                              <Unavailable label="Incomplete" reason="One or more holdings has no usable price or rate and is left out." />
                            </span>
                          ) : null}
                        </dd>
                      </div>
                      <div>
                        <dt className="flex items-center gap-1.5 text-xs text-muted">
                          <span aria-hidden className="size-2 rounded-full" style={{ background: chartColor(7) }} />
                          Cash
                        </dt>
                        <dd className="mt-0.5 font-medium text-ink">
                          <Money minor={ps.cashMinor} currency={c} />
                          {extras.data?.cashWeightPercent ? (
                            <span className="ml-1.5 text-xs font-normal text-muted">
                              <Percent value={extras.data.cashWeightPercent} />
                            </span>
                          ) : null}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ) : null
              }
            />
            <CardBody className="pt-6">
              {analytics.isPending ? (
                <Skeleton className="h-[260px]" />
              ) : analytics.isError ? (
                <ErrorState compact error={analytics.error} onRetry={() => void analytics.refetch()} />
              ) : (
                <ValueHistoryChart account={account} history={analytics.data.history} historyComplete={analytics.data.historyComplete} markers={markers} color={TOKENS.accent} label="Value history" />
              )}
            </CardBody>
          </Card>
        </TabSection>

        <TabSection tab="holdings" current={tab}>
          <Card aria-labelledby="holdings-heading">
            <CardHeader
              id="holdings-heading"
              title="Holdings"
              description="Unit prices are entered by you. Each one shows its date and freshness."
              action={
                !archived ? (
                  <Button size="sm" icon={<Flag size={15} aria-hidden />} onClick={() => advanced.newTrade('opening_position')}>
                    Add holding
                  </Button>
                ) : undefined
              }
            />
            {analytics.isPending ? (
              <CardBody>
                <Skeleton className="h-40" />
              </CardBody>
            ) : analytics.isError ? (
              <ErrorState compact error={analytics.error} onRetry={() => void analytics.refetch()} />
            ) : positions.length === 0 ? (
              <EmptyState
                compact
                icon={<Layers size={20} aria-hidden />}
                title="No holdings yet"
                action={
                  !account.archivedAt ? (
                    <span className="flex flex-wrap justify-center gap-x-4 gap-y-2">
                      <button type="button" className="link text-sm font-medium" onClick={() => recorder.open({ action: 'buy', accountId: account.id })}>
                        Record a buy
                      </button>
                      <button type="button" className="link text-sm font-medium" onClick={() => advanced.newTrade('opening_position')}>
                        Add an opening position
                      </button>
                    </span>
                  ) : undefined
                }
              >
                Record a buy to move cash into an instrument, or add units you already held when tracking started. Value then follows the prices you add.
              </EmptyState>
            ) : (
              <>
                <div className="scroll-x hidden md:block">
                  <table className="mt-2 w-full min-w-[720px] text-sm">
                    <caption className="sr-only">Holdings in {account.name} with quantity, unit price, price date, source, value, and freshness</caption>
                    <thead>
                      <tr className="border-y border-line bg-sunken/60 text-left text-xs text-muted">
                        <th scope="col" className="py-2 pl-5 pr-3 font-medium">
                          Instrument
                        </th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                          Quantity
                        </th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                          Unit price
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Source
                        </th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                          Value in {c}
                        </th>
                        <th scope="col" className="py-2 pl-3 pr-3 font-medium">
                          Freshness
                        </th>
                        <th scope="col" className="w-12 py-2 pr-3">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((p) => (
                        <tr key={p.instrumentId} className="border-b border-line">
                          <td className="max-w-[240px] py-2.5 pl-5 pr-3">
                            <Link to={`/instruments/${p.instrumentId}`} className="block truncate font-medium text-ink hover:underline">
                              {p.instrumentName}
                            </Link>
                            <span className="num text-xs text-muted">{p.instrumentSymbol}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <Quantity value={p.quantity} />
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <UnitPrice value={p.unitPrice} currency={p.quoteCurrency} />
                            {p.priceDate ? (
                              <span className="block text-xs text-muted">
                                <DateText value={p.priceDate} />
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5 text-muted">{sourceLabel(p.priceSource)}</td>
                          <td className="px-3 py-2.5 text-right font-medium">
                            <PositionValue p={p} currency={c} />
                          </td>
                          <td className="py-2.5 pl-3 pr-3">
                            <PositionFreshness p={p} />
                          </td>
                          <td className="py-1.5 pr-3 text-right">
                            <HoldingMenu account={account} position={p} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {ps ? (
                      <tfoot>
                        <tr className="text-sm">
                          <th scope="row" className="py-2.5 pl-5 pr-3 text-left font-medium text-ink">
                            Cash
                          </th>
                          <td colSpan={3} className="px-3 py-2.5 text-xs text-muted">
                            Uninvested balance in {c}
                          </td>
                          <td className="px-3 py-2.5 text-right font-medium">
                            <Money minor={ps.cashMinor} currency={c} />
                          </td>
                          <td colSpan={2} />
                        </tr>
                      </tfoot>
                    ) : null}
                  </table>
                </div>
                <ul className="mt-1 divide-y divide-line border-t border-line md:hidden">
                  {positions.map((p) => (
                    <li key={p.instrumentId} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link to={`/instruments/${p.instrumentId}`} className="block truncate text-sm font-medium text-ink hover:underline">
                            {p.instrumentName}
                          </Link>
                          <p className="text-xs text-muted">
                            <span className="num">{p.instrumentSymbol}</span> · <Quantity value={p.quantity} /> × <UnitPrice value={p.unitPrice} currency={p.quoteCurrency} />
                          </p>
                        </div>
                        <div className="shrink-0 text-right text-sm font-medium">
                          <PositionValue p={p} currency={c} />
                        </div>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-3 text-xs">
                        <PositionFreshness p={p} />
                        <span className="-mr-2">
                          <HoldingMenu account={account} position={p} />
                        </span>
                      </div>
                    </li>
                  ))}
                  {ps ? (
                    <li className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <span className="font-medium text-ink">Cash</span>
                      <Money minor={ps.cashMinor} currency={c} className="font-medium" />
                    </li>
                  ) : null}
                </ul>
                <div className="h-2" />
              </>
            )}
          </Card>
        </TabSection>

        <TabSection tab="activity" current={tab}>
          <ActivityFeed
            account={account}
            filters
            title="Trades, prices, and cash"
            description="Newest first. Use a row’s menu to correct a trade or undo a corporate action."
            emptyTitle="Nothing recorded yet"
            emptyBody="Buys, sells, price updates, deposits, dividends, and fees appear here in date order."
            rowMenu={rowActions.menu}
          />
          {rowActions.dialogs}
        </TabSection>
      </div>

      <aside className="min-w-0 space-y-5" aria-label="Holdings detail and account summary">
        <TabSection tab="holdings" current={tab} className="space-y-5">
          <WeightsCard extras={extras} />
          <PriceHistoryCard extras={extras} />
        </TabSection>
        <TabSection tab="overview" current={tab} className="space-y-5">
          {a?.movementAttribution ? <MovementAttributionCard account={account} attribution={a.movementAttribution} /> : null}
          <Card aria-labelledby="returns-heading">
            <CardHeader id="returns-heading" title="Returns" />
            <CardBody className="pt-2">
              <div className="flex gap-3 rounded-md border border-dashed border-line-strong/60 bg-sunken/50 px-3.5 py-3">
                <Info size={18} aria-hidden className="mt-0.5 shrink-0 text-info" />
                <div className="text-sm">
                  <p className="font-medium text-ink">Return methodology unavailable for position-tracked accounts</p>
                  <p className="mt-1 text-muted">
                    {a && !a.movementAttributionAvailable && a.movementAttribution?.returnMessage
                      ? a.movementAttribution.returnMessage
                      : 'Buys and sells move money between cash and holdings, so a simple return would mislead. No return is shown until a holdings-aware method is available.'}
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>
          <Card aria-labelledby="cash-flows-heading">
            <CardHeader id="cash-flows-heading" title="Cash in and out" description="Money that crossed the account boundary. Trades are internal moves, not flows." />
            <CardBody className="pt-2">
              {analytics.isPending ? <Skeleton className="h-36" /> : analytics.isError ? <ErrorState compact error={analytics.error} onRetry={() => void analytics.refetch()} /> : <FlowLedger account={account} analytics={analytics.data} showGain={false} />}
            </CardBody>
          </Card>
          <LinkedGoalsCard goals={extras.data?.linkedGoals ?? (extras.isError ? [] : undefined)} />
        </TabSection>
        <TabSection tab="notes" current={tab}>
          <NotesCard account={account} onEdit={onEdit} />
        </TabSection>
      </aside>
    </div>
  )
}

function WeightsCard({ extras }: { extras: ViewProps['extras'] }) {
  const e = extras.data
  const items: HBarItem[] = e
    ? [
        ...e.weights.map((w, i) => ({
          id: w.instrumentId,
          label: w.symbol || w.name,
          percent: w.weightPercent ? decimalToChartNumber(w.weightPercent) : 0,
          color: chartColor(i),
          value: w.weightPercent ? <Percent value={w.weightPercent} /> : <Unavailable label="No value" />,
          incomplete: w.weightPercent === null,
        })),
        ...(e.cashWeightPercent ? [{ id: 'cash', label: 'Cash', percent: decimalToChartNumber(e.cashWeightPercent), color: chartColor(7), value: <Percent value={e.cashWeightPercent} /> }] : []),
      ]
    : []
  return (
    <Card aria-labelledby="weights-heading">
      <CardHeader id="weights-heading" title="Position weights" description="Share of the account's value." />
      <CardBody className="pt-1">
        {extras.isPending ? (
          <Skeleton className="h-32" />
        ) : extras.isError ? (
          <ErrorState compact error={extras.error} onRetry={() => void extras.refetch()} />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">Weights appear once the account holds an instrument.</p>
        ) : (
          <>
            <HBarList items={items} ariaLabel="Position weights" />
            {items.some((i) => i.incomplete) ? <p className="mt-2 text-xs text-muted">Holdings without a price have no weight until one is added.</p> : null}
          </>
        )}
      </CardBody>
    </Card>
  )
}

function PriceHistoryCard({ extras }: { extras: ViewProps['extras'] }) {
  const history = extras.data?.priceHistory ?? []
  const [picked, setPicked] = useState<string | null>(null)
  const selected = history.find((h) => h.instrumentId === picked) ?? history[0]
  const index = selected ? history.indexOf(selected) : 0
  const selector =
    history.length > 1 ? (
      history.length <= 4 ? (
        <Segmented size="sm" label="Instrument" value={selected?.instrumentId ?? ''} onChange={setPicked} options={history.map((h) => ({ value: h.instrumentId, label: h.symbol || h.name, ariaLabel: h.name }))} />
      ) : (
        <ToolbarSelect label="Instrument" value={selected?.instrumentId ?? ''} onChange={setPicked} options={history.map((h) => ({ value: h.instrumentId, label: h.symbol || h.name }))} />
      )
    ) : null
  return (
    <Card aria-labelledby="prices-heading">
      <CardHeader
        id="prices-heading"
        title="Price history"
        description={selected ? `${selected.name} in ${selected.currency}. Stale after ${selected.staleThresholdDays} days.` : undefined}
        action={
          selected ? (
            <Link to={`/instruments/${selected.instrumentId}`} className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs font-medium text-accent hover:bg-accent-soft">
              Instrument
              <ArrowUpRight size={14} aria-hidden />
            </Link>
          ) : undefined
        }
      />
      <CardBody className="pt-2">
        {extras.isPending ? (
          <Skeleton className="h-[200px]" />
        ) : extras.isError ? (
          <ErrorState compact error={extras.error} onRetry={() => void extras.refetch()} />
        ) : !selected ? (
          <p className="text-sm text-muted">Prices appear here once the account holds an instrument.</p>
        ) : (
          <>
            {selector ? <div className="mb-3">{selector}</div> : null}
            <PriceHistoryChart key={selected.instrumentId} name={selected.symbol || selected.name} currency={selected.currency} points={selected.points} staleRanges={selected.staleRanges} height={200} colorIndex={index} />
          </>
        )}
      </CardBody>
    </Card>
  )
}
