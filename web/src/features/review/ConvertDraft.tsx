import { AlertTriangle, ArrowRight, Check, ChevronDown, Copy, Download, Trash2 } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import type { Account, AIConversionDraft } from '@/api/types'
import { DateText, Money } from '@/components/format'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Notice } from '@/components/ui/Notice'
import { cn } from '@/lib/cn'
import { decimalToMinor } from '@/lib/money'
import { collectionLabel, downloadText, draftFile, parseDraft, type DraftRecord } from './draft'

const humanize = (v: string | null | undefined) => (v ? (v[0]?.toUpperCase() ?? '') + v.slice(1).replace(/_/g, ' ') : '—')

function toMinor(value: string, currency: string): string | null {
  try {
    return decimalToMinor(value, currency)
  } catch {
    return null
  }
}

function DraftAmount({ value, currency }: { value: string | null | undefined; currency: string }) {
  if (!value) return <span className="text-subtle">—</span>
  const minor = toMinor(value, currency)
  if (minor !== null) return <Money minor={minor} currency={currency} />
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs text-warning" title="Not a valid amount for this currency">
      <AlertTriangle size={13} aria-hidden />
      {value}
    </span>
  )
}

function DraftDate({ value }: { value: string | null | undefined }) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? <DateText value={value} /> : <span className="font-mono text-xs text-warning">{value ?? '—'}</span>
}

