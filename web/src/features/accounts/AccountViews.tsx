import { ArrowRight, Layers, LineChart } from 'lucide-react'
import { Link } from 'react-router'
import { CategoryIcon } from '@/components/CategoryIcon'
import { Delta, Money, RelativeDate, Unavailable } from '@/components/format'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/cn'
import { dataState, isPositions, missingValueReason, modeLabel, type AccountGroup, type AccountItem } from './model'
import { AccountSparkline, AsOf, BaseValue, GoalLinks, MissingPriceFix, ValueLabel } from './parts'

function missingLabel(reason: ReturnType<typeof missingValueReason>): string {
  if (reason?.kind === 'rate') return `Missing ${reason.currency} rate`
  if (reason?.kind === 'price') return 'Missing price'
  return 'Incomplete'
}

function ModeChip({ item }: { item: AccountItem }) {
  const Icon = isPositions(item.account) ? Layers : LineChart
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-muted">
      <Icon size={13} aria-hidden />
      {modeLabel(item.account, item.summary?.positionCount)}
    </span>
  )
}

/** Card view: a ledger entry per account. The name is a stretched link; secondary links sit above it. */
export function AccountCard({ item, baseCurrency }: { item: AccountItem; baseCurrency: string }) {
  const { account, summary, category } = item
  const owed = account.isLiability
  const goals = summary?.linkedGoals ?? []
  return (
    <article
      className={cn(
        'card group relative flex min-w-0 flex-col p-4 transition-[border-color,box-shadow] duration-[var(--dur-1)] hover:border-line-strong/70 hover:shadow-e2 has-[a[data-primary]:focus-visible]:outline-2 has-[a[data-primary]:focus-visible]:outline-offset-2 has-[a[data-primary]:focus-visible]:outline-[var(--focus-ring)] md:p-5',
      )}
    >
      <div className="flex items-start gap-3">
        <CategoryIcon name={category?.icon ?? 'circle-dollar-sign'} framed className={owed ? 'bg-negative-soft text-negative' : undefined} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-ink">
            <Link to={`/accounts/${account.id}`} data-primary className="outline-none after:absolute after:inset-0 after:rounded-lg after:content-['']">
              {account.name}
            </Link>
          </h3>
          <p className="truncate text-sm text-muted">
            {account.institutionName ?? 'No institution'} · {account.categoryName}
          </p>
        </div>
        <div className="mt-1 hidden shrink-0 sm:block">
          <AccountSparkline account={account} summary={summary} width={84} height={30} />
        </div>
      </div>

      <div className="mt-5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <ValueLabel account={account} />
          <p className={cn('mt-0.5 text-xl font-semibold leading-tight', owed ? 'text-negative' : 'text-ink')}>
            <Money minor={account.currentValueMinor} currency={account.currency} />
          </p>
          <div className="mt-1 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <BaseValue account={account} summary={summary} baseCurrency={baseCurrency} />
            {summary && !summary.valueComplete ? <MissingPriceFix summary={summary} /> : null}
          </div>
        </div>
        <div className="shrink-0 sm:hidden">
          <AccountSparkline account={account} summary={summary} width={72} height={28} />
        </div>
      </div>
      <p className="mt-2 text-sm">
        <Delta minor={account.monthlyChangeMinor} currency={baseCurrency} invert={owed} suffix="this month" />
      </p>

      <div className="min-h-4 flex-1" aria-hidden />
      <footer className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3 text-xs">
        <ModeChip item={item} />
        {!account.isIncludedInNetWorth ? <span className="whitespace-nowrap text-muted">Not in net worth</span> : null}
        <AsOf summary={summary} />
        {summary ? (
          <span className="text-subtle">
            Updated <RelativeDate value={summary.lastUpdatedAt} className="lowercase" />
          </span>
        ) : null}
        {goals.length ? <GoalLinks goals={goals} className="basis-full" /> : null}
      </footer>
    </article>
  )
}

export function GroupHeading({ group, id }: { group: AccountGroup; id: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-2.5">
      <h2 id={id} className="flex items-center gap-2 text-md font-semibold text-ink">
        {group.icon ? <CategoryIcon name={group.icon} size={16} className={group.owed ? 'text-negative' : 'text-muted'} /> : null}
        {group.label}
        <span className="num rounded-full bg-sunken px-2 text-xs font-medium text-muted">
          {group.items.length}
          <span className="sr-only"> {group.items.length === 1 ? 'account' : 'accounts'}</span>
        </span>
      </h2>
      {group.owed ? (
        <Badge tone="negative" className="self-center">
          Reduces net worth
        </Badge>
      ) : null}
      {group.description && !group.owed ? <p className="text-sm text-muted">{group.description}</p> : null}
    </div>
  )
}

