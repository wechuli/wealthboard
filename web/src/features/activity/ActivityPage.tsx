import { ListFilter, Plus, ScrollText, Search, SearchX, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import type { Account, ActivityItem } from '@/api/types'
import { Button, IconButton } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { DateField, inputClass, SelectField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { Segmented } from '@/components/ui/Segmented'
import { Spinner } from '@/components/ui/Spinner'
import { useRecorder } from '@/features/recording/recorder'
import { cn } from '@/lib/cn'
import { usePrefs } from '@/lib/prefs'
import { useAccounts } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { isKind, KIND_LABELS, KINDS, kindOfType, TYPES_BY_KIND, typeLabel, type ActivityKind } from './activityMeta'
import { DeleteActivityDialog } from './DeleteActivityDialog'
import { EditTransactionSheet } from './EditTransactionSheet'
import { groupByDate, LedgerList, LedgerSkeleton, LedgerTable, type RowActions } from './LedgerRows'
import { PAGE_SIZE, useActivityLedger, type LedgerFilters } from './useActivityLedger'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const SEARCH_DEBOUNCE_MS = 300

function dateParam(value: string | null): string | undefined {
  return value && DATE_RE.test(value) ? value : undefined
}

type Patch = Partial<Record<'kind' | 'account' | 'type' | 'from' | 'to' | 'q', string | null | undefined>>

export default function ActivityPage() {
  usePageTitle('Activity')
  const recorder = useRecorder()
  const { today } = usePrefs()
  const [params, setParams] = useSearchParams()

  const kindParam = params.get('kind')
  const kind: ActivityKind | undefined = isKind(kindParam) ? kindParam : undefined
  const accountId = params.get('account') || undefined
  const typeParam = params.get('type') || undefined
  const type = typeParam && (!kind || TYPES_BY_KIND[kind].includes(typeParam)) ? typeParam : undefined
  const from = dateParam(params.get('from'))
  const to = dateParam(params.get('to'))
  const q = params.get('q')?.trim() || undefined

  const filters = useMemo<LedgerFilters>(() => {
    const f: LedgerFilters = {}
    if (kind) f.kind = kind
    if (accountId) f.accountId = accountId
    if (type) f.type = type
    if (from) f.from = from
    if (to) f.to = to
    if (q) f.q = q
    return f
  }, [kind, accountId, type, from, to, q])

  const ledger = useActivityLedger(filters)
  const accountsQuery = useAccounts('all')

  const update = useCallback(
    (patch: Patch) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(patch)) {
            if (v) next.set(k, v)
            else next.delete(k)
          }
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  // Search: the input updates instantly; the URL (and so the query) follows after a short pause.
  const [qInput, setQInput] = useState(q ?? '')
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const onSearch = (value: string) => {
    setQInput(value)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => update({ q: value.trim() || null }), SEARCH_DEBOUNCE_MS)
  }

  const advancedCount = [accountId, type, from, to].filter(Boolean).length
  const hasFilters = !!(kind || accountId || type || from || to || q || qInput.trim())
  const [showMore, setShowMore] = useState(() => advancedCount > 0)

  const clearFilters = () => {
    window.clearTimeout(timer.current)
    setQInput('')
    update({
      kind: null,
      account: null,
      type: null,
      from: null,
      to: null,
      q: null,
    })
  }

  const accounts = useMemo(() => new Map<string, Account>((accountsQuery.data ?? []).map((a) => [a.id, a])), [accountsQuery.data])
  const accountOptions = useMemo(() => {
    const list = [...(accountsQuery.data ?? [])].sort((a, b) => (!!a.archivedAt === !!b.archivedAt ? a.name.localeCompare(b.name) : a.archivedAt ? 1 : -1))
    return [
      { value: '', label: 'All accounts' },
      ...list.map((a) => ({
        value: a.id,
        label: a.archivedAt ? `${a.name} (archived)` : a.name,
      })),
    ]
  }, [accountsQuery.data])
  const typeOptions = useMemo(() => {
    const types = kind ? TYPES_BY_KIND[kind] : KINDS.flatMap((k) => TYPES_BY_KIND[k])
    return [
      {
        value: '',
        label: kind ? `All ${KIND_LABELS[kind].label.toLowerCase()}` : 'All types',
      },
      ...types.map((t) => ({ value: t, label: typeLabel(t) })),
    ]
  }, [kind])

  const dateError = from && to && from > to ? 'The end date is before the start date' : undefined

  const items = useMemo(() => ledger.data?.pages.flatMap((p) => p.items) ?? [], [ledger.data])
  const groups = useMemo(() => groupByDate(items), [items])
  const updating = ledger.isPlaceholderData || (ledger.isFetching && !ledger.isFetchingNextPage && !ledger.isPending)

  const [edit, setEdit] = useState<{
    item: ActivityItem
    open: boolean
  } | null>(null)
  const [del, setDel] = useState<{ item: ActivityItem; open: boolean } | null>(null)
  const actions: RowActions = useMemo(
    () => ({
      onEdit: (item) => setEdit({ item, open: true }),
      onDelete: (item) => setDel({ item, open: true }),
    }),
    [],
  )

  const kindOptions: { value: ActivityKind | 'all'; label: ReactNode }[] = [
    { value: 'all', label: 'All' },
    ...KINDS.map((k) => ({
      value: k,
      label: (
        <>
          <span className="md:hidden">{KIND_LABELS[k].short}</span>
          <span className="hidden md:inline">{KIND_LABELS[k].label}</span>
        </>
      ),
    })),
  ]

  let body: ReactNode
  if (ledger.isPending) body = <LedgerSkeleton />
  else if (ledger.isError && !ledger.data) body = <ErrorState error={ledger.error} onRetry={() => void ledger.refetch()} title="Activity couldn't be loaded" />
  else if (items.length === 0 && !ledger.isPlaceholderData && !hasFilters)
    body = (
      <EmptyState
        icon={<ScrollText size={22} aria-hidden />}
        title="Your ledger starts with your first entry"
        action={
          <>
            <Button variant="primary" icon={<Plus size={16} aria-hidden />} onClick={() => recorder.open()}>
              Record activity
            </Button>
            <Button onClick={() => recorder.open({ action: 'account' })}>Add an account</Button>
          </>
        }
      >
        Deposits, interest, valuations, trades, and price updates from every account land here in one place, newest first. Add an account, then record what happened.
      </EmptyState>
    )
  else if (items.length === 0 && !ledger.isPlaceholderData)
    body = (
      <EmptyState
        compact
        icon={<SearchX size={22} aria-hidden />}
        title="Nothing matches these filters"
        action={
          <Button onClick={clearFilters} icon={<X size={16} aria-hidden />}>
            Clear filters
          </Button>
        }
      >
        {q ? `No entries mention “${q}”${kind || accountId || type || from || to ? ' with the other filters applied' : ''}.` : 'Try a wider date range, another account, or all types.'}
      </EmptyState>
    )
  else
    body = (
      <div className={cn('transition-opacity duration-[var(--dur-2)]', updating && 'opacity-60')} aria-busy={updating || undefined}>
        <LedgerTable groups={groups} accounts={accounts} actions={actions} />
        <LedgerList groups={groups} accounts={accounts} actions={actions} />
      </div>
    )

  const showCount = !ledger.isPending && items.length > 0

  return (
    <div className="page">
      <PageHeader
        title="Activity"
        description="One ledger for every account: transactions, valuations, trades, and price updates, newest first."
        actions={
          <Button variant="primary" icon={<Plus size={17} aria-hidden />} onClick={() => recorder.open()}>
            Record activity
          </Button>
        }
      />

      <search className="mb-4 grid gap-3" aria-label="Filter activity">
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <div className="relative min-w-0 flex-1 basis-40 md:max-w-sm">
            <label htmlFor="activity-search" className="sr-only">
              Search activity
            </label>
            <Search size={17} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
            <input
              id="activity-search"
              type="search"
              value={qInput}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search descriptions, accounts, symbols"
              autoComplete="off"
              className={cn(inputClass, 'pl-10 pr-11 [&::-webkit-search-cancel-button]:hidden')}
            />
            {qInput ? (
              <IconButton
                label="Clear search"
                icon={<X size={16} aria-hidden />}
                size="sm"
                tooltip={false}
                className="absolute right-1 top-1/2 -translate-y-1/2"
                onClick={() => {
                  window.clearTimeout(timer.current)
                  setQInput('')
                  update({ q: null })
                }}
              />
            ) : null}
          </div>
          <Button className="md:hidden" icon={<ListFilter size={16} aria-hidden />} aria-expanded={showMore} aria-controls="activity-more-filters" onClick={() => setShowMore((v) => !v)}>
            Filters
            {advancedCount > 0 ? (
              <span className="num grid size-5 place-items-center rounded-full bg-accent text-xs text-on-accent">
                {advancedCount}
                <span className="sr-only"> active</span>
              </span>
            ) : null}
          </Button>
          <Segmented
            label="Kind of activity"
            value={kind ?? 'all'}
            onChange={(v) => {
              const nextKind = v === 'all' ? undefined : v
              update({
                kind: nextKind ?? null,
                type: type && nextKind && !TYPES_BY_KIND[nextKind].includes(type) ? null : type,
              })
            }}
            options={kindOptions}
            className="w-full justify-between md:ml-auto md:w-auto"
          />
        </div>

        <div
          id="activity-more-filters"
          className={cn('grid-cols-1 items-start gap-3 sm:grid-cols-2 md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,0.85fr)_auto]', showMore ? 'grid' : 'hidden')}
        >
          <SelectField label="Account" value={accountId ?? ''} onChange={(e) => update({ account: e.target.value || null })} options={accountOptions} />
          <SelectField
            label="Type"
            value={type ?? ''}
            onChange={(e) => {
              const v = e.target.value
              update({
                type: v || null,
                kind: v ? (kindOfType(v) ?? kind) : kind,
              })
            }}
            options={typeOptions}
          />
          <DateField label="From" value={from ?? ''} max={to ?? today} onChange={(e) => update({ from: e.target.value || null })} />
          <DateField label="To" value={to ?? ''} min={from} max={today} onChange={(e) => update({ to: e.target.value || null })} error={dateError} />
          <div className="flex sm:col-span-2 md:col-span-1 md:pt-6">
            <Button variant="ghost" onClick={clearFilters} disabled={!hasFilters} icon={<X size={16} aria-hidden />} className="w-full md:w-auto">
              Clear filters
            </Button>
          </div>
        </div>
      </search>

      <div className="mb-2 flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-sm text-muted">
        <p aria-live="polite" className="num">
          {showCount ? (
            <>
              {items.length} {items.length === 1 ? 'entry' : 'entries'}
              {ledger.hasNextPage ? ' shown, more available' : hasFilters ? (items.length === 1 ? ' matches' : ' match') : ''}
            </>
          ) : null}
        </p>
        {updating ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-subtle">
            <Spinner size={13} />
            Updating
          </span>
        ) : null}
      </div>

      <section aria-label="Ledger" className="card">
        {body}
      </section>

      {ledger.isFetchNextPageError ? (
        <Notice
          tone="negative"
          title="The next entries couldn't be loaded"
          className="mt-4"
          action={
            <Button size="sm" onClick={() => void ledger.fetchNextPage()}>
              Try again
            </Button>
          }
        >
          The entries above are still accurate.
        </Notice>
      ) : null}

      {showCount ? (
        <div className="mt-5 flex justify-center">
          {ledger.hasNextPage ? (
            <Button onClick={() => void ledger.fetchNextPage()} loading={ledger.isFetchingNextPage}>
              Load {PAGE_SIZE} more
            </Button>
          ) : (
            <p className="flex w-full items-center gap-3 text-xs text-subtle">
              <span aria-hidden className="h-px flex-1 bg-line" />
              {hasFilters ? 'End of matching entries' : 'Start of your ledger'}
              <span aria-hidden className="h-px flex-1 bg-line" />
            </p>
          )}
        </div>
      ) : null}

      {edit ? <EditTransactionSheet key={edit.item.id} item={edit.item} open={edit.open} onOpenChange={(open) => setEdit((s) => (s ? { ...s, open } : s))} /> : null}
      {del ? <DeleteActivityDialog key={`${del.item.kind}-${del.item.id}`} item={del.item} open={del.open} onOpenChange={(open) => setDel((s) => (s ? { ...s, open } : s))} /> : null}
    </div>
  )
}
