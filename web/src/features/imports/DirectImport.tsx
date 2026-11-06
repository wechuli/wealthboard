import { useMutation } from '@tanstack/react-query'
import { ArrowRight, CheckCircle2, FileJson, FileSpreadsheet, FileUp, RotateCcw, Upload } from 'lucide-react'
import { useId, useState, type DragEvent } from 'react'
import { Link } from 'react-router'
import { api } from '@/api'
import type { ImportFile } from '@/api/datasource'
import { ApiProblem, problemMessage } from '@/api/problem'
import type { Account, AccountHistoryImportResult, AccountHistoryImportRow } from '@/api/types'
import { DateText, Delta, Money } from '@/components/format'
import { Badge } from '@/components/ui/Badge'
import { Button, buttonClass } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Notice } from '@/components/ui/Notice'
import { Segmented } from '@/components/ui/Segmented'
import { activityLabel } from '@/features/accounts/model'
import { ManualPrompt } from './ManualPrompt'
import { cn } from '@/lib/cn'
import { decimalToMinor } from '@/lib/money'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { usePrefs } from '@/lib/prefs'
import { useApiMutation } from '@/lib/queries'
import { CSV_HEADER, downloadText, IMPORT_TYPES, sampleCsv, sampleJson } from './sample'

const MAX_BYTES = 5 * 1024 * 1024
type Outcome = 'all' | 'ready' | 'duplicate' | 'error'

export function Steps({ current }: { current: 0 | 1 | 2 }) {
  const steps = ['Choose a file', 'Review rows', 'Import']
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm" aria-label="Import steps">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2" aria-current={i === current ? 'step' : undefined}>
          <span
            className={cn(
              'num grid size-6 place-items-center rounded-full text-xs font-semibold',
              i < current ? 'bg-accent text-on-accent' : i === current ? 'bg-accent-soft text-accent ring-1 ring-accent' : 'bg-sunken text-subtle',
            )}
          >
            {i < current ? <CheckCircle2 size={14} aria-hidden /> : i + 1}
            {i < current ? <span className="sr-only">Done:</span> : null}
          </span>
          <span className={cn(i === current ? 'font-medium text-ink' : 'text-muted')}>{s}</span>
          {i < steps.length - 1 ? <ArrowRight size={14} aria-hidden className="mx-1 text-subtle" /> : null}
        </li>
      ))}
    </ol>
  )
}

function rowMinor(row: AccountHistoryImportRow, currency: string): string | null {
  if (!row.amount) return null
  try {
    return decimalToMinor(row.amount, currency)
  } catch {
    return null
  }
}

function OutcomeBadge({ row }: { row: AccountHistoryImportRow }) {
  if (row.status === 'ready' || row.status === 'imported') return <Badge tone="positive">{row.status === 'imported' ? 'Imported' : 'New'}</Badge>
  if (row.status === 'duplicate') return <Badge tone="neutral">Duplicate</Badge>
  return <Badge tone="negative">Error</Badge>
}

function outcomeOf(row: AccountHistoryImportRow): Exclude<Outcome, 'all'> {
  if (row.status === 'duplicate') return 'duplicate'
  if (row.status === 'error') return 'error'
  return 'ready'
}

