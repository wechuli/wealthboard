/**
 * Investment History v1 import for position-tracked accounts: preview instruments, trades, cash, and prices,
 * see current versus projected values and completeness, then commit exactly the previewed file (all or nothing).
 */
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, Download, FileJson, FileSpreadsheet, FileUp, RotateCcw, Upload } from 'lucide-react'
import { useId, useState, type DragEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { api } from '@/api'
import type { ImportFile } from '@/api/datasource'
import { ApiProblem, problemMessage } from '@/api/problem'
import type { Account, components, InvestmentHistoryImportResult } from '@/api/types'
import { DateText, Delta, Money, Quantity, UnitPrice } from '@/components/format'
import { Badge } from '@/components/ui/Badge'
import { Button, buttonClass } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Notice } from '@/components/ui/Notice'
import { Segmented } from '@/components/ui/Segmented'
import { activityLabel, rateFixHref } from '@/features/accounts/model'
import { ReviewTable } from '@/features/account-detail/workflow-kit'
import { ManualPrompt } from '@/features/review/ManualPrompt'
import { cn } from '@/lib/cn'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { usePrefs } from '@/lib/prefs'
import { useApiMutation } from '@/lib/queries'
import { Steps } from './DirectImport'
import { downloadText, INVESTMENT_CSV_HEADERS, sampleInvestmentCsv, sampleInvestmentJson, type InvestmentTemplate } from './sample'

type Row = components['schemas']['InvestmentImportRow']
type Outcome = 'all' | 'ready' | 'duplicate' | 'problem'

const MAX_BYTES = 5 * 1024 * 1024
const COLLECTION_LABEL: Record<string, string> = { instruments: 'Instrument', position_events: 'Trade', cash_transactions: 'Cash', prices: 'Price' }
const TEMPLATES: { id: InvestmentTemplate; label: string; description: string }[] = [
  { id: 'holdings', label: 'Opening holdings', description: 'Instrument, quantity, price, and optional cost basis. Creates the instrument, an opening position, and its price.' },
  { id: 'trades', label: 'Trades', description: 'Buys, sells, and quantity adjustments for instruments that already exist.' },
  { id: 'cash', label: 'Cash', description: 'Deposits, withdrawals, interest, dividends, fees, and adjustments.' },
  { id: 'prices', label: 'Prices', description: 'Dated unit prices in each instrument’s quote currency.' },
]

const outcomeOf = (r: Row): Exclude<Outcome, 'all'> => (r.status === 'ready' || r.status === 'imported' ? 'ready' : r.status.startsWith('duplicate') ? 'duplicate' : 'problem')
const minor = (n: number | undefined | null) => (n === undefined || n === null ? null : String(n))
const signedQty = (v: string) => (v.startsWith('-') || /^0+(\.0+)?$/.test(v) ? v : `+${v}`)

function OutcomeBadge({ row }: { row: Row }) {
  const o = outcomeOf(row)
  if (o === 'ready') return <Badge tone="positive">{row.status === 'imported' ? 'Imported' : 'Ready'}</Badge>
  if (o === 'duplicate') return <Badge tone="neutral">Duplicate</Badge>
  return <Badge tone="negative">{row.code ? activityLabel(row.code) : 'Problem'}</Badge>
}

