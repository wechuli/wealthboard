/** Building blocks shared by the three account-detail variants. */
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BadgePercent,
  Circle,
  Coins,
  Flag,
  HandCoins,
  Landmark,
  Receipt,
  ScrollText,
  Tag,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { AccountSummaryExt } from '@/api/extensions'
import type { Account, AccountAnalytics, ActivityItem } from '@/api/types'
import { DateText, Delta, Money, Quantity, UnitPrice } from '@/components/format'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Notice } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'
import { activityLabel, missingValueReason, priceFixHref, rateFixHref } from '@/features/accounts/model'
import { AsOf, BaseValue } from '@/features/accounts/parts'
import { cn } from '@/lib/cn'
import { formatMonthLong } from '@/lib/dates'
import { minorSign } from '@/lib/money'
import { usePrefs } from '@/lib/prefs'
import { activityEffect } from '@/lib/activity'
import { useAccountActivity, useAccountValuations } from '@/lib/queries'

export type DetailTab = 'overview' | 'holdings' | 'activity' | 'valuations' | 'notes'

/** A section that is always visible on desktop and only on its own tab below md. */
export function TabSection({ tab, current, className, children }: { tab: DetailTab; current: DetailTab; className?: string; children: ReactNode }) {
  return <div className={cn('min-w-0', tab !== current && 'max-md:hidden', className)}>{children}</div>
}

