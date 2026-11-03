import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BadgePercent, CandlestickChart, Coins, HandCoins, Landmark, Receipt, Tag, Target, TrendingDown, TrendingUp, Wallet, type LucideIcon } from 'lucide-react'
import type { Account, MutableTransactionType } from '@/api/types'
import type { RecordAction } from './recorder'

export interface ActionMeta {
  action: RecordAction
  label: string
  /** Sheet title once chosen. */
  title: string
  description: string
  icon: LucideIcon
  group: 'Money in and out' | 'Values and prices' | 'Trades' | 'Income and costs' | 'Debt' | 'Create'
  /** Transaction type for simple cash-flow actions. */
  txnType?: MutableTransactionType
}

export const ACTIONS: ActionMeta[] = [
  { action: 'deposit', label: 'Deposit', title: 'Record a deposit', description: 'Money you added from outside', icon: ArrowDownLeft, group: 'Money in and out', txnType: 'deposit' },
  { action: 'withdrawal', label: 'Withdrawal', title: 'Record a withdrawal', description: 'Money you took out', icon: ArrowUpRight, group: 'Money in and out', txnType: 'withdrawal' },
  { action: 'transfer', label: 'Transfer', title: 'Transfer between accounts', description: 'Move money between two of your accounts', icon: ArrowLeftRight, group: 'Money in and out' },
  { action: 'valuation', label: 'Update value', title: 'Update a value', description: 'Set what an asset is worth today', icon: Landmark, group: 'Values and prices' },
  { action: 'price', label: 'Update price', title: 'Update a price', description: 'Record a unit price for a holding', icon: Tag, group: 'Values and prices' },
  { action: 'buy', label: 'Buy', title: 'Record a buy', description: 'Cash into units of an instrument', icon: TrendingUp, group: 'Trades' },
  { action: 'sell', label: 'Sell', title: 'Record a sell', description: 'Units of an instrument into cash', icon: TrendingDown, group: 'Trades' },
  { action: 'interest', label: 'Interest', title: 'Record interest', description: 'Interest paid into the account', icon: BadgePercent, group: 'Income and costs', txnType: 'interest' },
  { action: 'dividend', label: 'Dividend', title: 'Record a dividend', description: 'Dividend paid in cash', icon: Coins, group: 'Income and costs', txnType: 'dividend' },
  { action: 'fee', label: 'Fee', title: 'Record a fee', description: 'Charges taken from the account', icon: Receipt, group: 'Income and costs', txnType: 'fee' },
  { action: 'payment', label: 'Loan payment', title: 'Record a payment', description: 'Pay down what you owe', icon: HandCoins, group: 'Debt', txnType: 'liability_payment' },
  { action: 'increase', label: 'Loan increase', title: 'Record an increase', description: 'New borrowing or charges added', icon: Wallet, group: 'Debt', txnType: 'liability_increase' },
  { action: 'account', label: 'New account', title: 'Add an account', description: 'An asset, investment, or loan', icon: CandlestickChart, group: 'Create' },
  { action: 'goal', label: 'New goal', title: 'Create a goal', description: 'A target amount by a date', icon: Target, group: 'Create' },
]

export function actionMeta(action: RecordAction): ActionMeta {
  return ACTIONS.find((a) => a.action === action)!
}

/** Which accounts an action can be recorded against (only actions valid for the account's mode). */
export function accountAllows(account: Pick<Account, 'trackingMode' | 'isLiability' | 'archivedAt'>, action: RecordAction): boolean {
  if (account.archivedAt) return false
  const positions = account.trackingMode === 'positions'
  switch (action) {
    case 'payment':
    case 'increase':
      return account.isLiability
    case 'valuation':
      return !positions
    case 'buy':
    case 'sell':
    case 'price':
      return positions
    case 'deposit':
    case 'withdrawal':
    case 'interest':
    case 'fee':
    case 'transfer':
      return !account.isLiability
    case 'dividend':
      return !account.isLiability
    default:
      return true
  }
}
