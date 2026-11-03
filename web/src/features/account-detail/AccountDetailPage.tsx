import { ArchiveRestore, ChevronLeft, Layers, LineChart, SearchX } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router'
import { api } from '@/api'
import { ApiProblem } from '@/api/problem'
import type { Account } from '@/api/types'
import { CategoryIcon } from '@/components/CategoryIcon'
import { DateText } from '@/components/format'
import { Badge } from '@/components/ui/Badge'
import { Button, buttonClass } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { isPositions } from '@/features/accounts/model'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { useAccount, useAccountAnalytics, useAccountExtras, useAccountSummaries, useApiMutation, useCategories } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { AccountActions, useAccountDialogs, type Variant } from './actions'
import { LiabilityView } from './LiabilityView'
import { PositionsView } from './PositionsView'
import { SectionNav, type DetailTab } from './sections'
import { ValueView } from './ValueView'

const TABS: Record<Variant, { value: DetailTab; label: string }[]> = {
  value: [
    { value: 'overview', label: 'Overview' },
    { value: 'activity', label: 'Activity' },
    { value: 'valuations', label: 'Valuations' },
    { value: 'notes', label: 'Notes' },
  ],
  positions: [
    { value: 'overview', label: 'Overview' },
    { value: 'holdings', label: 'Holdings' },
    { value: 'activity', label: 'Activity' },
    { value: 'notes', label: 'Notes' },
  ],
  liability: [
    { value: 'overview', label: 'Overview' },
    { value: 'activity', label: 'Payments' },
    { value: 'notes', label: 'Notes' },
  ],
}

const back = (
  <Link to="/accounts" className="inline-flex h-9 items-center gap-1 rounded-md pr-2 text-sm text-muted hover:text-ink">
    <ChevronLeft size={16} aria-hidden />
    Accounts
  </Link>
)

const variantOf = (a: Account): Variant => (a.isLiability ? 'liability' : isPositions(a) ? 'positions' : 'value')

export default function AccountDetailPage() {
  const { accountId } = useParams()
  const [params, setParams] = useSearchParams()
  const account = useAccount(accountId)
  const analytics = useAccountAnalytics(accountId)
  const extras = useAccountExtras(accountId)
  const summaries = useAccountSummaries()
  const categories = useCategories()
  const dialogs = useAccountDialogs()
  usePageTitle(account.data?.name ?? 'Account')

  if (account.isPending) return <DetailSkeleton />
  if (account.isError) {
    const notFound = ApiProblem.is(account.error) && account.error.status === 404
    return (
      <div className="page">
        <PageHeader back={back} title={notFound ? 'Account not found' : 'Account'} />
        <div className="card">
          {notFound ? (
            <EmptyState
              icon={<SearchX size={22} aria-hidden />}
              title="There's no account at this address"
              action={
                <Link to="/accounts" className={buttonClass({ variant: 'primary' })}>
                  Back to accounts
                </Link>
              }
            >
              It may have been deleted, or the link is incomplete. Archived accounts are still listed under Archived.
            </EmptyState>
          ) : (
            <ErrorState error={account.error} onRetry={() => void account.refetch()} title="This account could not be loaded" />
          )}
        </div>
      </div>
    )
  }

  const a = account.data
  const variant = variantOf(a)
  const tabs = TABS[variant]
  const rawTab = params.get('tab')
  const tab: DetailTab = tabs.some((t) => t.value === rawTab) ? (rawTab as DetailTab) : 'overview'
  const setTab = (t: DetailTab) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (t === 'overview') next.delete('tab')
        else next.set('tab', t)
        return next
      },
      { replace: true },
    )
  const category = categories.data?.find((c) => c.id === a.categoryId)
  const summary = summaries.data?.find((s) => s.accountId === a.id)
  const valuationLed = variant === 'value' && category?.isLiquid === false
  const viewProps = { account: a, summary, analytics, extras, tab, valuationLed, onEdit: dialogs.openEdit }

  return (
    <div className="page">
      <PageHeader
        back={back}
        title={
          <span className="flex items-center gap-3">
            <CategoryIcon name={category?.icon ?? (a.isLiability ? 'hand-coins' : 'circle-dollar-sign')} framed className={a.isLiability ? 'bg-negative-soft text-negative' : 'bg-accent-soft text-accent'} size={18} />
            <span className="min-w-0">{a.name}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
            <span>{a.institutionName ?? 'No institution'}</span>
            <span aria-hidden>·</span>
            <span>{a.categoryName}</span>
            <span aria-hidden>·</span>
            <span className="num">{a.currency}</span>
            <Badge icon={isPositions(a) ? <Layers size={12} aria-hidden /> : <LineChart size={12} aria-hidden />}>{isPositions(a) ? 'Position-tracked' : 'Value-tracked'}</Badge>
            {a.isLiability ? <Badge tone="negative">Liability · reduces net worth</Badge> : null}
            {!a.isIncludedInNetWorth ? <Badge tone="info">Not in net worth</Badge> : null}
          </span>
        }
        actions={<AccountActions account={a} variant={variant} valuationLed={valuationLed} dialogs={dialogs} />}
      />
      {a.archivedAt ? <ArchivedNotice account={a} /> : null}
      <SectionNav tabs={tabs} current={tab} onChange={setTab} />
      {variant === 'liability' ? <LiabilityView {...viewProps} /> : variant === 'positions' ? <PositionsView {...viewProps} /> : <ValueView {...viewProps} />}
    </div>
  )
}

function ArchivedNotice({ account }: { account: Account }) {
  const online = useOnline()
  const restore = useApiMutation({ mutationFn: () => api.accounts.setArchived(account.id, false), success: `${account.name} restored` })
  return (
    <Notice
      tone="info"
      className="mb-6"
      title={
        <>
          Archived{account.archivedAt ? <> on <DateText value={account.archivedAt} /></> : null}
        </>
      }
      action={
        <Button size="sm" icon={<ArchiveRestore size={15} aria-hidden />} loading={restore.isPending} disabled={!online} title={online ? undefined : OFFLINE_REASON} onClick={() => restore.mutate(undefined)}>
          Restore
        </Button>
      }
    >
      Its history is kept, but it's left out of your totals and goals. Restore it to record new activity.
    </Notice>
  )
}

function DetailSkeleton() {
  return (
    <div className="page" role="status" aria-label="Loading account">
      <Skeleton className="h-4 w-24" />
      <div className="mt-4 flex items-center gap-3">
        <Skeleton className="size-9" />
        <Skeleton className="h-9 w-72 max-w-full" />
      </div>
      <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <div className="card p-6">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-3 h-11 w-64 max-w-full" />
            <Skeleton className="mt-3 h-4 w-48" />
            <Skeleton className="mt-8 h-[260px]" />
          </div>
          <Skeleton className="h-80" />
        </div>
        <div className="space-y-5">
          <Skeleton className="h-64" />
          <Skeleton className="h-40" />
          <Skeleton className="h-56" />
        </div>
      </div>
    </div>
  )
}