/** Mobile section switcher. Desktop shows every section in a two-column composition instead. */
export function SectionNav({ tabs, current, onChange }: { tabs: { value: DetailTab; label: string }[]; current: DetailTab; onChange(t: DetailTab): void }) {
  return (
    <nav aria-label="Account sections" className="scroll-x -mx-4 mb-5 border-b border-line px-4 md:hidden">
      <ul className="flex gap-1">
        {tabs.map((t) => (
          <li key={t.value} className="shrink-0">
            <button
              type="button"
              aria-current={current === t.value ? 'true' : undefined}
              onClick={() => onChange(t.value)}
              className={cn(
                '-mb-px flex h-11 items-center border-b-2 px-3 text-sm font-medium transition-colors',
                current === t.value ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink',
              )}
            >
              {t.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** Headline figure: native value (Fraunces), base value when the currency differs, month change, and as-of. */
export function ValueHero({ account, summary, label, extra }: { account: Account; summary?: AccountSummaryExt; label: string; extra?: ReactNode }) {
  const { baseCurrency } = usePrefs()
  const owed = account.isLiability
  return (
    <div className="px-4 pt-5 md:px-6 md:pt-6">
      <p className={cn('text-sm font-medium', owed ? 'text-negative' : 'text-muted')}>{label}</p>
      <p className={cn('display mt-1.5 text-[1.75rem] leading-9 sm:text-[2.25rem] sm:leading-[2.5rem] md:text-3xl', owed ? 'text-negative' : 'text-ink')}>
        <Money minor={account.currentValueMinor} currency={account.currency} />
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {account.currency !== baseCurrency || account.convertedValueMinor === null ? (
          <span className="inline-flex flex-wrap items-center gap-1.5 text-muted">
            {account.convertedValueMinor !== null ? <span>≈</span> : null}
            <BaseValue account={account} summary={summary} baseCurrency={baseCurrency} />
            {account.convertedValueMinor !== null ? <span className="text-subtle">in {baseCurrency}</span> : null}
          </span>
        ) : null}
        <Delta minor={account.monthlyChangeMinor} currency={account.currency} invert={owed} suffix="this month" />
        <span className="text-xs">
          <AsOf summary={summary} />
        </span>
      </div>
      {extra}
    </div>
  )
}

/** Explains why values are incomplete, with direct fixes. */
export function CompletenessNotice({ account, analytics, summary }: { account: Account; analytics?: AccountAnalytics; summary?: AccountSummaryExt }) {
  const { baseCurrency } = usePrefs()
  const reasons = analytics?.completenessReasons ?? []
  const missingPrices = (analytics?.positionSummary?.positions ?? []).filter((p) => p.unitPrice === null)
  const missing = missingValueReason(account, summary, baseCurrency)
  const rateCurrency = missing?.kind === 'rate' ? missing.currency : null
  const needsRate = rateCurrency !== null
  if (reasons.length === 0 && !needsRate && missingPrices.length === 0) return null
  const positions = analytics?.positionSummary?.positions ?? []
  // The server reports machine-readable reasons ("price:<instrumentId>", or a currency code); say them plainly.
  const describe = (reason: string): string => {
    const priceId = reason.startsWith('price:') ? reason.slice('price:'.length) : null
    if (priceId) {
      const p = positions.find((x) => x.instrumentId === priceId)
      const name = p ? p.instrumentSymbol || p.instrumentName : 'one holding'
      // A current price exists, so the gap is in the history (dates before the first price).
      return p && p.unitPrice !== null ? `${name} had no price on some earlier dates, so part of the history is incomplete` : `No price recorded for ${name}`
    }
    if (/^[A-Z]{3}$/.test(reason)) return `Missing ${reason} → ${baseCurrency} exchange rate`
    return reason
  }
  const list = [...new Set((reasons.length ? reasons : needsRate ? [`Missing ${rateCurrency} → ${baseCurrency} exchange rate`] : []).map(describe))]
  return (
    <Notice
      tone="warning"
      role="status"
      title={needsRate && missingPrices.length === 0 ? `Value in ${baseCurrency} is unavailable` : 'Some values are incomplete'}
      action={
        <span className="flex flex-wrap gap-2">
          {needsRate ? (
            <Link to={rateFixHref(rateCurrency, baseCurrency)} className="link text-sm font-medium">
              Add {rateCurrency} rate
            </Link>
          ) : null}
          {missingPrices.map((p) => (
            <Link key={p.instrumentId} to={priceFixHref(p.instrumentId)} className="link text-sm font-medium">
              Add {p.instrumentSymbol || p.instrumentName} price
            </Link>
          ))}
        </span>
      }
    >
      <ul className="list-disc space-y-0.5 pl-4">
        {list.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <p className="mt-1">
        {needsRate ? `The ${account.currency} value is complete; it's left out of totals in ${baseCurrency} until a ${rateCurrency} rate is added. ` : ''}
        {missingPrices.length ? 'Unpriced holdings are left out of the value rather than counted as zero.' : ''}
      </p>
    </Notice>
  )
}

/** A ledger row: label on the left, figure on the right, optional explanation. */
export function LedgerRow({ label, hint, children, strong }: { label: ReactNode; hint?: ReactNode; children: ReactNode; strong?: boolean }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-2.5', strong && 'pt-3')}>
      <dt className="min-w-0">
        <span className={cn('block text-sm', strong ? 'font-semibold text-ink' : 'text-ink')}>{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-muted">{hint}</span> : null}
      </dt>
      <dd className={cn('shrink-0 text-right text-sm', strong ? 'font-semibold' : 'font-medium')}>{children}</dd>
    </div>
  )
}

export function LinkedGoalsCard({ goals }: { goals: { id: string; name: string }[] | undefined }) {
  return (
    <Card aria-labelledby="goals-heading">
      <CardHeader id="goals-heading" title="Linked goals" />
      <CardBody className="pt-2">
        {goals === undefined ? (
          <Skeleton className="h-9" />
        ) : goals.length === 0 ? (
          <p className="text-sm text-muted">
            No goal uses this account.{' '}
            <Link to="/goals" className="link">
              Link it from a goal
            </Link>{' '}
            so its value counts as progress.
          </p>
        ) : (
          <ul className="space-y-1">
            {goals.map((g) => (
              <li key={g.id}>
                <Link to={`/goals/${g.id}`} className="-mx-2 flex min-h-11 items-center gap-2.5 rounded-md px-2 text-sm font-medium text-ink hover:bg-sunken">
                  <span className="grid size-7 place-items-center rounded-full bg-accent-soft text-accent">
                    <Target size={15} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{g.name}</span>
                  <ArrowUpRight size={15} aria-hidden className="text-subtle" />
                </Link>
              </li>
            ))}
            <li className="pt-1 text-xs text-muted">This account's value is the goal's progress. It is never double-counted as contributions.</li>
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

export function NotesCard({ account, onEdit }: { account: Account; onEdit?: () => void }) {
  const rows: [string, ReactNode][] = [
    ['Institution', account.institutionName ?? 'None'],
    ['Category', account.categoryName],
    ['Currency', account.currency],
    ['Tracking', account.trackingMode === 'positions' ? 'Position-tracked' : 'Value-tracked'],
    ['Reference', account.accountReference || '—'],
    ['Opened', account.openedAt ? <DateText key="o" value={account.openedAt} /> : '—'],
    ['In net worth', account.isIncludedInNetWorth ? 'Included' : 'Excluded'],
  ]
  return (
    <Card aria-labelledby="notes-heading">
      <CardHeader
        id="notes-heading"
        title="Notes and details"
        action={
          onEdit ? (
            <Button size="sm" variant="ghost" onClick={onEdit}>
              Edit
            </Button>
          ) : undefined
        }
      />
      <CardBody className="pt-2">
        {account.description || account.notes ? (
          <div className="mb-3 space-y-2 rounded-md bg-sunken/70 px-3.5 py-3 text-sm">
            {account.description ? <p className="font-medium text-ink">{account.description}</p> : null}
            {account.notes ? <p className="whitespace-pre-line text-muted">{account.notes}</p> : null}
          </div>
        ) : (
          <p className="mb-3 text-sm text-muted">No notes yet. Keep where documents live, who to call, or how the value is estimated.</p>
        )}
        <dl className="divide-y divide-line text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2">
              <dt className="text-muted">{k}</dt>
              <dd className="min-w-0 truncate text-right text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  )
}

// ---- activity feed ------------------------------------------------------------

const TYPE_ICONS: Record<string, LucideIcon> = {
  deposit: ArrowDownLeft,
  withdrawal: ArrowUpRight,
  interest: BadgePercent,
  dividend: Coins,
  fee: Receipt,
  transfer: ArrowLeftRight,
  opening_balance: Flag,
  opening_position: Flag,
  valuation: Landmark,
  price_update: Tag,
  buy: TrendingUp,
  sell: TrendingDown,
  capital_gain: TrendingUp,
  capital_loss: TrendingDown,
  liability_payment: HandCoins,
  liability_increase: Wallet,
  manual_adjustment: ScrollText,
}

export type FeedFilter = 'all' | 'trades' | 'prices' | 'cash'

function feedTitle(item: ActivityItem): string {
  const sym = item.instrumentSymbol || item.instrumentName || ''
  if (item.kind === 'price') return `${sym} price`
  if (item.kind === 'position') {
    if (item.type === 'buy') return `Bought ${sym}`
    if (item.type === 'sell') return `Sold ${sym}`
    return `${activityLabel(item.type)} · ${sym}`
  }
  if (item.type === 'transfer') return minorSign(activityEffect(item)) >= 0 ? 'Transfer in' : 'Transfer out'
  return activityLabel(item.type)
}

const KIND_LABEL: Record<ActivityItem['kind'], string> = { transaction: 'Cash', valuation: 'Valuation', position: 'Trade', price: 'Price' }

function FeedAmount({ item, owed }: { item: ActivityItem; owed: boolean }) {
  if (item.kind === 'price') return <UnitPrice value={item.unitPrice ?? null} currency={item.currency} className="text-ink" />
  if (item.kind === 'valuation')
    return (
      <span className="text-ink">
        <span className="mr-1 text-xs font-normal text-muted">Set to</span>
        <Money minor={item.amountMinor} currency={item.currency} />
      </span>
    )
  const effect = activityEffect(item)
  const s = minorSign(effect)
  const good = owed ? s < 0 : s > 0
  const tone = item.kind === 'position' || s === 0 ? 'text-ink' : good ? 'text-positive' : 'text-ink'
  return <Money minor={effect} currency={item.currency} sign="always" className={tone} />
}

/** One chronological feed (newest first), grouped by month, with "Load more". */
export function ActivityFeed({
  account,
  title,
  description,
  pageSize = 15,
  filters,
  emptyTitle,
  emptyBody,
  emptyAction,
  rowMenu,
}: {
  account: Account
  title: string
  description?: string
  pageSize?: number
  filters?: boolean
  emptyTitle: string
  emptyBody: ReactNode
  emptyAction?: ReactNode
  /** Optional per-row menu (edit, delete, undo). */
  rowMenu?: (item: ActivityItem) => ReactNode
}) {
  const { timezone } = usePrefs()
  const [limit, setLimit] = useState(pageSize)
  const [filter, setFilter] = useState<FeedFilter>('all')
  const q = useAccountActivity(account.id, { limit })
  const items = (q.data?.items ?? []).filter((i) => filter === 'all' || (filter === 'trades' ? i.kind === 'position' : filter === 'prices' ? i.kind === 'price' : i.kind === 'transaction'))
  const months: { key: string; items: ActivityItem[] }[] = []
  for (const it of items) {
    const key = it.date.slice(0, 7)
    const last = months.at(-1)
    if (last && last.key === key) last.items.push(it)
    else months.push({ key, items: [it] })
  }
  return (
    <Card aria-labelledby="activity-heading">
      <CardHeader
        id="activity-heading"
        title={title}
        description={description}
        action={
          filters ? (
            <div role="group" aria-label="Filter activity" className="flex flex-wrap gap-1">
              {(['all', 'trades', 'prices', 'cash'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn('h-9 rounded-full border px-3 text-xs font-medium transition-colors', filter === f ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:text-ink')}
                >
                  {f === 'all' ? 'All' : f === 'trades' ? 'Trades' : f === 'prices' ? 'Prices' : 'Cash'}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />
      {q.isPending ? (
        <CardBody>
          <div className="space-y-3" role="status" aria-label="Loading activity">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-2/5" />
                  <Skeleton className="mt-1.5 h-3 w-1/4" />
                </div>
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </CardBody>
      ) : q.isError ? (
        <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        filter !== 'all' && q.data.items.length > 0 ? (
          <p className="px-5 pb-5 pt-3 text-sm text-muted">Nothing of this kind in the loaded activity.</p>
        ) : (
          <EmptyState compact icon={<ScrollText size={20} aria-hidden />} title={emptyTitle} action={emptyAction}>
            {emptyBody}
          </EmptyState>
        )
      ) : (
        <div className="pb-2">
          {months.map((m) => (
            <section key={m.key} aria-label={formatMonthLong(`${m.key}-01`, timezone)}>
              <h3 className="border-y border-line bg-sunken/70 px-4 py-1.5 text-xs font-semibold text-muted md:px-5">{formatMonthLong(`${m.key}-01`, timezone)}</h3>
              <ul className="divide-y divide-line">
                {m.items.map((it) => {
                  const Icon = TYPE_ICONS[it.kind === 'valuation' ? 'valuation' : it.type] ?? Circle
                  const menu = rowMenu?.(it)
                  return (
                    <li key={`${it.kind}:${it.id}`} className="flex items-center gap-3 px-4 py-3 md:px-5">
                      <span
                        className={cn(
                          'grid size-9 shrink-0 place-items-center rounded-full',
                          it.kind === 'price' ? 'bg-info-soft text-info' : it.kind === 'position' ? 'bg-accent-soft text-accent' : it.kind === 'valuation' ? 'bg-warning-soft text-warning' : 'bg-sunken text-muted',
                        )}
                      >
                        <Icon size={16} aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{feedTitle(it)}</p>
                        <p className="truncate text-xs text-muted">
                          <span className="font-medium">{KIND_LABEL[it.kind]}</span>
                          {' · '}
                          <DateText value={it.date} />
                          {it.eventGroupId ? <> · Grouped</> : null}
                          {it.kind === 'position' && it.quantity && it.quantity !== '0' && it.unitPrice ? (
                            <>
                              {' · '}
                              <Quantity value={it.quantity} /> × <UnitPrice value={it.unitPrice} currency={account.currency} />
                            </>
                          ) : it.kind === 'position' && it.quantity && it.quantity !== '0' ? (
                            <>
                              {' · '}
                              <Quantity value={it.quantity} /> units
                            </>
                          ) : it.description && it.kind !== 'price' ? (
                            <> · {it.description}</>
                          ) : null}
                        </p>
                      </div>
                      <div className="shrink-0 text-right text-sm font-medium">
                        <FeedAmount item={it} owed={account.isLiability} />
                        {it.kind === 'position' ? <span className="block text-xs font-normal text-subtle">Cash effect</span> : null}
                      </div>
                      {rowMenu ? <div className="-mr-2 w-11 shrink-0 md:w-10">{menu}</div> : null}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
          {q.data.hasMore ? (
            <div className="flex justify-center border-t border-line px-4 pt-3">
              <Button variant="ghost" loading={q.isFetching} onClick={() => setLimit((l) => l + pageSize)}>
                Load more
              </Button>
            </div>
          ) : (
            <p className="border-t border-line px-5 pt-3 text-center text-xs text-subtle">That's everything since the account was opened.</p>
          )}
        </div>
      )}
    </Card>
  )
}

/** Valuation history: each valuation sets an absolute value; it is never a contribution. */
export function ValuationHistory({ account, onAdd, addDisabled }: { account: Account; onAdd(): void; addDisabled?: boolean }) {
  const q = useAccountValuations(account.id, { limit: 100 })
  const items = q.data?.items ?? []
  return (
    <Card aria-labelledby="valuations-heading">
      <CardHeader
        id="valuations-heading"
        title="Valuation history"
        description="Each valuation sets the value on its date. It is never counted as a contribution."
        action={
          <Button size="sm" onClick={onAdd} disabled={addDisabled}>
            Update value
          </Button>
        }
      />
      {q.isPending ? (
        <CardBody>
          <Skeleton className="h-32" />
        </CardBody>
      ) : q.isError ? (
        <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState compact icon={<Landmark size={20} aria-hidden />} title="No valuations yet">
          For land, vehicles, or anything without a daily price, record what it's worth from time to time. Each one becomes a point on the value history.
        </EmptyState>
      ) : (
        <>
          <div className="scroll-x hidden md:block">
            <table className="mt-2 w-full text-sm">
              <caption className="sr-only">Valuation history for {account.name}</caption>
              <thead>
                <tr className="border-y border-line bg-sunken/60 text-left text-xs text-muted">
                  <th scope="col" className="py-2 pl-5 pr-3 font-medium">
                    Date
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Note
                  </th>
                  <th scope="col" className="py-2 pl-3 pr-5 text-right font-medium">
                    Value
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((v) => (
                  <tr key={v.id} className="border-b border-line last:border-b-0">
                    <td className="py-2.5 pl-5 pr-3">
                      <DateText value={v.valuationDate} />
                    </td>
                    <td className="max-w-[280px] truncate px-3 py-2.5 text-muted">{v.notes ?? '—'}</td>
                    <td className="py-2.5 pl-3 pr-5 text-right font-medium">
                      <Money minor={v.valueMinor} currency={v.currency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-1 divide-y divide-line border-t border-line md:hidden">
            {items.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-ink">
                    <DateText value={v.valuationDate} />
                  </p>
                  {v.notes ? <p className="truncate text-xs text-muted">{v.notes}</p> : null}
                </div>
                <Money minor={v.valueMinor} currency={v.currency} className="shrink-0 text-sm font-medium" />
              </li>
            ))}
          </ul>
          <div className="h-2" />
        </>
      )}
    </Card>
  )
}

/** Cash-flow ledger used by value-tracked and position-tracked accounts. */
export function FlowLedger({ account, analytics, showGain }: { account: Account; analytics: AccountAnalytics; showGain: boolean }) {
  const m = analytics.metrics
  const c = account.currency
  return (
    <dl className="divide-y divide-line">
      <LedgerRow label="Contributions" hint="Deposits, transfers in, and the opening balance">
        <Money minor={m.contributionsMinor} currency={c} />
      </LedgerRow>
      <LedgerRow label="Withdrawals" hint="Money taken out, including transfers out">
        <Money minor={m.withdrawalsMinor} currency={c} />
      </LedgerRow>
      <LedgerRow label="Income" hint="Interest and dividends">
        <Money minor={m.incomeMinor} currency={c} />
      </LedgerRow>
      <LedgerRow label="Fees">
        <Money minor={m.feesMinor} currency={c} />
      </LedgerRow>
      {showGain ? (
        <LedgerRow strong label="Estimated gain" hint="Income and growth, after fees">
          <Delta minor={m.estimatedGainMinor} currency={c} />
        </LedgerRow>
      ) : null}
    </dl>
  )
}
