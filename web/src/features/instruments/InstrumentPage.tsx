import { ChevronLeft, Clock, PackageSearch, Pencil, Plus, Tag, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { api } from '@/api'
import { ApiProblem } from '@/api/problem'
import type { SecurityPrice } from '@/api/types'
import { DateText, FreshnessBadge, Money, Quantity, Unavailable, UnitPrice } from '@/components/format'
import { Badge } from '@/components/ui/Badge'
import { Button, buttonClass, IconButton } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { useRecorder } from '@/features/recording/recorder'
import { daysBetween } from '@/lib/dates'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { usePrefs } from '@/lib/prefs'
import { useApiMutation, useInstrument, useInstrumentHoldings } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { PriceHistoryChart } from './PriceHistoryChart'

const ASSET_TYPES: Record<string, string> = { stock: 'Stock', etf: 'ETF', fund: 'Fund' }
const IDENTIFIER_TYPES: Record<string, string> = { isin: 'ISIN', ticker: 'Ticker', ticker_exchange: 'Ticker and exchange', custom: 'Custom' }
const assetTypeLabel = (t: string) => ASSET_TYPES[t] ?? t.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
const sourceLabel = (s: string) => (s === 'manual' ? 'Manual' : s === 'import' ? 'Imported' : s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()))

const back = (
  <Link to="/settings/instruments" className="inline-flex h-9 items-center gap-1 rounded-md pr-2 text-sm text-muted hover:text-ink">
    <ChevronLeft size={16} aria-hidden />
    Instruments
  </Link>
)

