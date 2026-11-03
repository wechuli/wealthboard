import { AlertTriangle, ArrowRight, CheckCircle2, Download, FilePlus2, FileText, Info, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '@/api'
import type { EstateSnapshotMeta } from '@/api/types'
import { Bps, DateText } from '@/components/format'
import { Badge } from '@/components/ui/Badge'
import { Button, buttonClass, IconButton } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { formatDateTime } from '@/lib/dates'
import { usePrefs } from '@/lib/prefs'
import { useApiMutation } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { downloadSnapshotJson } from './download'
import { EstateSkeleton, ProblemNotice, useEstateView } from './kit'
import { BENEFICIARY_KINDS, beneficiaryRoles, calendarDate, isMathematicallyComplete, labelOf, reviewItems, type EstateView, type ReviewItem } from './model'

export default function SummaryPage() {
  usePageTitle('Summary · Estate planning')
  const { view, isLoading, error, refetch } = useEstateView()
  if (error) return <ErrorState error={error} onRetry={refetch} title="The estate summary couldn't be loaded" />
  if (isLoading || !view) return <EstateSkeleton />
  return (
    <div className="flex flex-col gap-6">
      <CompletionReview view={view} />
      <BeneficiaryOverview view={view} />
      <RetainedSummaries view={view} />
    </div>
  )
}

function fixLink(item: ReviewItem): { to: string; label: string } | null {
  if (item.accountId) return { to: `/estate/distribution?account=${item.accountId}`, label: 'Open asset' }
  if (item.code === 'no-beneficiaries' || item.code === 'archived-residual-beneficiary') return { to: '/estate/beneficiaries', label: 'Beneficiaries' }
  if (item.code.startsWith('residue') || item.code === 'liabilities-review') return { to: '/estate/distribution', label: 'Distribution' }
  if (item.code === 'plan-not-reviewed' || item.code === 'review-due') return { to: '/estate', label: 'Plan details' }
  return null
}

function CompletionReview({ view }: { view: EstateView }) {
  const { today } = usePrefs()
  const items = reviewItems(view, today)
  const blocking = items.filter((i) => i.severity === 'blocking')
  const warnings = items.filter((i) => i.severity === 'warning')
  const complete = isMathematicallyComplete(items)
  return (
    <Card aria-labelledby="estate-review">
      <CardHeader
        id="estate-review"
        title="Completion review"
        description="Mathematical completeness only. It is not a legal-validity assessment."
        action={
          complete ? (
            <Badge tone="positive" icon={<CheckCircle2 size={12} aria-hidden />}>
              Allocation math complete
            </Badge>
          ) : (
            <Badge tone="warning" icon={<AlertTriangle size={12} aria-hidden />}>
              {blocking.length} decision{blocking.length === 1 ? '' : 's'} needed
            </Badge>
          )
        }
      />
      <CardBody className="flex flex-col gap-5">
        {blocking.length === 0 ? (
          <p className="flex items-start gap-2 text-sm text-ink">
            <CheckCircle2 size={16} aria-hidden className="mt-0.5 shrink-0 text-positive" />
            Every included asset has complete primary coverage through specific or residual shares.
          </p>
        ) : (
          <ReviewList title="Needs a decision" items={blocking} tone="blocking" />
        )}
        {warnings.length ? <ReviewList title="Worth reviewing" items={warnings} tone="warning" /> : null}
      </CardBody>
    </Card>
  )
}

function ReviewList({ title, items, tone }: { title: string; items: ReviewItem[]; tone: 'blocking' | 'warning' }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-2 text-sm font-semibold text-ink">{title}</h3>
      <ul className="divide-y divide-line rounded-md border border-line">
        {items.map((item) => {
          const fix = fixLink(item)
          return (
            <li key={`${item.code}-${item.accountId ?? 'plan'}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 pl-3 pr-1.5">
              {tone === 'blocking' ? <AlertTriangle size={15} aria-hidden className="shrink-0 text-warning" /> : <Info size={15} aria-hidden className="shrink-0 text-muted" />}
              <span className="min-w-0 flex-1 basis-52 py-1.5 text-sm text-ink">{item.message}</span>
              {fix ? (
                <Link to={fix.to} className={buttonClass({ variant: 'ghost', className: 'gap-1' })}>
                  {fix.label}
                  <ArrowRight size={15} aria-hidden />
                </Link>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function BeneficiaryOverview({ view }: { view: EstateView }) {
  const roles = beneficiaryRoles(view)
  return (
    <Card aria-labelledby="estate-beneficiary-overview">
      <CardHeader
        id="estate-beneficiary-overview"
        title="Beneficiary overview"
        description="Shares as recorded. Amounts per beneficiary aren't estimated here because current values are indicative."
      />
      <CardBody>
        {roles.length === 0 ? (
          <p className="text-sm text-muted">
            No beneficiaries yet.{' '}
            <Link to="/estate/beneficiaries" className="link">
              Add the first one
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {roles.map((r) => (
              <li key={r.beneficiary.id} className="grid gap-2 py-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:gap-6">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{r.beneficiary.name}</p>
                  <p className="text-xs text-muted">
                    {labelOf(BENEFICIARY_KINDS, r.beneficiary.kind)}
                    {r.beneficiary.relationship ? ` · ${r.beneficiary.relationship}` : ''}
                    {r.beneficiary.archivedAt ? ' · Archived' : ''}
                  </p>
                </div>
                <dl className="grid gap-1 text-sm sm:grid-cols-2">
                  <RoleLine label="Primary" entries={r.primary} />
                  <RoleLine label="Contingent" entries={r.contingent} />
                  {r.residuaryPrimaryBps ? (
                    <div className="flex gap-1.5">
                      <dt className="text-muted">Residue, primary</dt>
                      <dd>
                        <Bps value={r.residuaryPrimaryBps} />
                      </dd>
                    </div>
                  ) : null}
                  {r.residuaryContingentBps ? (
                    <div className="flex gap-1.5">
                      <dt className="text-muted">Residue, contingent</dt>
                      <dd>
                        <Bps value={r.residuaryContingentBps} />
                      </dd>
                    </div>
                  ) : null}
                  {!r.primary.length && !r.contingent.length && !r.residuaryPrimaryBps && !r.residuaryContingentBps ? (
                    <div className="sm:col-span-2">
                      <dt className="sr-only">Shares</dt>
                      <dd className="text-subtle">Not named in the plan yet</dd>
                    </div>
                  ) : null}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

function RoleLine({ label, entries }: { label: string; entries: { accountName: string; bps: number }[] }) {
  if (!entries.length) return null
  return (
    <div className="min-w-0 sm:col-span-2">
      <dt className="inline text-muted">{label}: </dt>
      <dd className="inline text-ink">
        {entries.map((e, i) => (
          <span key={`${e.accountName}-${i}`}>
            {i ? ', ' : ''}
            {e.accountName} <Bps value={e.bps} className="text-muted" />
          </span>
        ))}
      </dd>
    </div>
  )
}

function RetainedSummaries({ view }: { view: EstateView }) {
  const online = useOnline()
  const { dateFormat, timezone } = usePrefs()
  const nameOf = (s: EstateSnapshotMeta) => `summary of ${formatDateTime(s.generatedAt, dateFormat, timezone)}`
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState<EstateSnapshotMeta | null>(null)
  const [downloadError, setDownloadError] = useState<unknown>(null)
  const plan = view.workspace.plan
  const snapshots = view.workspace.snapshots
  const create = useApiMutation({
    mutationFn: () => api.estate.createSnapshot(),
    success: 'Summary retained',
    onSuccess: (s) => navigate(`/estate/snapshots/${s.id}`),
  })
  const remove = useApiMutation({
    mutationFn: (s: EstateSnapshotMeta) => api.estate.removeSnapshot(s.id),
    success: 'Summary deleted. The current plan did not change.',
    toastError: false,
    onSuccess: () => setDeleting(null),
  })
  const download = async (s: EstateSnapshotMeta) => {
    setDownloadError(null)
    try {
      downloadSnapshotJson(await api.estate.getSnapshot(s.id))
    } catch (e) {
      setDownloadError(e)
    }
  }
  const createButton = (
    <Button
      variant="primary"
      icon={<FilePlus2 size={16} aria-hidden />}
      loading={create.isPending}
      disabled={!online || !plan}
      title={!online ? OFFLINE_REASON : !plan ? 'Save plan details first' : undefined}
      onClick={() => create.mutate(undefined)}
    >
      Create summary
    </Button>
  )
  return (
    <Card aria-labelledby="estate-snapshots">
      <CardHeader
        id="estate-snapshots"
        title="Retained summaries"
        description="Immutable, dated copies of the plan with an integrity hash. Print one or save it as a PDF; exact values, contacts, references, and notes stay out until you include them."
        action={snapshots.length ? createButton : undefined}
      />
      <CardBody className="flex flex-col gap-4">
        {!plan ? (
          <p className="text-sm text-muted">
            <Link to="/estate" className="link">
              Save your plan details
            </Link>{' '}
            before creating a summary.
          </p>
        ) : null}
        <ProblemNotice error={downloadError} title="The summary couldn't be downloaded" />
        {snapshots.length === 0 ? (
          <EmptyState compact icon={<FileText size={20} aria-hidden />} title="No summaries retained yet" action={createButton}>
            A summary freezes today's plan so you can print it, share it with an adviser, or compare it with a later version. Later edits never change it.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line" aria-label="Retained summaries">
            {snapshots.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                    <span className="min-w-0 truncate">{s.title}</span>
                    <Badge>Version {s.version}</Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    Generated <DateText value={s.generatedAt} withTime /> · Values as of <DateText value={calendarDate(s.valueAsOfDate)} /> · Hash{' '}
                    <span className="font-mono">{s.contentHash.slice(0, 12)}…</span>
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  <Link to={`/estate/snapshots/${s.id}`} aria-label={`Open ${nameOf(s)}`} className={buttonClass({ variant: 'secondary' })}>
                    Open
                  </Link>
                  <IconButton label={`Download ${nameOf(s)} as JSON`} icon={<Download size={16} aria-hidden />} onClick={() => void download(s)} />
                  <IconButton label={`Delete ${nameOf(s)}`} icon={<Trash2 size={16} aria-hidden />} disabled={!online} onClick={() => setDeleting(s)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null)
            remove.reset()
          }
        }}
        title="Delete this retained summary?"
        description="The current plan won't change, but this dated copy and its hash can't be recovered."
        confirmLabel="Delete summary"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      >
        <ProblemNotice error={remove.error} />
      </ConfirmDialog>
    </Card>
  )
}