function TransactionsPreview({ records, sources, currency }: { records: DraftRecord[]; sources: Map<number, string[]>; currency: string }) {
  return (
    <>
      <div className="scroll-x hidden max-h-[420px] overflow-y-auto rounded-md border border-line md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Draft transactions</caption>
          <thead className="sticky top-0 bg-surface text-xs text-muted">
            <tr className="border-b border-line">
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Row
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Date
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Type
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Amount
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Description
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                From
              </th>
            </tr>
          </thead>
          <tbody>
            {records.map((r, i) => (
              <tr key={i} className="border-t border-line align-top first:border-t-0">
                <td className="num px-3 py-2 text-right text-subtle">{i + 1}</td>
                <td className="px-3 py-2">
                  <DraftDate value={r.date} />
                </td>
                <td className="px-3 py-2 text-ink">{humanize(r.type)}</td>
                <td className="px-3 py-2 text-right">
                  <DraftAmount value={r.amount} currency={currency} />
                </td>
                <td className="max-w-64 px-3 py-2 text-muted">
                  <span className="line-clamp-2">{r.description ?? '—'}</span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-subtle">{(sources.get(i + 1) ?? []).join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ol className="divide-y divide-line rounded-md border border-line md:hidden" aria-label="Draft transactions">
        {records.map((r, i) => (
          <li key={i} className="flex items-start justify-between gap-3 px-3 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{humanize(r.type)}</p>
              <p className="mt-0.5 text-xs text-muted">
                <DraftDate value={r.date} />
                {r.description ? <> · {r.description}</> : null}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-subtle">{(sources.get(i + 1) ?? []).join(', ')}</p>
            </div>
            <DraftAmount value={r.amount} currency={currency} />
          </li>
        ))}
      </ol>
    </>
  )
}

export function ConvertDraft({
  draft,
  account,
  sentUnits,
  onEdit,
  onDiscard,
  onOpenDirectImport,
}: {
  draft: AIConversionDraft
  account: Account
  sentUnits: number
  onEdit(content: string): void
  onDiscard(): void
  onOpenDirectImport?: () => void
}) {
  const [acknowledged, setAcknowledged] = useState(false)
  const [editing, setEditing] = useState(false)
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const editorId = useId()
  const ackId = useId()
  const parsed = useMemo(() => parseDraft(draft.content), [draft.content])
  const references = useMemo(() => {
    const byCollection = new Map<string, Map<number, string[]>>()
    for (const ref of draft.references) {
      const m = byCollection.get(ref.collection) ?? new Map<number, string[]>()
      m.set(ref.row, ref.sourceIds)
      byCollection.set(ref.collection, m)
    }
    return byCollection
  }, [draft.references])
  const covered = new Set([...draft.references.flatMap((r) => r.sourceIds), ...draft.exclusions.map((e) => e.sourceId)]).size
  const rows = parsed?.collections.reduce((n, c) => n + c.records.length, 0) ?? 0
  const transactions = parsed?.collections.find((c) => c.name === 'transactions')
  const others = parsed?.collections.filter((c) => c.name !== 'transactions') ?? []
  const file = draftFile(draft.content, account.name)
  const ready = acknowledged && !!parsed

  const edit = (content: string) => {
    onEdit(content)
    setAcknowledged(false)
    setCopy('idle')
  }
  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(draft.content)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={rows ? 'accent' : 'neutral'}>{rows === 1 ? '1 draft row' : `${rows} draft rows`}</Badge>
        <Badge tone={covered >= sentUnits ? 'positive' : 'warning'} icon={covered >= sentUnits ? <Check size={12} aria-hidden /> : <AlertTriangle size={12} aria-hidden />}>
          {covered} of {sentUnits} sections accounted for
        </Badge>
        {draft.exclusions.length ? <Badge tone="neutral">{draft.exclusions.length} excluded</Badge> : null}
      </div>

      {draft.issues.length ? (
        <Notice tone="warning" title="Resolve these before importing">
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {draft.issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {!parsed ? (
        <Notice tone="negative" role="alert" title="The draft isn’t valid JSON">
          Fix the edit below, or discard the draft and convert again.
        </Notice>
      ) : transactions ? (
        transactions.records.length ? (
          <TransactionsPreview records={transactions.records} sources={references.get('transactions') ?? new Map()} currency={account.currency} />
        ) : (
          <p className="rounded-md border border-dashed border-line-strong/60 px-4 py-6 text-center text-sm text-muted">The draft has no transactions.</p>
        )
      ) : null}
      {parsed && others.length ? (
        <dl className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2">
          {others.map((c) => (
            <div key={c.name} className="flex items-baseline justify-between gap-3 bg-surface px-3 py-2.5">
              <dt className="text-sm text-muted">{collectionLabel(c.name)}</dt>
              <dd className="num text-sm font-medium text-ink">{c.records.length}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {draft.exclusions.length ? (
        <div>
          <h4 className="text-sm font-medium text-ink">Excluded sections</h4>
          <ul className="mt-2 space-y-1.5 text-sm">
            {draft.exclusions.map((e, i) => (
              <li key={`${e.sourceId}-${i}`} className="flex gap-2 text-muted">
                <span className="shrink-0 font-mono text-xs leading-5 text-subtle">{e.sourceId}</span>
                <span className="min-w-0">{e.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-lg border border-line">
        <button
          type="button"
          aria-expanded={editing}
          aria-controls={editorId}
          onClick={() => setEditing((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-left text-sm font-medium text-ink hover:bg-sunken/60"
        >
          Edit the draft {parsed ? 'JSON' : ''}
          <ChevronDown size={18} aria-hidden className={cn('shrink-0 text-muted transition-transform duration-[var(--dur-2)]', editing && 'rotate-180')} />
        </button>
        <div id={editorId} hidden={!editing} className="border-t border-line p-3">
          {editing ? (
            <>
              <label htmlFor={`${editorId}-text`} className="sr-only">
                Draft content
              </label>
              <textarea
                id={`${editorId}-text`}
                value={draft.content}
                onChange={(e) => edit(e.target.value)}
                spellCheck={false}
                rows={14}
                className="block w-full rounded-md border border-line-strong/80 bg-sunken/40 p-3 font-mono text-xs leading-5 text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
              />
              <p className="mt-2 text-xs text-muted">Edits change only this draft. They clear your confirmation below.</p>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-line bg-sunken/40 p-4">
        <input id={ackId} type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]" />
        <label htmlFor={ackId} className="text-sm text-ink">
          I’ve checked this draft against my statement, resolved the issues above, and accept that excluded sections won’t be imported.
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={<Download size={16} aria-hidden />} disabled={!ready} onClick={() => downloadText(file.name, draft.content, file.type)}>
          Download draft
        </Button>
        <Button icon={copy === 'copied' ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />} disabled={!ready} onClick={() => void copyDraft()}>
          {copy === 'copied' ? 'Copied' : 'Copy to clipboard'}
        </Button>
        <Button variant="ghost" icon={<Trash2 size={16} aria-hidden />} onClick={onDiscard} className="sm:ml-auto">
          Discard draft
        </Button>
      </div>
      {copy === 'failed' ? (
        <p role="alert" className="text-xs text-warning">
          The browser couldn’t copy the draft. Open “Edit the draft”, select the text, and copy it manually.
        </p>
      ) : copy === 'copied' ? (
        <p role="status" className="text-xs text-positive">
          Draft copied. Save it as a .json file to preview it.
        </p>
      ) : null}

      <div className="rounded-lg bg-accent-soft/50 px-4 py-3.5 text-sm">
        <p className="font-medium text-ink">Next: preview it before anything is imported</p>
        <p className="mt-1 text-muted">
          Download the draft, open Direct import, and choose the file. You’ll see every row, duplicates, and problems, and nothing is saved to {account.name} until you confirm there.
        </p>
        {onOpenDirectImport ? (
          <Button
            size="sm"
            variant="subtle"
            className="mt-3"
            disabled={!ready}
            title={!ready ? 'Confirm you’ve checked the draft first' : undefined}
            onClick={() => {
              downloadText(file.name, draft.content, file.type)
              onOpenDirectImport()
            }}
          >
            Download and open Direct import
            <ArrowRight size={15} aria-hidden />
          </Button>
        ) : null}
      </div>
    </div>
  )
}
