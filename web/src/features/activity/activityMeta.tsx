import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  CircleMinus,
  CirclePlus,
  Coins,
  CreditCard,
  Flag,
  GitFork,
  HandCoins,
  Merge,
  Percent as PercentIcon,
  Receipt,
  Scale,
  ShoppingBag,
  SlidersHorizontal,
  Split,
  Store,
  Tag,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { ActivityItem, MutableTransactionType } from '@/api/types'
import { Quantity, UnitPrice } from '@/components/format'
import { cn } from '@/lib/cn'
import { activityEffect } from '@/lib/activity'
import { formatDecimal } from '@/lib/money'

export type ActivityKind = ActivityItem['kind']

export const KIND_LABELS: Record<ActivityKind, { label: string; short: string }> = {
  transaction: { label: 'Transactions', short: 'Cash' },
  valuation: { label: 'Valuations', short: 'Values' },
  position: { label: 'Trades', short: 'Trades' },
  price: { label: 'Price updates', short: 'Prices' },
}

export const KINDS: ActivityKind[] = ['transaction', 'valuation', 'position', 'price']

export function isKind(value: string | null): value is ActivityKind {
  return value !== null && (KINDS as string[]).includes(value)
}

/** Human labels for every activity type the ledger can show. */
export const TYPE_LABELS: Record<string, string> = {
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
  liability_payment: 'Liability payment',
  liability_increase: 'Liability increase',
  transfer: 'Transfer',
  valuation: 'Valuation',
  opening_position: 'Opening position',
  buy: 'Buy',
  sell: 'Sell',
  quantity_adjustment: 'Quantity adjustment',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  split: 'Stock split',
  spinoff: 'Spin-off',
  merger_in: 'Merger (received)',
  merger_out: 'Merger (surrendered)',
  price_update: 'Price update',
}

export const TYPES_BY_KIND: Record<ActivityKind, string[]> = {
  transaction: [
    'deposit',
    'withdrawal',
    'interest',
    'dividend',
    'fee',
    'transfer',
    'liability_payment',
    'liability_increase',
    'opening_balance',
    'capital_gain',
    'capital_loss',
    'purchase',
    'sale',
    'manual_adjustment',
  ],
  valuation: ['valuation'],
  position: ['buy', 'sell', 'opening_position', 'quantity_adjustment', 'transfer_in', 'transfer_out', 'split', 'spinoff', 'merger_in', 'merger_out'],
  price: ['price_update'],
}

export function kindOfType(type: string): ActivityKind | undefined {
  return KINDS.find((k) => TYPES_BY_KIND[k].includes(type))
}

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

/** Transaction types the API lets you edit (transfers and opening balances are structural). */
export const MUTABLE_TYPES: MutableTransactionType[] = [
  'deposit',
  'withdrawal',
  'interest',
  'dividend',
  'fee',
  'liability_payment',
  'liability_increase',
  'capital_gain',
  'capital_loss',
  'purchase',
  'sale',
  'manual_adjustment',
]

export function isMutableType(type: string): type is MutableTransactionType {
  return (MUTABLE_TYPES as string[]).includes(type)
}

export function isEditable(item: ActivityItem): boolean {
  return item.kind === 'transaction' && isMutableType(item.type)
}

type Tone = 'neutral' | 'income' | 'trade' | 'value' | 'debt'

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-sunken text-muted',
  income: 'bg-positive-soft text-positive',
  trade: 'bg-accent-soft text-accent',
  value: 'bg-info-soft text-info',
  debt: 'bg-negative-soft text-negative',
}