/** A semantic table at md and up, a stacked list below. */
function ResponsiveTable<T>({
  caption,
  rows,
  rowKey,
  columns,
  mobile,
  rowClassName,
}: {
  caption: string
  rows: T[]
  rowKey(r: T, i: number): string
  columns: { header: string; cell(r: T): ReactNode; align?: 'right'; className?: string }[]
  mobile(r: T): ReactNode
  rowClassName?(r: T): string | undefined
}) {
  return (
    <>
      <div className="scroll-x hidden md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-y border-line bg-sunken/60 text-left text-xs text-muted">
              {columns.map((c, i) => (
                <th key={c.header} scope="col" className={cn('px-3 py-2 font-medium', i === 0 && 'pl-4 md:pl-6', i === columns.length - 1 && 'pr-4 md:pr-6', c.align === 'right' && 'text-right')}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={rowKey(r, ri)} className={cn('border-b border-line last:border-b-0', rowClassName?.(r))}>
                {columns.map((c, i) => (
                  <td key={c.header} className={cn('px-3 py-2 align-top', i === 0 && 'pl-4 md:pl-6', i === columns.length - 1 && 'pr-4 md:pr-6', c.align === 'right' && 'text-right', c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line border-y border-line md:hidden">
        {rows.map((r, ri) => (
          <li key={rowKey(r, ri)} className={cn('px-4 py-3', rowClassName?.(r))}>
            {mobile(r)}
          </li>
        ))}
      </ul>
    </>
  )
}

function SectionTitle({ id, title, description }: { id: string; title: string; description?: ReactNode }) {
  return (
    <div className="px-4 pb-2 pt-5 md:px-6">
      <h3 id={id} className="text-sm font-semibold text-ink">
        {title}
      </h3>
      {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
    </div>
  )
}

export function InvestmentImport({ account }: { account: Account }) {
  const online = useOnline()
  const { today } = usePrefs()
  const inputId = useId()
  const c = account.currency
  const [file, setFile] = useState<ImportFile | null>(null)
  const [fileSize, setFileSize] = useState(0)
  const [localError, setLocalError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [filter, setFilter] = useState<Outcome>('all')

  const preview = useMutation<InvestmentHistoryImportResult, Error, ImportFile>({
    mutationFn: (f) => {
      if (!navigator.onLine) throw new ApiProblem({ type: 'about:blank', title: 'Offline', status: 0, detail: OFFLINE_REASON })
      return api.imports.previewInvestmentHistory(account.id, f)
    },
  })
  const commit = useApiMutation({
    mutationFn: ({ f, hash }: { f: ImportFile; hash: string }) => api.imports.commitInvestmentHistory(account.id, f, hash),
    success: (r) => {
      const n = r.summary.imported ?? 0
      return `Imported ${n} ${n === 1 ? 'record' : 'records'} into ${account.name}`
    },
    toastError: false,
  })

  const reset = () => {
    setFile(null)
    setLocalError(null)
    setFilter('all')
    preview.reset()
    commit.reset()
  }

  const accept = async (picked: File | undefined) => {
    if (!picked) return
    preview.reset()
    commit.reset()
    setFilter('all')
    const ext = picked.name.split('.').pop()?.toLowerCase()
    if (ext !== 'csv' && ext !== 'json') {
      setLocalError(`“${picked.name}” isn't a CSV or JSON file. Use the JSON envelope or one of the four CSV templates.`)
      return
    }
    if (picked.size > MAX_BYTES) {
      setLocalError('That file is larger than 5 MB. Split it into smaller files, for example holdings first and then trades.')
      return
    }
    setLocalError(null)
    const f: ImportFile = { name: picked.name, content: await picked.text(), format: ext }
    setFile(f)
    setFileSize(picked.size)
    preview.mutate(f)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    void accept(e.dataTransfer.files[0])
  }

  // ---- done ----
  if (commit.isSuccess) {
    const r = commit.data
    const n = r.summary.imported ?? 0
    return (
      <>
        <Steps current={2} />
        <Card aria-labelledby="investment-import-done">
          <div className="flex flex-col items-start gap-4 p-6 md:flex-row md:p-8">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-positive-soft text-positive">
              <CheckCircle2 size={24} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="investment-import-done" className="display text-2xl text-ink">
                {n} {n === 1 ? 'record' : 'records'} imported
              </h2>
              <p className="mt-1.5 text-base text-muted">
                {account.name} now includes {file?.name}. Quantities, cash, and values were replayed from the earliest imported date.
              </p>
              <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted">Account value now</dt>
                  <dd className="mt-0.5 text-md font-semibold text-ink">
                    <Money minor={minor(r.finalBalanceMinor) ?? minor(r.projected.totalMinor)} currency={c} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Skipped as duplicates</dt>
                  <dd className="num mt-0.5 text-md font-semibold text-ink">{r.summary.skippedDuplicates}</dd>
                </div>
                <div>
                  <dt className="text-muted">Records in file</dt>
                  <dd className="num mt-0.5 text-md font-semibold text-ink">{r.summary.records}</dd>
                </div>
              </dl>
              <div className="mt-6 flex flex-wrap gap-2">
                <Link to={`/accounts/${account.id}?tab=holdings`} className={buttonClass({ variant: 'primary' })}>
                  View holdings
                </Link>
                <Button icon={<RotateCcw size={16} aria-hidden />} onClick={reset}>
                  Import another file
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </>
    )
  }

  const p = preview.data
  // ---- review ----
  if (file && p) {
    const rows = p.rows ?? []
    const counts = {
      ready: p.summary.ready ?? rows.filter((r) => outcomeOf(r) === 'ready').length,
      duplicate: p.summary.skippedDuplicates,
      problem: Math.max(p.summary.failed, rows.filter((r) => outcomeOf(r) === 'problem').length),
    }
    const shown = rows.filter((r) => filter === 'all' || outcomeOf(r) === filter)
    const instrumentChanges = p.instrumentChanges ?? []
    const eventChanges = p.eventChanges ?? []
    const priceChanges = p.priceChanges ?? []
    const instrumentName = (id: string) => {
      const i = instrumentChanges.find((x) => x.instrumentId === id)
      return i ? i.symbol || i.name : '—'
    }
    const negative = eventChanges.filter((e) => e.afterQuantity.startsWith('-'))
    const commitProblem = commit.error
    const mismatch = ApiProblem.is(commitProblem) && commitProblem.status === 409
    const canCommit = p.canCommit && !!p.hash && counts.problem === 0 && counts.ready > 0
    const missingPrices = p.projected.missingPrices ?? []
    const missingCurrencies = p.projected.missingCurrencies ?? []

    return (
      <>
        <Steps current={1} />
        <Card aria-labelledby="investment-preview-heading">
          <div className="flex flex-wrap items-start justify-between gap-4 px-4 pt-5 md:px-6">
            <div className="min-w-0">
              <h2 id="investment-preview-heading" className="text-md font-semibold text-ink">
                Review before importing
              </h2>
              <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-muted">
                {file.format === 'csv' ? <FileSpreadsheet size={15} aria-hidden /> : <FileJson size={15} aria-hidden />}
                <span className="truncate">{file.name}</span>
                <span className="shrink-0 text-subtle">· {Math.max(1, Math.round(fileSize / 1024))} KB</span>
              </p>
            </div>
            <Button variant="ghost" size="sm" icon={<RotateCcw size={15} aria-hidden />} onClick={reset}>
              Choose a different file
            </Button>
          </div>

          <CardBody className="space-y-4 pt-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
              <ReviewTable
                caption={`Current and projected value of ${account.name}`}
                beforeLabel="Now"
                afterLabel="After import"
                rows={[
                  { label: 'Cash', before: <Money minor={minor(p.current.cashMinor)} currency={c} />, after: <Money minor={minor(p.projected.cashMinor)} currency={c} /> },
                  { label: 'Holdings', before: <Money minor={minor(p.current.positionsMinor)} currency={c} />, after: <Money minor={minor(p.projected.positionsMinor)} currency={c} /> },
                  { label: 'Total', strong: true, before: <Money minor={minor(p.current.totalMinor)} currency={c} />, after: <Money minor={minor(p.projected.totalMinor)} currency={c} /> },
                ]}
              />
              <dl className="grid content-start gap-3 rounded-md border border-line bg-surface px-4 py-3 text-sm">
                <div>
                  <dt className="text-xs text-muted">Net change</dt>
                  <dd className="mt-0.5 font-medium">
                    <Delta minor={minor(p.netChangeMinor)} currency={c} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Dates covered</dt>
                  <dd className="mt-0.5 font-medium text-ink">
                    {p.dateRange ? (
                      <>
                        <DateText value={p.dateRange.from} /> – <DateText value={p.dateRange.to} />
                      </>
                    ) : (
                      'No dated records'
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Records</dt>
                  <dd className="num mt-0.5 font-medium text-ink">
                    {p.summary.records} · {counts.ready} ready · {counts.duplicate} duplicate · {counts.problem} {counts.problem === 1 ? 'problem' : 'problems'}
                  </dd>
                </div>
              </dl>
            </div>

            {!p.projected.complete || missingPrices.length || missingCurrencies.length ? (
              <Notice
                tone="warning"
                title="The projected value will be incomplete"
                action={
                  missingCurrencies.length ? (
                    <span className="flex flex-wrap gap-2">
                      {missingCurrencies.map((cur) => (
                        <Link key={cur} to={rateFixHref(cur, c)} className="link text-sm font-medium">
                          Add {cur} rate
                        </Link>
                      ))}
                    </span>
                  ) : undefined
                }
              >
                <ul className="list-disc space-y-0.5 pl-4">
                  {missingPrices.length ? <li>No usable price for {missingPrices.join(', ')}. Add a price row or update it after importing.</li> : null}
                  {missingCurrencies.length ? (
                    <li>
                      No exchange rate into {c} for {missingCurrencies.join(', ')}.
                    </li>
                  ) : null}
                  {!missingPrices.length && !missingCurrencies.length ? <li>Some holdings can't be valued yet.</li> : null}
                </ul>
                <p className="mt-1">Affected holdings are left out of the total rather than counted as zero. The import itself can still go ahead.</p>
              </Notice>
            ) : null}

            {negative.length ? (
              <Notice tone="negative" title={`${negative.length} ${negative.length === 1 ? 'event takes' : 'events take'} a holding below zero`}>
                Positions are long-only. Add the missing earlier opening position or buy, or correct the quantity or date, then preview again.
              </Notice>
            ) : null}
          </CardBody>

          {instrumentChanges.length ? (
            <section aria-labelledby="inv-instruments">
              <SectionTitle id="inv-instruments" title="Instruments" description="Matched by external ID. New instruments are created; existing ones keep their identity." />
              <ResponsiveTable
                caption="Instrument changes"
                rows={instrumentChanges}
                rowKey={(r) => r.instrumentId}
                columns={[
                  {
                    header: 'Instrument',
                    cell: (r) => (
                      <>
                        <span className="block font-medium text-ink">{r.name}</span>
                        <span className="num text-xs text-muted">{r.symbol ?? r.externalId}</span>
                      </>
                    ),
                  },
                  { header: 'Match', cell: (r) => <Badge tone={r.resolution === 'new' ? 'accent' : 'neutral'}>{r.resolution === 'new' ? 'New' : 'Existing'}</Badge> },
                  { header: 'Now', align: 'right', cell: (r) => <Quantity value={r.currentQuantity} /> },
                  { header: 'After', align: 'right', cell: (r) => <Quantity value={r.projectedQuantity} className="font-medium" /> },
                  { header: 'Change', align: 'right', cell: (r) => <span className="num text-muted">{signedQty(r.quantityChange)}</span> },
                ]}
                mobile={(r) => (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{r.name}</p>
                      <p className="text-xs text-muted">
                        {r.resolution === 'new' ? 'New' : 'Existing'} · <Quantity value={r.currentQuantity} /> → <Quantity value={r.projectedQuantity} />
                      </p>
                    </div>
                    <span className="num shrink-0 text-sm text-muted">{signedQty(r.quantityChange)}</span>
                  </div>
                )}
              />
            </section>
          ) : null}

          {eventChanges.length ? (
            <section aria-labelledby="inv-events">
              <SectionTitle id="inv-events" title="Trades and quantity changes" description="Placed by date and same-day order. Quantities before and after each event." />
              <ResponsiveTable
                caption="Position events and quantities before and after"
                rows={eventChanges}
                rowKey={(r, i) => `${r.externalId}:${i}`}
                rowClassName={(r) => (r.afterQuantity.startsWith('-') ? 'bg-negative-soft/40' : undefined)}
                columns={[
                  { header: 'Date', cell: (r) => <DateText value={r.tradeDate} /> },
                  { header: 'Event', cell: (r) => activityLabel(r.type) },
                  { header: 'Instrument', cell: (r) => instrumentName(r.instrumentId) },
                  { header: 'Before', align: 'right', cell: (r) => <Quantity value={r.beforeQuantity} /> },
                  {
                    header: 'After',
                    align: 'right',
                    cell: (r) =>
                      r.afterQuantity.startsWith('-') ? (
                        <span className="inline-flex items-center gap-2">
                          <Badge tone="negative">Below zero</Badge>
                          <Quantity value={r.afterQuantity} className="font-medium text-negative" />
                        </span>
                      ) : (
                        <Quantity value={r.afterQuantity} className="font-medium" />
                      ),
                  },
                ]}
                mobile={(r) => (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">
                        {activityLabel(r.type)} · {instrumentName(r.instrumentId)}
                      </p>
                      <p className="text-xs text-muted">
                        <DateText value={r.tradeDate} />
                      </p>
                    </div>
                    <span className={cn('shrink-0 text-right text-sm', r.afterQuantity.startsWith('-') && 'text-negative')}>
                      <Quantity value={r.beforeQuantity} /> → <Quantity value={r.afterQuantity} className="font-medium" />
                    </span>
                  </div>
                )}
              />
            </section>
          ) : null}

          {priceChanges.length ? (
            <section aria-labelledby="inv-prices">
              <SectionTitle id="inv-prices" title="Prices" description="Each price values the holding from its date until a newer one." />
              <ResponsiveTable
                caption="Prices added by this file"
                rows={priceChanges}
                rowKey={(r, i) => `${r.externalId}:${i}`}
                columns={[
                  { header: 'Instrument', cell: (r) => instrumentName(r.instrumentId) },
                  { header: 'Price', align: 'right', cell: (r) => <UnitPrice value={r.price} currency={r.currency} /> },
                  { header: 'Source', cell: (r) => <span className="text-muted">{r.source}</span> },
                  { header: 'Affects from', cell: (r) => <DateText value={r.affectedFrom} /> },
                ]}
                mobile={(r) => (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{instrumentName(r.instrumentId)}</p>
                      <p className="text-xs text-muted">
                        From <DateText value={r.affectedFrom} /> · {r.source}
                      </p>
                    </div>
                    <UnitPrice value={r.price} currency={r.currency} className="shrink-0 text-sm" />
                  </div>
                )}
              />
            </section>
          ) : null}

          <section aria-labelledby="inv-rows">
            <SectionTitle id="inv-rows" title="Every record" description="What will happen to each record in the file." />
            <div className="px-4 pb-3 md:px-6">
              <Segmented<Outcome>
                label="Show records"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: `All ${rows.length}` },
                  { value: 'ready', label: `Ready ${counts.ready}` },
                  { value: 'duplicate', label: `Duplicates ${counts.duplicate}` },
                  { value: 'problem', label: `Problems ${counts.problem}` },
                ]}
              />
            </div>
            {shown.length ? (
              <ResponsiveTable
                caption={`Records in ${file.name} and their outcome`}
                rows={shown}
                rowKey={(r, i) => `${r.collection}:${r.row}:${i}`}
                rowClassName={(r) => (outcomeOf(r) === 'problem' ? 'bg-negative-soft/40' : undefined)}
                columns={[
                  {
                    header: 'Record',
                    cell: (r) => (
                      <span className="whitespace-nowrap">
                        {COLLECTION_LABEL[r.collection] ?? activityLabel(r.collection)}
                        {r.row ? <span className="num text-subtle"> · row {r.row}</span> : null}
                      </span>
                    ),
                  },
                  { header: 'External ID', className: 'max-w-[220px]', cell: (r) => <span className="num block truncate text-muted">{r.externalId ?? '—'}</span> },
                  { header: 'Outcome', cell: (r) => <OutcomeBadge row={r} /> },
                  { header: 'Detail', cell: (r) => <span className="text-muted">{outcomeOf(r) === 'ready' ? '' : r.message}</span> },
                ]}
                mobile={(r) => (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 truncate text-sm font-medium text-ink">
                        {COLLECTION_LABEL[r.collection] ?? activityLabel(r.collection)}
                        {r.externalId ? <span className="num font-normal text-muted"> · {r.externalId}</span> : null}
                      </p>
                      <OutcomeBadge row={r} />
                    </div>
                    {outcomeOf(r) !== 'ready' ? <p className="mt-1 text-xs text-muted">{r.message}</p> : null}
                  </>
                )}
              />
            ) : (
              <p className="border-t border-line px-6 py-6 text-center text-sm text-muted">No records with this outcome.</p>
            )}
          </section>

          <div className="space-y-3 border-t border-line px-4 py-4 md:px-6">
            {commitProblem ? (
              <Notice
                tone="negative"
                role="alert"
                title={ApiProblem.is(commitProblem) ? commitProblem.title : 'Import failed'}
                action={
                  mismatch ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        commit.reset()
                        preview.mutate(file)
                      }}
                    >
                      Preview again
                    </Button>
                  ) : undefined
                }
              >
                {mismatch ? 'The file or the account changed after this preview, so nothing was imported. Preview it again before importing.' : problemMessage(commitProblem)}
              </Notice>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 flex-1 basis-64 text-sm text-muted">
                {!p.canCommit || counts.problem > 0
                  ? 'Nothing can be imported until every problem is fixed. Investment imports are all or nothing, because one failed trade changes every later quantity.'
                  : counts.ready === 0
                    ? 'Nothing new to import. Every record is already in this account.'
                    : `${counts.ready} new ${counts.ready === 1 ? 'record' : 'records'} will be added in one step. Duplicates are skipped.`}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button icon={<Download size={16} aria-hidden />} onClick={() => downloadText(`${account.name} investment import report.json`, JSON.stringify(p, null, 2) + '\n', 'application/json')}>
                  Report
                </Button>
                <Button
                  variant="primary"
                  icon={<Upload size={16} aria-hidden />}
                  disabled={!canCommit || !online}
                  title={!online ? OFFLINE_REASON : undefined}
                  loading={commit.isPending}
                  onClick={() => p.hash && commit.mutate({ f: file, hash: p.hash })}
                >
                  Import {counts.ready} {counts.ready === 1 ? 'record' : 'records'}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </>
    )
  }

  // ---- choose ----
  const problem = localError ?? (preview.isError ? problemMessage(preview.error) : null)
  const problemTitle = localError ? 'That file can’t be used' : ApiProblem.is(preview.error) ? preview.error.title : 'The file could not be previewed'
  return (
    <>
      <Steps current={0} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <label
            htmlFor={inputId}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              'flex min-h-[260px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors duration-[var(--dur-2)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)]',
              dragging ? 'border-accent bg-accent-soft/60' : 'border-line-strong/50 bg-surface hover:border-accent/60 hover:bg-sunken/40',
              preview.isPending && 'pointer-events-none opacity-70',
            )}
          >
            <input
              id={inputId}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="sr-only"
              disabled={preview.isPending}
              aria-describedby={`${inputId}-hint`}
              onChange={(e) => {
                void accept(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
              <FileUp size={22} aria-hidden />
            </span>
            <span className="mt-4 text-md font-semibold text-ink">
              {preview.isPending ? `Checking ${file?.name ?? 'file'}…` : dragging ? 'Drop to preview' : 'Drop an investment history file here'}
            </span>
            <span id={`${inputId}-hint`} className="mt-1 max-w-[46ch] text-sm text-muted">
              JSON envelope or one CSV template. Nothing is saved yet: you'll see every holding, trade, and price change first.
            </span>
            <span className={buttonClass({ variant: 'secondary', className: 'mt-5 pointer-events-none' })} aria-hidden>
              Choose file
            </span>
          </label>
          {problem ? (
            <Notice tone="negative" role="alert" title={problemTitle}>
              {problem}
            </Notice>
          ) : null}
          <ManualPrompt currency={account.currency} trackingMode="positions" />
        </div>

        <Card aria-labelledby="investment-format-heading" as="aside">
          <CardHeader id="investment-format-heading" title="Investment History v1" description={`Instruments, trades, cash, and prices for ${account.name}. Amounts in ${c}.`} />
          <CardBody className="space-y-4 pt-2">
            <div className="rounded-md bg-sunken px-3 py-2.5 text-sm">
              <p className="font-medium text-ink">JSON envelope</p>
              <p className="mt-0.5 text-xs text-muted">
                <code className="font-mono">format</code> <code className="font-mono">wealthboard-investment-history</code>, <code className="font-mono">version</code> 1, with{' '}
                <code className="font-mono">instruments</code>, <code className="font-mono">position_events</code>, <code className="font-mono">cash_transactions</code>, and{' '}
                <code className="font-mono">prices</code>. The only format that can group a dividend reinvestment.
              </p>
              <Button
                size="sm"
                variant="subtle"
                className="mt-2.5"
                icon={<FileJson size={15} aria-hidden />}
                onClick={() => downloadText(`${account.name} investment history sample.json`, sampleInvestmentJson(account, today), 'application/json')}
              >
                Sample JSON
              </Button>
            </div>
            <div>
              <p className="text-sm font-medium text-ink">CSV templates</p>
              <p className="mt-0.5 text-xs text-muted">One record type per file, with these exact headers in any order.</p>
              <ul className="mt-2 divide-y divide-line">
                {TEMPLATES.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-ink">{t.label}</p>
                      <p className="text-xs text-muted">{t.description}</p>
                      <code className="scroll-x mt-1 block whitespace-nowrap font-mono text-[11px] text-subtle">{INVESTMENT_CSV_HEADERS[t.id]}</code>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0"
                      icon={<FileSpreadsheet size={15} aria-hidden />}
                      aria-label={`Download ${t.label.toLowerCase()} CSV sample`}
                      onClick={() => downloadText(`${account.name} ${t.id} sample.csv`, sampleInvestmentCsv(t.id, account, today), 'text/csv')}
                    >
                      CSV
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
            <ul className="space-y-1.5 border-t border-line pt-3 text-xs text-muted">
              <li>Every instrument, trade, and price needs a stable external ID. Cash rows without one get an ID built from the date, type, and amount. Matching IDs already imported are skipped.</li>
              <li>Quantities, prices, and amounts are text such as "12.50", never JSON numbers. Dates are YYYY-MM-DD and not in the future.</li>
              <li>A cross-currency buy or sell needs the cash effect in {c} or the applied rate.</li>
              <li>Up to 5 MB and 10,000 records per file.</li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  )
}