export default function InstrumentPage() {
  const { instrumentId } = useParams()
  const [params, setParams] = useSearchParams()
  const recorder = useRecorder()
  const online = useOnline()
  const { today, timezone } = usePrefs()
  const detail = useInstrument(instrumentId)
  const holdings = useInstrumentHoldings(instrumentId)
  const [toDelete, setToDelete] = useState<SecurityPrice | null>(null)
  usePageTitle(detail.data?.instrument.name ?? 'Instrument')

  const addPrice = params.get('addPrice') === '1'
  const { open: openRecorder } = recorder
  useEffect(() => {
    if (!addPrice || !instrumentId) return
    openRecorder({ action: 'price', instrumentId })
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        next.delete('addPrice')
        return next
      },
      { replace: true },
    )
  }, [addPrice, instrumentId, openRecorder, setParams])

  const remove = useApiMutation({
    mutationFn: (p: SecurityPrice) => api.prices.remove(p.id),
    success: 'Price deleted',
    onSuccess: () => setToDelete(null),
  })

  if (detail.isPending) return <InstrumentSkeleton />
  if (detail.isError) {
    const notFound = ApiProblem.is(detail.error) && detail.error.status === 404
    return (
      <div className="page">
        <PageHeader title={notFound ? 'Instrument not found' : 'Instrument'} back={back} />
        <div className="card">
          {notFound ? (
            <EmptyState
              icon={<PackageSearch size={22} aria-hidden />}
              title="This instrument doesn't exist"
              action={
                <Link to="/settings/instruments" className={buttonClass({ variant: 'secondary' })}>
                  See all instruments
                </Link>
              }
            >
              It may have been deleted, or the link is incomplete.
            </EmptyState>
          ) : (
            <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
          )}
        </div>
      </div>
    )
  }

  const { instrument, prices } = detail.data
  const sortedPrices = [...prices].sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : a.effectiveDate > b.effectiveDate ? -1 : 0))
  const latest = instrument.latestPrice ?? sortedPrices[0] ?? null
  const threshold = holdings.data?.staleThresholdDays
  const age = latest ? daysBetween(latest.effectiveDate, today, timezone) : null
  const freshness = !latest ? 'missing' : threshold !== undefined && age !== null && age > threshold ? 'stale' : 'fresh'
  const openAdd = () => recorder.open({ action: 'price', instrumentId: instrument.id })
  const addButton = (
    <Button variant="primary" icon={<Plus size={16} aria-hidden />} onClick={openAdd} disabled={!online} title={online ? undefined : OFFLINE_REASON}>
      Add price
    </Button>
  )
  const heldIn = holdings.data?.holdings ?? []

  return (
    <div className="page">
      <PageHeader
        back={back}
        title={instrument.name}
        description={
          <span className="flex flex-wrap items-center gap-2 text-sm">
            {instrument.symbol ? <span className="num rounded-sm bg-sunken px-1.5 py-0.5 font-semibold tracking-wide text-ink">{instrument.symbol}</span> : null}
            <span>{assetTypeLabel(instrument.assetType)}</span>
            <span aria-hidden>·</span>
            <span>Quoted in {instrument.quoteCurrency}</span>
            {instrument.identifier ? (
              <>
                <span aria-hidden>·</span>
                <span className="num">
                  {IDENTIFIER_TYPES[instrument.identifierType] ?? instrument.identifierType} {instrument.identifier}
                  {instrument.exchangeMic ? ` · ${instrument.exchangeMic}` : ''}
                </span>
              </>
            ) : null}
            {instrument.archivedAt ? <Badge>Archived</Badge> : null}
          </span>
        }
        actions={
          <>
            <Link to={`/settings/instruments?edit=${instrument.id}`} className={buttonClass({ variant: 'secondary' })}>
              <Pencil size={16} aria-hidden />
              Edit details
            </Link>
            {addButton}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Card aria-labelledby="price-heading">
            <div className="px-4 pt-5 md:px-6 md:pt-6">
              <h2 id="price-heading" className="text-sm font-medium text-muted">
                Latest price
              </h2>
              <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-2">
                {latest ? (
                  <p className="display text-3xl text-ink">
                    <UnitPrice value={latest.price} currency={latest.currency} />
                  </p>
                ) : (
                  <p className="display text-2xl text-subtle">No price yet</p>
                )}
                <div className="flex flex-wrap items-center gap-2 pb-1.5 text-sm text-muted">
                  <FreshnessBadge freshness={freshness} asOf={latest?.effectiveDate} />
                  {latest ? <span>{sourceLabel(latest.source)}</span> : null}
                  {threshold !== undefined ? <span className="text-subtle">· Stale after {threshold} days</span> : null}
                </div>
              </div>
              {freshness === 'missing' ? (
                <Notice tone="warning" className="mt-4" title="Holdings of this instrument can't be valued" action={addButton}>
                  {heldIn.length ? `${heldIn.map((h) => h.accountName).join(' and ')} ${heldIn.length === 1 ? 'is' : 'are'} incomplete until a price is recorded.` : 'Record a price so any account that holds it can be valued.'}
                </Notice>
              ) : freshness === 'stale' ? (
                <Notice
                  tone="warning"
                  className="mt-4"
                  title={`Last priced ${age} days ago`}
                  action={
                    <Button size="sm" icon={<Clock size={15} aria-hidden />} onClick={openAdd} disabled={!online}>
                      Add a recent price
                    </Button>
                  }
                >
                  That's older than the {threshold}-day threshold for {assetTypeLabel(instrument.assetType).toLowerCase()}s. Values still use it, marked as stale.
                </Notice>
              ) : null}
            </div>
            <CardBody className="pt-5">
              <PriceHistoryChart
                name={instrument.symbol ?? instrument.name}
                currency={instrument.quoteCurrency}
                points={prices.map((p) => ({ date: p.effectiveDate.slice(0, 10), price: p.price }))}
                staleRanges={holdings.data?.staleRanges ?? []}
                height={260}
              />
            </CardBody>
          </Card>

          <Card aria-labelledby="history-heading">
            <CardHeader id="history-heading" title="Price history" description={`${prices.length} ${prices.length === 1 ? 'price' : 'prices'}, newest first. Each price applies from its date until the next one.`} />
            {sortedPrices.length === 0 ? (
              <EmptyState compact icon={<Tag size={20} aria-hidden />} title="No prices recorded" action={addButton}>
                Prices are entered by you, dated, and kept as history. There are no live market feeds.
              </EmptyState>
            ) : (
              <>
                <div className="scroll-x hidden md:block">
                  <table className="mt-2 w-full text-sm">
                    <caption className="sr-only">Price history for {instrument.name}</caption>
                    <thead>
                      <tr className="border-y border-line bg-sunken/60 text-left text-xs text-muted">
                        <th scope="col" className="py-2 pl-5 pr-3 font-medium">
                          Date
                        </th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                          Price
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Source
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Provenance
                        </th>
                        <th scope="col" className="py-2 pl-3 pr-5 text-right font-medium">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedPrices.map((p) => (
                        <tr key={p.id} className="border-b border-line last:border-b-0">
                          <td className="py-2 pl-5 pr-3">
                            <DateText value={p.effectiveDate} />
                          </td>
                          <td className="px-3 py-2 text-right font-medium">
                            <UnitPrice value={p.price} currency={p.currency} />
                          </td>
                          <td className="px-3 py-2 text-muted">{sourceLabel(p.source)}</td>
                          <td className="max-w-[260px] truncate px-3 py-2 text-muted">{p.provenance ?? <span className="text-subtle">—</span>}</td>
                          <td className="py-1 pl-3 pr-4 text-right">
                            <IconButton size="sm" label="Delete price" icon={<Trash2 size={15} aria-hidden />} onClick={() => setToDelete(p)} disabled={!online} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="divide-y divide-line border-t border-line md:hidden">
                  {sortedPrices.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 py-2.5 pl-4 pr-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink">
                          <UnitPrice value={p.price} currency={p.currency} />
                        </p>
                        <p className="truncate text-xs text-muted">
                          <DateText value={p.effectiveDate} /> · {sourceLabel(p.source)}
                          {p.provenance ? ` · ${p.provenance}` : ''}
                        </p>
                      </div>
                      <IconButton label="Delete price" icon={<Trash2 size={16} aria-hidden />} onClick={() => setToDelete(p)} disabled={!online} />
                    </li>
                  ))}
                </ul>
                <div className="h-2" />
              </>
            )}
          </Card>
        </div>

        <aside className="min-w-0 space-y-5" aria-label="Holdings and details">
          <Card aria-labelledby="held-heading">
            <CardHeader id="held-heading" title="Held in" description={holdings.data ? `Quantity and value in ${instrument.quoteCurrency}, at the latest price.` : undefined} />
            <CardBody className="pt-1">
              {holdings.isPending ? (
                <div className="space-y-3 py-2" role="status" aria-label="Loading holdings">
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                </div>
              ) : holdings.isError ? (
                <ErrorState compact error={holdings.error} onRetry={() => void holdings.refetch()} />
              ) : heldIn.length === 0 ? (
                <p className="py-2 text-sm text-muted">Not held in any account. Buy it from a position-tracked account to start tracking a holding.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {heldIn.map((h) => (
                    <li key={h.accountId} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <Link to={`/accounts/${h.accountId}`} className="block truncate text-sm font-medium text-ink hover:underline">
                          {h.accountName}
                        </Link>
                        <p className="text-xs text-muted">
                          <Quantity value={h.quantity} /> units
                        </p>
                      </div>
                      <div className="shrink-0 text-right text-sm font-medium">
                        <Money minor={h.valueMinor} currency={h.currency} unavailable={<Unavailable label="No price" reason="Add a price to value this holding." />} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card aria-labelledby="details-heading">
            <CardHeader id="details-heading" title="Details" />
            <CardBody className="pt-2">
              <dl className="divide-y divide-line text-sm">
                {[
                  ['Name', instrument.name],
                  ['Symbol', instrument.symbol ?? '—'],
                  ['Asset type', assetTypeLabel(instrument.assetType)],
                  ['Identifier', instrument.identifier ? `${IDENTIFIER_TYPES[instrument.identifierType] ?? instrument.identifierType} · ${instrument.identifier}` : '—'],
                  ['Exchange', instrument.exchangeMic ?? '—'],
                  ['Quote currency', instrument.quoteCurrency],
                  ['Freshness threshold', threshold !== undefined ? `${threshold} days` : '—'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 py-2">
                    <dt className="text-muted">{k}</dt>
                    <dd className="num min-w-0 truncate text-right text-ink">{v}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-4 py-2">
                  <dt className="text-muted">Added</dt>
                  <dd className="text-right text-ink">
                    <DateText value={instrument.createdAt} />
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-subtle">
                Change the threshold for all {assetTypeLabel(instrument.assetType).toLowerCase()}s in{' '}
                <Link to="/settings/preferences" className="link">
                  preferences
                </Link>
                .
              </p>
            </CardBody>
          </Card>
        </aside>
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => (o ? undefined : setToDelete(null))}
        title="Delete this price?"
        description={toDelete ? <>Holdings will be revalued with the previous price, or marked incomplete if there isn't one.</> : undefined}
        confirmLabel="Delete price"
        pending={remove.isPending}
        confirmDisabled={!online}
        onConfirm={() => toDelete && remove.mutate(toDelete)}
      >
        {toDelete ? (
          <p className="rounded-md bg-sunken px-3 py-2.5 text-sm">
            <UnitPrice value={toDelete.price} currency={toDelete.currency} className="font-medium text-ink" /> <span className="text-muted">on</span> <DateText value={toDelete.effectiveDate} />
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  )
}

function InstrumentSkeleton() {
  return (
    <div className="page" role="status" aria-label="Loading instrument">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-4 h-9 w-72 max-w-full" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <div className="card p-6">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-10 w-56" />
            <Skeleton className="mt-6 h-[260px]" />
          </div>
          <Skeleton className="h-64" />
        </div>
        <div className="space-y-5">
          <Skeleton className="h-48" />
          <Skeleton className="h-72" />
        </div>
      </div>
    </div>
  )
}