const ICONS: Record<string, { icon: LucideIcon; tone: Tone }> = {
  opening_balance: { icon: Flag, tone: 'neutral' },
  deposit: { icon: ArrowDownToLine, tone: 'neutral' },
  withdrawal: { icon: ArrowUpFromLine, tone: 'neutral' },
  interest: { icon: PercentIcon, tone: 'income' },
  dividend: { icon: Coins, tone: 'income' },
  capital_gain: { icon: TrendingUp, tone: 'income' },
  capital_loss: { icon: TrendingDown, tone: 'neutral' },
  fee: { icon: Receipt, tone: 'neutral' },
  purchase: { icon: ShoppingBag, tone: 'trade' },
  sale: { icon: Store, tone: 'trade' },
  manual_adjustment: { icon: SlidersHorizontal, tone: 'neutral' },
  liability_payment: { icon: HandCoins, tone: 'debt' },
  liability_increase: { icon: CreditCard, tone: 'debt' },
  transfer: { icon: ArrowLeftRight, tone: 'neutral' },
  valuation: { icon: Scale, tone: 'value' },
  opening_position: { icon: Flag, tone: 'trade' },
  buy: { icon: CirclePlus, tone: 'trade' },
  sell: { icon: CircleMinus, tone: 'trade' },
  quantity_adjustment: { icon: SlidersHorizontal, tone: 'trade' },
  transfer_in: { icon: ArrowDownToLine, tone: 'trade' },
  transfer_out: { icon: ArrowUpFromLine, tone: 'trade' },
  split: { icon: Split, tone: 'trade' },
  spinoff: { icon: GitFork, tone: 'trade' },
  merger_in: { icon: Merge, tone: 'trade' },
  merger_out: { icon: Merge, tone: 'trade' },
  price_update: { icon: Tag, tone: 'neutral' },
}

export function ActivityIcon({ type, className }: { type: string; className?: string }) {
  const meta = ICONS[type] ?? {
    icon: SlidersHorizontal,
    tone: 'neutral' as Tone,
  }
  const Icon = meta.icon
  return (
    <span className={cn('grid size-9 shrink-0 place-items-center rounded-md', TONE_CLASS[meta.tone], className)} aria-hidden>
      <Icon size={17} strokeWidth={1.75} />
    </span>
  )
}

function instrumentLabel(item: ActivityItem): string {
  return item.instrumentSymbol || item.instrumentName || 'units'
}

const TRADE_VERBS: Record<string, string> = {
  buy: 'Bought',
  sell: 'Sold',
  opening_position: 'Opening position',
  transfer_in: 'Transferred in',
  transfer_out: 'Transferred out',
  quantity_adjustment: 'Adjusted',
  merger_in: 'Received',
  merger_out: 'Surrendered',
}

function absDecimal(value: string): string {
  return value.startsWith('-') ? value.slice(1) : value
}

/**
 * The row title as rich content plus a plain-text version for accessible names.
 * Trades read like a contract note: "Bought 10 VWRA @ USD 100.00".
 */
export function describeActivity(item: ActivityItem): {
  title: ReactNode
  plain: string
} {
  if (item.kind === 'valuation') return { title: 'Valued at', plain: `Valuation of ${item.accountName}` }
  if (item.kind === 'price') {
    const sym = instrumentLabel(item)
    return { title: `${sym} price update`, plain: `${sym} price update` }
  }
  if (item.kind === 'position') {
    const sym = instrumentLabel(item)
    const verb = TRADE_VERBS[item.type]
    if (verb && item.quantity) {
      const qty = absDecimal(item.quantity)
      const plainQty = formatDecimal(qty, { maxFraction: 6 })
      const hasPrice = !!item.unitPrice && item.type !== 'quantity_adjustment'
      return {
        title: (
          <>
            {verb} <Quantity value={qty} /> {sym}
            {hasPrice ? (
              <>
                {' '}
                <span className="text-subtle">@</span> <UnitPrice value={item.unitPrice} currency={item.currency} />
              </>
            ) : null}
          </>
        ),
        plain: `${verb} ${plainQty} ${sym}`,
      }
    }
    return {
      title: `${typeLabel(item.type)} · ${sym}`,
      plain: `${typeLabel(item.type)} ${sym}`,
    }
  }
  if (item.type === 'transfer') {
    const out = activityEffect(item).startsWith('-')
    const label = out ? 'Transfer out' : 'Transfer in'
    return { title: label, plain: label }
  }
  if ((item.type === 'dividend' || item.type === 'purchase' || item.type === 'sale') && (item.instrumentSymbol || item.instrumentName)) {
    const label = `${typeLabel(item.type)} · ${instrumentLabel(item)}`
    return { title: label, plain: label }
  }
  return { title: typeLabel(item.type), plain: typeLabel(item.type) }
}
