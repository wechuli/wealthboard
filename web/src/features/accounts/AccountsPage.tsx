import { Archive, ArchiveRestore, LayoutGrid, Layers, LineChart, Plus, Rows3, Upload } from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { api } from '@/api'
import type { Account, Category } from '@/api/types'
import { CategoryIcon } from '@/components/CategoryIcon'
import { DateText, Money } from '@/components/format'
import { Button, buttonClass } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { Segmented } from '@/components/ui/Segmented'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { usePrefs } from '@/lib/prefs'
import { useAccounts, useAccountSummaries, useApiMutation, useCategories } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { AccountCard, AccountDenseList, AccountTable, GroupHeading } from './AccountViews'
import { dataState, GROUP_OPTIONS, groupItems, isPositions, joinAccounts, parseParam, SORT_OPTIONS, sortItems, type GroupBy, type ShowMode, type SortBy, type ViewMode } from './model'
import { ToolbarSelect } from './parts'

const VIEWS = ['cards', 'table'] as const
const SHOWS = ['active', 'archived'] as const

export default function AccountsPage() {
  usePageTitle('Accounts')
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const group = parseParam<GroupBy>(params.get('group'), GROUP_OPTIONS, 'category')
  const sort = parseParam<SortBy>(params.get('sort'), SORT_OPTIONS, 'value')
  const view = parseParam<ViewMode>(params.get('view'), VIEWS, 'cards')
  const show = parseParam<ShowMode>(params.get('show'), SHOWS, 'active')
  const importOpen = params.get('import') === '1'

  const setParam = (key: string, value: string | null, fallback?: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (value === null || value === fallback) next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true },
    )

  const active = useAccounts('active')
  const archived = useAccounts('archived')
  const summaries = useAccountSummaries()
  const categories = useCategories()
  const { baseCurrency } = usePrefs()

  const items = useMemo(() => joinAccounts(active.data ?? [], summaries.data, categories.data), [active.data, summaries.data, categories.data])
  const groups = useMemo(() => groupItems(sortItems(items, sort), group, { baseCurrency }), [items, sort, group, baseCurrency])
  const groupIdBase = useId()
  const groupIds = groups.map((_, i) => `${groupIdBase}-g${i}`)

  const incomplete = items.filter((i) => dataState(i) === 'incomplete').length
  const stale = items.filter((i) => dataState(i) === 'stale').length
  const archivedCount = archived.data?.length

  const header = (
    <PageHeader
      title="Accounts"
      description={<>Every account you track, in its own currency and in {baseCurrency}.</>}
      actions={
        <>
          <Button icon={<Upload size={16} aria-hidden />} onClick={() => setParam('import', '1')}>
            Import history
          </Button>
          <Button variant="primary" icon={<Plus size={16} aria-hidden />} onClick={() => navigate('/accounts/new')}>
            Add account
          </Button>
        </>
      }
    />
  )

  const importDialog = <ImportPicker open={importOpen} onOpenChange={(o) => setParam('import', o ? '1' : null)} accounts={active.data ?? []} />

  if (active.isPending) return <AccountsSkeleton header={header} />
  if (active.isError)
    return (
      <div className="page">
        {header}
        <div className="card">
          <ErrorState error={active.error} onRetry={() => void active.refetch()} title="Your accounts could not be loaded" />
        </div>
      </div>
    )

  const noAccounts = active.data.length === 0 && (archivedCount ?? 0) === 0

  return (
    <div className="page">
      {header}
      {importDialog}

      {noAccounts ? (
        <FirstAccount />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-3" role="toolbar" aria-label="Account list options">
            <Segmented<ShowMode>
              label="Show"
              value={show}
              onChange={(v) => setParam('show', v, 'active')}
              options={[
                {
                  value: 'active',
                  label: (
                    <>
                      Active <span className="text-subtle">{active.data.length}</span>
                    </>
                  ),
                },
                {
                  value: 'archived',
                  label: (
                    <>
                      Archived{archivedCount !== undefined ? <span className="ml-1 text-subtle">{archivedCount}</span> : null}
                    </>
                  ),
                },
              ]}
            />
            {show === 'active' ? (
              <div className="flex flex-wrap items-center gap-2 md:ml-auto">
                <ToolbarSelect label="Group" value={group} onChange={(v) => setParam('group', v, 'category')} options={GROUP_OPTIONS} />
                <ToolbarSelect label="Sort" value={sort} onChange={(v) => setParam('sort', v, 'value')} options={SORT_OPTIONS} />
                <Segmented<ViewMode>
                  label="View"
                  value={view}
                  onChange={(v) => setParam('view', v, 'cards')}
                  options={[
                    { value: 'cards', label: <LayoutGrid size={16} aria-hidden />, ariaLabel: 'Card view' },
                    { value: 'table', label: <Rows3 size={16} aria-hidden />, ariaLabel: 'Compact table view' },
                  ]}
                />
              </div>
            ) : null}
          </div>

          {show === 'archived' ? (
            <ArchivedList query={archived} categories={categories.data} />
          ) : active.data.length === 0 ? (
            <div className="card">
              <EmptyState icon={<Archive size={22} aria-hidden />} title="All your accounts are archived" action={<Button onClick={() => setParam('show', 'archived')}>Show archived</Button>}>
                Restore one to bring it back into your totals, or add a new account.
              </EmptyState>
            </div>
          ) : (
            <>
              {(incomplete > 0 || stale > 0) && group !== 'state' ? (
                <Notice
                  tone="warning"
                  className="mb-6"
                  title={incomplete > 0 ? `${incomplete} ${incomplete === 1 ? 'account is' : 'accounts are'} incomplete` : `${stale} ${stale === 1 ? 'account has' : 'accounts have'} stale prices`}
                  action={
                    <Button size="sm" variant="secondary" onClick={() => setParam('group', 'state', 'category')}>
                      Group by data state
                    </Button>
                  }
                >
                  {incomplete > 0
                    ? 'A missing exchange rate or price keeps part of their value out of your totals. Each one links to the fix.'
                    : 'Their prices are older than your freshness threshold. Add a recent price to refresh them.'}
                  {incomplete > 0 && stale > 0 ? ` ${stale} more ${stale === 1 ? 'has' : 'have'} stale prices.` : null}
                </Notice>
              ) : null}

              {view === 'cards' ? (
                <div className="space-y-9">
                  {groups.map((g, i) => (
                    <section key={g.key} aria-labelledby={groupIds[i]}>
                      <GroupHeading group={g} id={groupIds[i]!} />
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {g.items.map((item) => (
                          <AccountCard key={item.account.id} item={item} baseCurrency={baseCurrency} />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <>
                  <AccountTable groups={groups} baseCurrency={baseCurrency} groupIds={groupIds} />
                  <AccountDenseList groups={groups} baseCurrency={baseCurrency} groupIds={groupIds} />
                </>
              )}
              {summaries.isError ? (
                <p className="mt-4 text-xs text-muted">
                  Trends and freshness could not be loaded.{' '}
                  <button type="button" className="link" onClick={() => void summaries.refetch()}>
                    Try again
                  </button>
                </p>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  )
}

function AccountsSkeleton({ header }: { header: ReactNode }) {
  return (
    <div className="page">
      {header}
      <div role="status" aria-label="Loading accounts">
        <div className="mb-6 flex flex-wrap gap-3">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-10 w-40 md:ml-auto" />
          <Skeleton className="h-10 w-36" />
          <Skeleton className="h-10 w-20" />
        </div>
        {[3, 2].map((n, g) => (
          <div key={g} className="mb-9">
            <Skeleton className="mb-3 h-6 w-44" />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: n }, (_, i) => (
                <div key={i} className="card p-5">
                  <div className="flex gap-3">
                    <Skeleton className="size-9" />
                    <div className="flex-1">
                      <Skeleton className="h-4 w-3/5" />
                      <Skeleton className="mt-2 h-3 w-2/5" />
                    </div>
                  </div>
                  <Skeleton className="mt-6 h-3 w-12" />
                  <Skeleton className="mt-2 h-7 w-44" />
                  <Skeleton className="mt-3 h-4 w-32" />
                  <Skeleton className="mt-5 h-3 w-full" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** First run: teaches the two kinds of account and leads to the wizard. */
function FirstAccount() {
  return (
    <section className="card overflow-hidden" aria-labelledby="first-account">
      <div className="grid md:grid-cols-[1.1fr_1fr]">
        <div className="p-6 md:p-10">
          <h2 id="first-account" className="display text-2xl text-ink">
            Start with the account you check most
          </h2>
          <p className="mt-3 max-w-[48ch] text-base text-muted">
            Wealthboard keeps a ledger of everything you own and owe. Add one account with today's value; history, trends, and goals build up from there. You can import past transactions later.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link to="/accounts/new" className={buttonClass({ variant: 'primary', size: 'lg' })}>
              <Plus size={18} aria-hidden />
              Add your first account
            </Link>
          </div>
        </div>
        <div className="border-t border-line bg-sunken/50 p-6 md:border-l md:border-t-0 md:p-10">
          <p className="text-sm font-medium text-ink">Two ways to track an account</p>
          <dl className="mt-4 space-y-5">
            <div className="flex gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface text-accent shadow-e1">
                <LineChart size={18} aria-hidden />
              </span>
              <div>
                <dt className="text-sm font-semibold text-ink">Value-tracked</dt>
                <dd className="mt-0.5 text-sm text-muted">One running value. For savings, money-market funds, M-Pesa, land, a car, or a loan.</dd>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface text-accent shadow-e1">
                <Layers size={18} aria-hidden />
              </span>
              <div>
                <dt className="text-sm font-semibold text-ink">Position-tracked</dt>
                <dd className="mt-0.5 text-sm text-muted">Cash plus holdings valued from unit prices. For a brokerage or an NSE portfolio.</dd>
              </div>
            </div>
          </dl>
        </div>
      </div>
    </section>
  )
}

function ArchivedList({ query, categories }: { query: ReturnType<typeof useAccounts>; categories?: Category[] }) {
  const online = useOnline()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const restore = useApiMutation({
    mutationFn: (a: Account) => api.accounts.setArchived(a.id, false),
    success: (_r, a) => `${a.name} restored`,
  })
  if (query.isPending)
    return (
      <div className="card divide-y divide-line" role="status" aria-label="Loading archived accounts">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-3 p-4">
            <Skeleton className="size-9" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-9 w-24" />
          </div>
        ))}
      </div>
    )
  if (query.isError)
    return (
      <div className="card">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
      </div>
    )
  if (query.data.length === 0)
    return (
      <div className="card">
        <EmptyState icon={<Archive size={22} aria-hidden />} title="Nothing archived">
          Archive an account you no longer use to keep its history while leaving it out of your totals and lists. You can restore it any time.
        </EmptyState>
      </div>
    )
  return (
    <section aria-labelledby="archived-heading">
      <h2 id="archived-heading" className="sr-only">
        Archived accounts
      </h2>
      <p className="mb-3 text-sm text-muted">Archived accounts keep their history but are left out of totals, goals, and insights.</p>
      <ul className="card divide-y divide-line">
        {query.data.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 md:px-5">
            <CategoryIcon name={categories?.find((c) => c.id === a.categoryId)?.icon ?? (a.isLiability ? 'HandCoins' : 'CircleDollarSign')} framed className="opacity-70" />
            <div className="min-w-0 flex-1 basis-48">
              <Link to={`/accounts/${a.id}`} className="block truncate font-medium text-ink hover:underline">
                {a.name}
              </Link>
              <p className="truncate text-sm text-muted">
                {a.institutionName ?? 'No institution'} · {a.categoryName}
                {a.archivedAt ? (
                  <>
                    {' · Archived '}
                    <DateText value={a.archivedAt} />
                  </>
                ) : null}
              </p>
            </div>
            <div className="text-right text-sm">
              <span className="block text-xs text-muted">{a.isLiability ? 'Owed' : 'Last value'}</span>
              <Money minor={a.currentValueMinor} currency={a.currency} className={cn('font-medium', a.isLiability && 'text-negative')} />
            </div>
            <Button
              size="sm"
              icon={<ArchiveRestore size={15} aria-hidden />}
              disabled={!online}
              title={online ? undefined : OFFLINE_REASON}
              loading={restore.isPending && pendingId === a.id}
              onClick={() => {
                setPendingId(a.id)
                restore.mutate(a)
              }}
            >
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Account picker for "Import history" (opened by ?import=1). */
function ImportPicker({ open, onOpenChange, accounts }: { open: boolean; onOpenChange(o: boolean): void; accounts: Account[] }) {
  const value = accounts.filter((a) => !isPositions(a))
  const positions = accounts.filter(isPositions)
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Import history" description="Choose the account the transactions belong to. You'll preview every row before anything is saved.">
      {accounts.length === 0 ? (
        <p className="text-sm text-muted">
          Add an account first, then import its history.{' '}
          <Link to="/accounts/new" className="link">
            Add account
          </Link>
        </p>
      ) : (
        <>
          <ul className="-mx-2 flex flex-col">
            {value.map((a) => (
              <li key={a.id}>
                <Link to={`/accounts/${a.id}/import`} className="flex min-h-12 items-center gap-3 rounded-md px-2 py-2 hover:bg-sunken">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{a.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {a.institutionName ?? a.categoryName} · {a.currency}
                    </span>
                  </span>
                  <Upload size={16} aria-hidden className="text-subtle" />
                </Link>
              </li>
            ))}
          </ul>
          {positions.length ? (
            <div className="mt-4 border-t border-line pt-4">
              <p className="text-xs font-medium text-muted">Position-tracked: trades, quantities, and prices</p>
              <ul className="-mx-2 mt-1 flex flex-col">
                {positions.map((a) => (
                  <li key={a.id}>
                    <Link to={`/accounts/${a.id}/import`} className="flex min-h-12 items-center gap-3 rounded-md px-2 py-2 hover:bg-sunken">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{a.name}</span>
                        <span className="block truncate text-xs text-muted">
                          {a.institutionName ?? a.categoryName} · {a.currency}
                        </span>
                      </span>
                      <Upload size={16} aria-hidden className="text-subtle" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </Dialog>
  )
}