/** Compact table view (≥ md). Groups become row groups with their own header row. */
export function AccountTable({ groups, baseCurrency, groupIds }: { groups: AccountGroup[]; baseCurrency: string; groupIds: string[] }) {
  return (
    <div className="card scroll-x hidden md:block">
      <table className="w-full min-w-[920px] text-sm">
        <caption className="sr-only">Accounts with value, value in {baseCurrency}, change this month, and freshness</caption>
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th scope="col" className="py-3 pl-5 pr-3 font-medium">
              Account
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Tracking
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium">
              Value
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium">
              In {baseCurrency}
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium">
              This month
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              As of
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              <span className="sr-only">Trend, last 12 months</span>
              <span aria-hidden>Trend</span>
            </th>
            <th scope="col" className="py-3 pl-3 pr-5 text-right font-medium">
              Updated
            </th>
          </tr>
        </thead>
        {groups.map((g, gi) => (
          <tbody key={g.key} aria-labelledby={groupIds[gi]}>
            <tr className="bg-sunken/60">
              <th id={groupIds[gi]} scope="colgroup" colSpan={8} className="py-2 pl-5 pr-3 text-left text-xs font-semibold text-ink">
                <span className="inline-flex items-center gap-2">
                  {g.icon ? <CategoryIcon name={g.icon} size={14} className={g.owed ? 'text-negative' : 'text-muted'} /> : null}
                  {g.label}
                  <span className="num font-normal text-subtle">{g.items.length}</span>
                  {g.owed ? <span className="font-medium text-negative">· Reduces net worth</span> : null}
                </span>
              </th>
            </tr>
            {g.items.map(({ account, summary, category }) => {
              const owed = account.isLiability
              return (
                <tr key={account.id} className="border-t border-line transition-colors hover:bg-sunken/40">
                  <td className="max-w-[280px] py-2.5 pl-5 pr-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <CategoryIcon name={category?.icon ?? 'circle-dollar-sign'} size={16} className={cn('shrink-0', owed ? 'text-negative' : 'text-muted')} />
                      <div className="min-w-0">
                        <Link to={`/accounts/${account.id}`} className="block truncate font-medium text-ink hover:underline">
                          {account.name}
                        </Link>
                        <p className="truncate text-xs text-muted">
                          {account.institutionName ?? 'No institution'}
                          {!account.isIncludedInNetWorth ? ' · Not in net worth' : null}
                          {summary?.linkedGoals.length ? (
                            <>
                              {' · '}
                              <GoalLinks goals={summary.linkedGoals} />
                            </>
                          ) : null}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted">{isPositions(account) ? `Positions · ${summary?.positionCount ?? '—'}` : 'Value'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">
                    {owed ? <span className="mr-1.5 text-xs text-negative">Owed</span> : null}
                    <Money minor={account.currentValueMinor} currency={account.currency} className={cn('font-medium', owed ? 'text-negative' : 'text-ink')} />
                    {summary && !summary.valueComplete ? (
                      <span className="mt-0.5 block">
                        <MissingPriceFix summary={summary} className="justify-end" />
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-muted">
                    {account.currency === baseCurrency && account.convertedValueMinor !== null ? <span className="text-subtle">Same</span> : <BaseValue account={account} summary={summary} baseCurrency={baseCurrency} showIncomplete className="justify-end" />}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">
                    <Delta minor={account.monthlyChangeMinor} currency={baseCurrency} invert={owed} showIcon={false} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs">
                    <AsOf summary={summary} compact />
                  </td>
                  <td className="px-3 py-2.5">
                    <AccountSparkline account={account} summary={summary} width={80} height={24} />
                  </td>
                  <td className="whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-xs text-muted">{summary ? <RelativeDate value={summary.lastUpdatedAt} /> : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        ))}
      </table>
    </div>
  )
}

/** Below md, the table view becomes a dense list: one tappable row per account. */
export function AccountDenseList({ groups, baseCurrency, groupIds }: { groups: AccountGroup[]; baseCurrency: string; groupIds: string[] }) {
  return (
    <div className="space-y-6 md:hidden">
      {groups.map((g, gi) => (
        <section key={g.key} aria-labelledby={`${groupIds[gi]}-m`}>
          <GroupHeading group={g} id={`${groupIds[gi]}-m`} />
          <ul className="card divide-y divide-line overflow-hidden">
            {g.items.map((item) => {
              const { account, summary } = item
              const owed = account.isLiability
              const state = dataState(item)
              return (
                <li key={account.id}>
                  <Link to={`/accounts/${account.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-sunken/50 focus-visible:-outline-offset-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{account.name}</p>
                      <p className="truncate text-xs text-muted">
                        {modeLabel(account, summary?.positionCount)} · {account.institutionName ?? account.categoryName}
                        {!account.isIncludedInNetWorth ? ' · Not in net worth' : null}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={cn('text-sm font-medium', owed ? 'text-negative' : 'text-ink')}>
                        {owed ? <span className="mr-1 text-xs font-normal">Owed</span> : null}
                        <Money minor={account.currentValueMinor} currency={account.currency} />
                      </p>
                      <p className="mt-0.5 text-xs">
                        {state === 'incomplete' ? (
                          <Unavailable label={missingLabel(missingValueReason(account, summary, baseCurrency))} />
                        ) : account.currency !== baseCurrency ? (
                          <BaseValue account={account} summary={summary} baseCurrency={baseCurrency} interactive={false} className="text-muted" />
                        ) : (
                          <Delta minor={account.monthlyChangeMinor} currency={baseCurrency} invert={owed} showIcon={false} />
                        )}
                      </p>
                    </div>
                    <ArrowRight size={16} aria-hidden className="shrink-0 text-subtle" />
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
