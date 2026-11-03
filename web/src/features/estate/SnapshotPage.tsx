import { ArrowLeft, Download, EyeOff, Printer } from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { ApiProblem } from '@/api/problem'
import type { EstateSnapshot } from '@/api/types'
import { Bps, DateText, Money, Unavailable } from '@/components/format'
import { Button, buttonClass } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { Notice } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { usePrivacy } from '@/lib/privacy'
import { useEstateSnapshot } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { downloadSnapshotJson } from './download'
import { CheckboxRow } from './kit'
import { BENEFICIARY_KINDS, calendarDate, DISTRIBUTION_METHODS, FULL_BPS, labelOf, TRANSFER_CONTEXTS } from './model'
import { normalizeSnapshot, type SnapshotAllocation, type SnapshotDocument } from './snapshot'

/**
 * The app shell's sidebar is hidden in print but its wrapper keeps the sidebar's left padding.
 * This page-scoped rule lets the printed document use the full sheet width.
 */
const PRINT_CSS = `@media print {
  div:has(> main#main) { padding-left: 0 !important; }
  .estate-print .page { padding: 0 !important; max-width: none !important; }
  .estate-document { border: 0 !important; box-shadow: none !important; padding: 0 !important; max-width: none !important; break-inside: auto !important; }
}`

export interface PrintOptions {
  values: boolean
  contacts: boolean
  references: boolean
  notes: boolean
}

export const DEFAULT_PRINT_OPTIONS: PrintOptions = { values: false, contacts: false, references: false, notes: false }

export default function SnapshotPage() {
  const { snapshotId } = useParams()
  const query = useEstateSnapshot(snapshotId)
  usePageTitle(query.data ? `${query.data.title} · Estate summary` : 'Estate summary')

  return (
    <div className="estate-print">
      <style>{PRINT_CSS}</style>
      <div className="page">
        <div className="mb-4" data-no-print>
          <Link to="/estate/summary" className={buttonClass({ variant: 'ghost', className: '-ml-3 gap-1.5' })}>
            <ArrowLeft size={16} aria-hidden />
            Estate summaries
          </Link>
        </div>
        {query.error ? (
          <Card>
            <ErrorState
              error={query.error}
              onRetry={ApiProblem.is(query.error) && query.error.status === 404 ? undefined : () => void query.refetch()}
              title={ApiProblem.is(query.error) && query.error.status === 404 ? 'This summary no longer exists' : "This summary couldn't be loaded"}
            />
          </Card>
        ) : query.data ? (
          <SnapshotView snapshot={query.data} />
        ) : (
          <SnapshotSkeleton />
        )}
      </div>
    </div>
  )
}

function SnapshotSkeleton() {
  return (
    <div role="status" aria-label="Loading summary" className="flex flex-col gap-4">
      <Skeleton className="h-40" />
      <div className="card mx-auto w-full max-w-4xl p-6 md:p-10">
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        <Skeleton className="mt-8 h-20" />
        <Skeleton className="mt-6 h-48" />
      </div>
    </div>
  )
}

export function SnapshotView({ snapshot }: { snapshot: EstateSnapshot }) {
  const doc = useMemo(() => normalizeSnapshot(snapshot), [snapshot])
  const [options, setOptions] = useState<PrintOptions>(DEFAULT_PRINT_OPTIONS)
  const { hidden } = usePrivacy()
  const id = useId()
  const set = (key: keyof PrintOptions) => (next: boolean) => setOptions((o) => ({ ...o, [key]: next }))

  return (
    <div className="flex flex-col gap-6">
      <Card data-no-print aria-labelledby={`${id}-options`}>
        <CardHeader
          id={`${id}-options`}
          title="Print options"
          description="Sensitive details are left out of the document until you include them. Your choices aren't saved."
          action={
            <>
              <Button variant="primary" icon={<Printer size={16} aria-hidden />} onClick={() => window.print()}>
                Print or save as PDF
              </Button>
              <Button variant="secondary" aria-label="Download JSON" icon={<Download size={16} aria-hidden />} onClick={() => downloadSnapshotJson(snapshot)}>
                JSON
              </Button>
            </>
          }
        />
        <CardBody className="flex flex-col gap-3">
          <fieldset>
            <legend className="sr-only">Include in the document</legend>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <CheckboxRow id={`${id}-values`} label="Include exact values" description="Recorded account and liability values" checked={options.values} onChange={set('values')} />
              <CheckboxRow id={`${id}-contacts`} label="Include contacts" description="Beneficiary contact summaries" checked={options.contacts} onChange={set('contacts')} />
              <CheckboxRow id={`${id}-references`} label="Include account and document references" description="Where documents and accounts are held" checked={options.references} onChange={set('references')} />
              <CheckboxRow id={`${id}-notes`} label="Include private notes" description="Beneficiary, asset, and allocation notes" checked={options.notes} onChange={set('notes')} />
            </div>
          </fieldset>
          {hidden && options.values ? (
            <Notice tone="info" title="Values stay masked while privacy mode is on">
              Turn off privacy mode in the top bar to print exact values.
            </Notice>
          ) : null}
          <p className="flex items-start gap-2 text-xs text-muted">
            <EyeOff size={14} aria-hidden className="mt-px shrink-0" />
            The JSON download is the complete retained record. It includes every field, whatever you choose here.
          </p>
        </CardBody>
      </Card>
      <SummaryDocument doc={doc} options={options} />
    </div>
  )
}

