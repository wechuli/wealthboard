import { ChevronLeft, Layers, SearchX } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { ApiProblem } from '@/api/problem'
import { buttonClass } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { PageHeader } from '@/components/ui/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { isPositions } from '@/features/accounts/model'
import { useAccount } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { DirectImport } from './DirectImport'
import { InvestmentImport } from './InvestmentImport'

export default function ImportPage() {
  const { accountId } = useParams()
  const account = useAccount(accountId)
  usePageTitle(account.data ? `Import history · ${account.data.name}` : 'Import history')

  const back = (
    <Link to={accountId ? `/accounts/${accountId}` : '/accounts'} className="inline-flex h-9 items-center gap-1 rounded-md pr-2 text-sm text-muted hover:text-ink">
      <ChevronLeft size={16} aria-hidden />
      {account.data?.name ?? 'Account'}
    </Link>
  )

  if (account.isPending)
    return (
      <div className="page" role="status" aria-label="Loading">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-4 h-9 w-64" />
        <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-[260px] rounded-xl" />
          <Skeleton className="h-[360px]" />
        </div>
      </div>
    )

  if (account.isError) {
    const notFound = ApiProblem.is(account.error) && account.error.status === 404
    return (
      <div className="page">
        <PageHeader back={back} title="Import history" />
        <div className="card">
          {notFound ? (
            <EmptyState
              icon={<SearchX size={22} aria-hidden />}
              title="There's no account to import into"
              action={
                <Link to="/accounts?import=1" className={buttonClass({ variant: 'primary' })}>
                  Choose an account
                </Link>
              }
            >
              The account may have been deleted, or the link is incomplete.
            </EmptyState>
          ) : (
            <ErrorState error={account.error} onRetry={() => void account.refetch()} />
          )}
        </div>
      </div>
    )
  }

  const a = account.data
  return (
    <div className="page">
      <PageHeader
        back={back}
        title="Import history"
        description={
          <>
            {isPositions(a) ? 'Add instruments, trades, cash, and prices to ' : 'Add past transactions to '}
            <span className="font-medium text-ink">{a.name}</span>
            {a.institutionName ? ` at ${a.institutionName}` : ''}, in {a.currency}. Records already imported are recognised and skipped.
          </>
        }
      />
      {a.archivedAt ? (
        <div className="card">
          <EmptyState icon={<Layers size={22} aria-hidden />} title="This account is archived" action={<Link to={`/accounts/${a.id}`} className={buttonClass({ variant: 'secondary' })}>Open account</Link>}>
            Restore it from the account page before importing more history.
          </EmptyState>
        </div>
      ) : isPositions(a) ? (
        <InvestmentImport account={a} />
      ) : (
        <DirectImport account={a} />
      )}
    </div>
  )
}
