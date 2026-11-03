import { api } from '@/api'
import type { ActivityItem } from '@/api/types'
import { DateText, Money, UnitPrice } from '@/components/format'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { Notice } from '@/components/ui/Notice'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { useApiMutation } from '@/lib/queries'
import { activityEffect } from '@/lib/activity'
import { describeActivity } from './activityMeta'

function removeActivity(item: ActivityItem): Promise<void> {
  switch (item.kind) {
    case 'transaction':
      return api.transactions.remove(item.id)
    case 'valuation':
      return api.valuations.remove(item.id)
    case 'position':
      return api.positionEvents.remove(item.id)
    case 'price':
      return api.prices.remove(item.id)
  }
}

function copyFor(item: ActivityItem): {
  title: string
  body: string
  confirm: string
  success: string
} {
  if (item.kind === 'transaction' && item.type === 'transfer')
    return {
      title: 'Delete this transfer?',
      body: 'A transfer has two legs. Both will be deleted: this entry and the matching entry in the other account. Both account values are recalculated.',
      confirm: 'Delete both legs',
      success: 'Transfer deleted from both accounts',
    }
  if (item.kind === 'transaction' && item.type === 'opening_balance')
    return {
      title: 'Delete the opening balance?',
      body: "The account's history will start from its next recorded entry. Its value and your net worth are recalculated.",
      confirm: 'Delete opening balance',
      success: 'Opening balance deleted',
    }
  if (item.kind === 'valuation')
    return {
      title: 'Delete this valuation?',
      body: "The account's value falls back to the previous valuation on or before this date, and its value history is recalculated.",
      confirm: 'Delete valuation',
      success: 'Valuation deleted',
    }
  if (item.kind === 'position')
    return {
      title: 'Delete this trade?',
      body: 'Holdings, cash, and the account value are recalculated without it.',
      confirm: 'Delete trade',
      success: 'Trade deleted',
    }
  if (item.kind === 'price')
    return {
      title: 'Delete this price?',
      body: 'Every account holding this instrument is revalued with the previous price, which may make it stale.',
      confirm: 'Delete price',
      success: 'Price deleted',
    }
  return {
    title: 'Delete this transaction?',
    body: 'The account value, your net worth, and any linked goal are recalculated without it.',
    confirm: 'Delete transaction',
    success: 'Transaction deleted',
  }
}

/** Confirms and deletes any ledger entry through the endpoint for its kind. */
export function DeleteActivityDialog({ item, open, onOpenChange }: { item: ActivityItem; open: boolean; onOpenChange(open: boolean): void }) {
  const online = useOnline()
  const copy = copyFor(item)
  const { title } = describeActivity(item)
  const mutation = useApiMutation({
    mutationFn: () => removeActivity(item),
    success: copy.success,
    onSuccess: () => onOpenChange(false),
  })

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.title}
      description={copy.body}
      confirmLabel={copy.confirm}
      onConfirm={() => mutation.mutate(undefined)}
      pending={mutation.isPending}
      confirmDisabled={!online}
    >
      <div className="rounded-md border border-line bg-sunken/60 px-3.5 py-3 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="min-w-0 font-medium text-ink">{title}</span>
          {item.kind === 'price' ? (
            <UnitPrice value={item.unitPrice} currency={item.currency} className="font-medium" />
          ) : (
            <Money minor={item.kind === 'valuation' ? item.amountMinor : activityEffect(item)} currency={item.currency} sign={item.kind === 'valuation' ? 'auto' : 'always'} className="font-medium" />
          )}
        </div>
        <p className="mt-1 text-muted">
          {item.accountName} · <DateText value={item.date} />
        </p>
      </div>
      {!online ? (
        <Notice tone="warning" title="You're offline" className="mt-3">
          {OFFLINE_REASON}
        </Notice>
      ) : null}
    </ConfirmDialog>
  )
}