function OptionalMoney({ minor, currency, show }: { minor: string | null; currency: string; show: boolean }) {
  if (!show) return <span className="text-sm font-normal text-subtle">Value excluded</span>
  if (minor === null) return <Unavailable label="Not recorded" />
  return <Money minor={minor} currency={currency} />
}

function Section({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('mt-9', className)}>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function SummaryDocument({ doc, options }: { doc: SnapshotDocument; options: PrintOptions }) {
  const nameOf = (id: string) => doc.beneficiaries.find((b) => b.id === id)?.name ?? 'Unknown beneficiary'
  const current = doc.assets.filter((a) => !a.archived)
  const planned = current.filter((a) => a.directive?.isIncluded)
  const outside = current.filter((a) => !a.directive?.isIncluded)
  const residuePrimary = doc.residuary.filter((r) => r.tier === 'primary')
  const residueContingent = doc.residuary.filter((r) => r.tier === 'contingent')

  return (
    <article className="estate-document card mx-auto w-full max-w-4xl px-5 py-7 md:px-10 md:py-10" aria-label="Estate Planning Summary">
      <header className="border-b border-line-strong pb-6">
        <h1 className="display text-2xl text-ink md:text-[2rem] md:leading-[2.5rem]">{doc.title}</h1>
        <p className="mt-2 text-sm text-muted">
          Estate Planning Summary, version {doc.version}
          {doc.ownerDisplayName ? ` · Prepared for ${doc.ownerDisplayName}` : ''}
        </p>
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <MetaRow label="Values as of">
            <DateText value={doc.valueAsOfDate} />
          </MetaRow>
          <MetaRow label="Generated">
            <DateText value={doc.generatedAt} withTime />
          </MetaRow>
          {doc.jurisdiction ? <MetaRow label="Jurisdiction reference">{doc.jurisdiction}</MetaRow> : null}
          {doc.lastReviewedDate ? (
            <MetaRow label="Last reviewed">
              <DateText value={calendarDate(doc.lastReviewedDate)} />
            </MetaRow>
          ) : null}
        </dl>
      </header>

      <div className="mt-6 rounded-md border border-line-strong bg-sunken px-4 py-3 text-sm text-ink">
        <p>
          <strong className="font-semibold">Planning document only.</strong> {doc.disclaimer} It does not address witnessing, capacity, probate, guardianship, trusts, taxes, or other
          jurisdiction-specific requirements.
        </p>
        {options.values && doc.accountsWarning ? <p className="mt-2 text-muted">Values: {doc.accountsWarning}</p> : null}
      </div>

      <Section title="Asset directions" description="Ownership share is the portion of each asset you assert is yours to leave. Contingent beneficiaries are alternatives, not additions.">
        {planned.length === 0 ? (
          <p className="text-sm text-muted">No assets were included in the plan when this summary was made.</p>
        ) : (
          <div className="flex flex-col divide-y divide-line border-y border-line">
            {planned.map((asset) => {
              const d = asset.directive!
              const primary = asset.allocations.filter((a) => a.tier === 'primary')
              const primaryBps = primary.reduce((sum, a) => sum + a.allocationBps, 0)
              return (
                <section key={asset.id} className="break-inside-avoid py-5">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <h3 className="min-w-0 text-base font-semibold text-ink">{asset.name}</h3>
                    <p className="text-base font-semibold text-ink">
                      <OptionalMoney minor={asset.valueMinor} currency={asset.currency} show={options.values} />
                    </p>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {asset.categoryName ? `${asset.categoryName} · ` : ''}
                    Ownership share <Bps value={d.ownershipShareBps} /> · {labelOf(TRANSFER_CONTEXTS, d.transferContext)} · {labelOf(DISTRIBUTION_METHODS, d.distributionMethod)}
                  </p>
                  {options.references && asset.accountReference ? <p className="mt-1 text-sm text-ink">Account reference: {asset.accountReference}</p> : null}
                  {options.references && d.documentReference ? <p className="mt-1 text-sm text-ink">Document reference: {d.documentReference}</p> : null}
                  {options.notes && d.notes ? <p className="mt-1 whitespace-pre-line text-sm text-ink">{d.notes}</p> : null}
                  <AllocationTable rows={asset.allocations} nameOf={nameOf} showNotes={options.notes} caption={`Beneficiaries of ${asset.name}`} />
                  {primaryBps < FULL_BPS ? (
                    <p className="mt-2 text-sm text-muted">
                      {residuePrimary.length ? (
                        <>
                          The residual estate covers the remaining <Bps value={FULL_BPS - primaryBps} />.
                        </>
                      ) : (
                        <>
                          <Bps value={FULL_BPS - primaryBps} /> has no primary beneficiary.
                        </>
                      )}
                    </p>
                  ) : null}
                </section>
              )
            })}
          </div>
        )}
        {outside.length ? (
          <p className="mt-3 text-sm text-muted">
            Not in the plan: {outside.map((a) => `${a.name} (${a.directive ? 'excluded' : 'no directive recorded'})`).join(', ')}.
          </p>
        ) : null}
      </Section>

      <Section title="Residual estate" description="Applies to unallocated portions of listed assets and to property not listed.">
        {doc.residuary.length === 0 ? (
          <p className="text-sm text-muted">No residual beneficiaries were recorded.</p>
        ) : (
          <AllocationTable rows={[...residuePrimary, ...residueContingent]} nameOf={nameOf} showNotes={options.notes} caption="Residual estate beneficiaries" />
        )}
      </Section>

      <Section title="Beneficiaries">
        {doc.beneficiaries.length === 0 ? (
          <p className="text-sm text-muted">No beneficiaries were recorded.</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {doc.beneficiaries.map((b) => (
              <li key={b.id} className="break-inside-avoid py-3 text-sm">
                <p className="font-semibold text-ink">
                  {b.name}
                  {b.archived ? <span className="font-normal text-muted"> (archived)</span> : null}
                </p>
                <p className="text-muted">{[labelOf(BENEFICIARY_KINDS, b.kind), b.relationship].filter(Boolean).join(' · ')}</p>
                {options.contacts && b.contactSummary ? <p className="mt-1 text-ink">Contact: {b.contactSummary}</p> : null}
                {options.notes && b.notes ? <p className="mt-1 whitespace-pre-line text-ink">{b.notes}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Liabilities" description="Listed separately. Debts are not assigned as gifts, but they may reduce what each beneficiary receives.">
        {doc.liabilities.length === 0 ? (
          <p className="text-sm text-muted">No active liabilities were recorded.</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {doc.liabilities.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-4 py-3 text-sm">
                <span className="text-ink">{l.name}</span>
                <span className="font-semibold text-ink">
                  <OptionalMoney minor={l.valueMinor} currency={l.currency} show={options.values} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Review checklist">
        {doc.reviewItems.length === 0 ? (
          <p className="text-sm text-muted">No review items were stored with this summary. Check the live completion review before relying on it.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {doc.reviewItems.map((item, i) => (
              <li key={`${item.code}-${item.accountId ?? i}`} className="flex gap-2">
                <span className="shrink-0 font-medium text-muted">{item.severity === 'blocking' ? 'Decide:' : 'Review:'}</span>
                <span className="text-ink">{item.message}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <footer className="mt-10 border-t border-line pt-4 text-xs text-muted">
        <p>Integrity hash (SHA-256). It confirms this record is unchanged, not that it is financially or legally correct.</p>
        <p className="mt-1 break-all font-mono text-ink">{doc.contentHash}</p>
      </footer>
    </article>
  )
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  )
}

function AllocationTable({ rows, nameOf, showNotes, caption }: { rows: SnapshotAllocation[]; nameOf(id: string): string; showNotes: boolean; caption: string }) {
  if (rows.length === 0) return <p className="mt-3 text-sm text-muted">No beneficiaries were named for this asset.</p>
  return (
    <table className="mt-3 w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead className="text-xs text-muted">
        <tr className="border-b border-line">
          <th scope="col" className="py-1.5 pr-3 text-left font-medium">
            Beneficiary
          </th>
          <th scope="col" className="px-3 py-1.5 text-left font-medium">
            Priority
          </th>
          <th scope="col" className="py-1.5 pl-3 text-right font-medium">
            Share
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id || `${r.beneficiaryId}-${r.tier}`} className="border-b border-line last:border-0">
            <td className="py-2 pr-3 align-top text-ink">
              {nameOf(r.beneficiaryId)}
              {showNotes && r.notes ? <p className="text-xs text-muted">{r.notes}</p> : null}
            </td>
            <td className="px-3 py-2 align-top text-muted">{r.tier === 'primary' ? 'Primary' : 'Contingent'}</td>
            <td className="py-2 pl-3 text-right align-top font-medium text-ink">
              <Bps value={r.allocationBps} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
