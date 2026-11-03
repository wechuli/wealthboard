import { ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, BadgePercent, Coins, Landmark, LineChart, Receipt, Scale, ShoppingCart, Tag } from 'lucide-react'
import { Link } from 'react-router'
import type { ActivityItem } from '@/api/types'
import { Money, Quantity, RelativeDate, UnitPrice } from '@/components/format'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { useActivity } from '@/lib/queries'
import { activityEffect } from '@/lib/activity'
import { Panel } from './Panel'

const TYPE_LABELS: Record<string, string> = {
  opening_balance: 'Opening balance',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  interest: 'Interest',
  dividend: 'Dividend',
  capital_gain: 'Capital gain',
  capital_loss: 'Capital loss',
  fee: 'Fee',
  purchase: 'Purchase',
  sale: 'Sale',
  manual_adjustment: 'Adjustment',
  liability_payment: 'Loan payment',
  liability_increase: 'Loan increase',
  transfer: 'Transfer',
  valuation: 'Value updated',
  price_update: 'Price updated',
  opening_position: 'Opening position',
  buy: 'Bought',
  sell: 'Sold',
  quantity_adjustment: 'Quantity adjusted',
  transfer_in: 'Transferred in',
  transfer_out: 'Transferred out',
  split: 'Stock split',
  spinoff: 'Spin-off',
  merger_in: 'Merger in',
  merger_out: 'Merger out',
}

export function activityLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

function iconFor(item: ActivityItem) {
  if (item.kind === 'valuation') return Scale
  if (item.kind === 'price') return Tag
  if (item.kind === 'position') return item.type === 'sell' ? Coins : ShoppingCart
  switch (item.type) {
    case 'deposit':
    case 'opening_balance':
      return ArrowDownLeft
    case 'withdrawal':
      return ArrowUpRight
    case 'interest':
    case 'dividend':
      return BadgePercent
    case 'fee':
      return Receipt
    case 'transfer':
      return ArrowLeftRight
    case 'liability_payment':
    case 'liability_increase':
      return Landmark
    case 'capital_gain':
    case 'capital_loss':
      return LineChart
    default:
      return Coins
  }
}

function Amount({ item }: { item: ActivityItem }) {
  if (item.kind === 'price') return <UnitPrice value={item.unitPrice} currency={item.currency} />
  if (item.kind === 'valuation') return <Money minor={item.amountMinor} currency={item.currency} />
  return <Money minor={activityEffect(item)} currency={item.currency} sign="always" />
}

/** The six most recent changes across every account. */
export function ActivityPanel() {
  const q = useActivity({ limit: 6 })
  const items = q.data?.items ?? []
  return (
    <Panel
      title="Recent activity"
      description="The latest changes across your accounts"
      teaser={items[0] ? `Latest: ${activityLabel(items[0].type).toLowerCase()} · ${items[0].accountName}` : undefined}
      collapsible
      action={
        <Link to="/activity" className="link inline-flex min-h-9 items-center gap-1 text-sm">
          All activity <ArrowRight size={14} aria-hidden />
        </Link>
      }
    >
      {q.isPending ? (
        <div role="status" aria-label="Loading activity" className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState compact error={q.error} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <p className="rounded-md bg-sunken/60 p-4 text-sm text-muted">Nothing recorded yet. Deposits, value updates, and trades will appear here as you add them.</p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {items.map((item) => {
            const Icon = iconFor(item)
            const title = item.kind === 'position' && item.instrumentSymbol ? `${activityLabel(item.type)} ${item.instrumentSymbol}` : item.description || activityLabel(item.type)
            return (
              <li key={`${item.kind}-${item.id}-${item.accountId}`}>
                <Link to={`/accounts/${item.accountId}`} className="flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-sunken">
                  <span className={cn('grid size-8 shrink-0 place-items-center rounded-full bg-sunken text-muted')}>
                    <Icon size={15} aria-hidden strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{title}</span>
                    <span className="block truncate text-xs text-muted">
                      {item.accountName} · <RelativeDate value={item.date} />
                      {item.kind === 'position' && item.quantity ? (
                        <>
                          {' '}
                          · <Quantity value={item.quantity} /> units
                        </>
                      ) : null}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-sm text-ink">
                    <Amount item={item} />
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