export function DirectImport({ account }: { account: Account }) {
  const online = useOnline()
  const { today } = usePrefs()
  const inputId = useId()
  const [file, setFile] = useState<ImportFile | null>(null)
  const [fileSize, setFileSize] = useState(0)
  const [localError, setLocalError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [filter, setFilter] = useState<Outcome>('all')

  const preview = useMutation<AccountHistoryImportResult, Error, ImportFile>({
    mutationFn: (f) => {
      if (!navigator.onLine) throw new ApiProblem({ type: 'about:blank', title: 'Offline', status: 0, detail: OFFLINE_REASON })
      return api.imports.previewAccountHistory(account.id, f)
    },
  })
  const commit = useApiMutation({
    mutationFn: ({ f, hash }: { f: ImportFile; hash: string }) => api.imports.commitAccountHistory(account.id, f, hash),
    success: (r) => {
      const n = r.summary.imported ?? 0
      return `Imported ${n} ${n === 1 ? 'transaction' : 'transactions'} into ${account.name}`
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
      setLocalError(`“${picked.name}” isn't a CSV or JSON file. Choose a file ending in .csv or .json.`)
      return
    }
    if (picked.size > MAX_BYTES) {
      setLocalError('That file is larger than 5 MB. Split it into smaller files and import them one at a time.')
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
        <Card className="overflow-hidden" aria-labelledby="import-done">
          <div className="flex flex-col items-start gap-4 p-6 md:flex-row md:p-8">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-positive-soft text-positive">
              <CheckCircle2 size={24} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="import-done" className="display text-2xl text-ink">
                {n} {n === 1 ? 'transaction' : 'transactions'} imported
              </h2>
              <p className="mt-1.5 text-base text-muted">
                {account.name} now includes the history from {file?.name}. Totals, charts, and goals have been recalculated.
              </p>
              <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted">Balance now</dt>
                  <dd className="mt-0.5 text-md font-semibold text-ink">
                    {r.finalBalanceMinor !== undefined ? <Money minor={String(r.finalBalanceMinor)} currency={account.currency} /> : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Skipped as duplicates</dt>
                  <dd className="num mt-0.5 text-md font-semibold text-ink">{r.summary.skippedDuplicates}</dd>
                </div>
                <div>
                  <dt className="text-muted">Rows with errors</dt>
                  <dd className="num mt-0.5 text-md font-semibold text-ink">{r.summary.failed}</dd>
                </div>
              </dl>
              <div className="mt-6 flex flex-wrap gap-2">
                <Link to={`/accounts/${account.id}?tab=activity`} className={buttonClass({ variant: 'primary' })}>
                  View account activity
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
    const counts = { ready: p.summary.ready ?? 0, duplicate: p.summary.skippedDuplicates, error: p.summary.failed }
    const shown = p.rows.filter((r) => filter === 'all' || outcomeOf(r) === filter)
    const commitProblem = commit.error
    const mismatch = ApiProblem.is(commitProblem) && commitProblem.status === 409
    return (
      <>
        <Steps current={1} />
        <div className="space-y-5">
          <Card aria-labelledby="preview-heading">
            <div className="flex flex-wrap items-start justify-between gap-4 px-4 pt-5 md:px-6">
              <div className="min-w-0">
                <h2 id="preview-heading" className="text-md font-semibold text-ink">
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
            <dl className="mt-5 grid gap-px overflow-hidden border-y border-line bg-line sm:grid-cols-3">
              <div className="bg-surface px-4 py-3.5 md:px-6">
                <dt className="text-xs text-muted">Dates covered</dt>
                <dd className="mt-1 text-sm font-medium text-ink">
                  {p.dateRange ? (
                    <>
                      <DateText value={p.dateRange.from} /> – <DateText value={p.dateRange.to} />
                    </>
                  ) : (
                    'No importable rows'
                  )}
                </dd>
              </div>
              <div className="bg-surface px-4 py-3.5 md:px-6">
                <dt className="text-xs text-muted">Balance today</dt>
                <dd className="mt-1 text-sm font-medium text-ink">{p.currentBalanceMinor !== undefined ? <Money minor={String(p.currentBalanceMinor)} currency={account.currency} /> : '—'}</dd>
              </div>
              <div className="bg-surface px-4 py-3.5 md:px-6">
                <dt className="text-xs text-muted">After import</dt>
                <dd className="mt-1 text-sm font-semibold text-ink">
                  {p.projectedBalanceMinor !== undefined ? <Money minor={String(p.projectedBalanceMinor)} currency={account.currency} /> : '—'}
                  {p.netChangeMinor !== undefined ? (
                    <span className="mt-0.5 block text-xs font-normal">
                      <Delta minor={String(p.netChangeMinor)} currency={account.currency} invert={account.isLiability} showIcon={false} />
                    </span>
                  ) : null}
                </dd>
              </div>
            </dl>
            <CardBody className="pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Segmented<Outcome>
                  label="Show rows"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: 'all', label: `All ${p.rows.length}` },
                    { value: 'ready', label: `New ${counts.ready}` },
                    { value: 'duplicate', label: `Duplicates ${counts.duplicate}` },
                    { value: 'error', label: `Errors ${counts.error}` },
                  ]}
                />
              </div>
              {counts.error > 0 ? (
                <Notice tone="warning" className="mt-4" title={`${counts.error} ${counts.error === 1 ? 'row has' : 'rows have'} errors and won't be imported`}>
                  Fix them in the file and preview it again, or import only the new rows now.
                </Notice>
              ) : null}
              {commitProblem ? (
                <Notice
                  tone="negative"
                  role="alert"
                  className="mt-4"
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
                  {problemMessage(commitProblem)}
                </Notice>
              ) : null}
            </CardBody>

            <div className="scroll-x hidden max-h-[520px] overflow-y-auto border-t border-line md:block">
              <table className="w-full text-sm">
                <caption className="sr-only">Rows in {file.name} and what will happen to each</caption>
                <thead className="sticky top-0 bg-sunken text-left text-xs text-muted">
                  <tr>
                    <th scope="col" className="py-2 pl-6 pr-3 text-right font-medium">
                      Row
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Date
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Type
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Amount
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      External ID
                    </th>
                    <th scope="col" className="py-2 pl-3 pr-6 font-medium">
                      Outcome
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const minor = rowMinor(r, account.currency)
                    return (
                      <tr key={r.row} className={cn('border-t border-line', r.status === 'error' && 'bg-negative-soft/40')}>
                        <td className="num py-2 pl-6 pr-3 text-right text-subtle">{r.row}</td>
                        <td className="px-3 py-2">{r.date ? <DateText value={r.date} /> : <span className="text-subtle">—</span>}</td>
                        <td className="px-3 py-2">{r.type ? activityLabel(r.type) : <span className="text-subtle">—</span>}</td>
                        <td className="px-3 py-2 text-right">{minor !== null ? <Money minor={minor} currency={account.currency} /> : <span className="text-subtle">—</span>}</td>
                        <td className="num max-w-[160px] truncate px-3 py-2 text-muted">{r.externalId ?? '—'}</td>
                        <td className="py-2 pl-3 pr-6">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <OutcomeBadge row={r} />
                            {r.status !== 'ready' ? <span className="text-xs text-muted">{r.message}</span> : null}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {shown.length === 0 ? <p className="px-6 py-6 text-center text-sm text-muted">No rows with this outcome.</p> : null}
            </div>
            <ul className="divide-y divide-line border-t border-line md:hidden">
              {shown.map((r) => {
                const minor = rowMinor(r, account.currency)
                return (
                  <li key={r.row} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">{r.type ? activityLabel(r.type) : 'Unknown type'}</p>
                        <p className="text-xs text-muted">
                          Row {r.row} · {r.date ? <DateText value={r.date} /> : 'no date'}
                          {r.externalId ? ` · ${r.externalId}` : ''}
                        </p>
                      </div>
                      <div className="shrink-0 text-right text-sm">{minor !== null ? <Money minor={minor} currency={account.currency} /> : null}</div>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <OutcomeBadge row={r} />
                      {r.status !== 'ready' ? <span className="text-xs text-muted">{r.message}</span> : null}
                    </div>
                  </li>
                )
              })}
              {shown.length === 0 ? <li className="px-4 py-6 text-center text-sm text-muted">No rows with this outcome.</li> : null}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-4 md:px-6">
              <p className="text-sm text-muted">
                {counts.ready === 0
                  ? 'Nothing new to import. Every row is a duplicate or has an error.'
                  : `${counts.ready} new ${counts.ready === 1 ? 'transaction' : 'transactions'} will be added. Duplicates and errors are skipped.`}
              </p>
              <Button
                variant="primary"
                icon={<Upload size={16} aria-hidden />}
                disabled={counts.ready === 0 || !online || !p.hash}
                title={!online ? OFFLINE_REASON : undefined}
                loading={commit.isPending}
                onClick={() => p.hash && commit.mutate({ f: file, hash: p.hash })}
              >
                Import {counts.ready} {counts.ready === 1 ? 'transaction' : 'transactions'}
              </Button>
            </div>
          </Card>
        </div>
      </>
    )
  }

  // ---- choose ----
  const problem = localError ?? (preview.isError ? problemMessage(preview.error) : null)
  const problemTitle = localError ? 'That file can’t be used' : ApiProblem.is(preview.error) ? preview.error.title : 'The file could not be previewed'
  return (
    <>
      <Steps current={0} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
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
            <span className="mt-4 text-md font-semibold text-ink">{preview.isPending ? `Reading ${file?.name ?? 'file'}…` : dragging ? 'Drop to preview' : 'Drop a CSV or JSON file here'}</span>
            <span id={`${inputId}-hint`} className="mt-1 max-w-[44ch] text-sm text-muted">
              Nothing is saved yet. You'll see every row and its outcome first.
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
          <ManualPrompt currency={account.currency} trackingMode="balance" />
        </div>

        <Card aria-labelledby="format-heading" as="aside">
          <CardHeader id="format-heading" title="File format" description={`One row per transaction, amounts in ${account.currency}.`} />
          <CardBody className="space-y-4 pt-2">
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">CSV header row</p>
              <code className="scroll-x block whitespace-nowrap rounded-md bg-sunken px-3 py-2 font-mono text-xs text-ink">{CSV_HEADER}</code>
            </div>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="font-medium text-ink">type</dt>
                <dd className="text-muted">
                  {IMPORT_TYPES.filter((t) => !!t.liability === account.isLiability)
                    .map((t) => t.type)
                    .join(', ')}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-ink">amount</dt>
                <dd className="text-muted">A positive number such as 1500.00. The type sets the direction.</dd>
              </div>
              <div>
                <dt className="font-medium text-ink">date</dt>
                <dd className="text-muted">YYYY-MM-DD, not in the future.</dd>
              </div>
              <div>
                <dt className="font-medium text-ink">description</dt>
                <dd className="text-muted">Optional.</dd>
              </div>
              <div>
                <dt className="font-medium text-ink">external_id</dt>
                <dd className="text-muted">Optional. Use the bank’s transaction ID when there is one. Otherwise leave it blank and Wealthboard builds one from the date, type, and amount, numbering same-day repeats in file order. Re-importing a file skips rows already imported.</dd>
              </div>
            </dl>
            <p className="text-xs text-muted">
              JSON files use the same fields inside a <code className="font-mono">transactions</code> array.
            </p>
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              <Button size="sm" icon={<FileSpreadsheet size={15} aria-hidden />} onClick={() => downloadText(`${account.name} sample.csv`, sampleCsv(account, today), 'text/csv')}>
                Sample CSV
              </Button>
              <Button size="sm" variant="ghost" icon={<FileJson size={15} aria-hidden />} onClick={() => downloadText(`${account.name} sample.json`, sampleJson(account, today), 'application/json')}>
                Sample JSON
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  )
}
