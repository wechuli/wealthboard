import type { Category, ExchangeRate, Institution, Instrument, MutableTransactionType, SecurityPrice, TransactionType, UserSettings } from '../types'

/** A balance-affecting entry on an account. Amounts are positive except transfer and manual_adjustment (signed). */
export interface TxnRecord {
  id: string
  accountId: string
  type: TransactionType
  amountMinor: bigint
  date: string
  seq: number
  description?: string
  notes?: string
  externalId?: string
  transferGroupId?: string
  instrumentId?: string
  createdAt: string
}

export interface ValuationRecord {
  id: string
  accountId: string
  valueMinor: bigint
  date: string
  seq: number
  notes?: string
  createdAt: string
}

export interface PositionEventRecord {
  id: string
  accountId: string
  instrumentId: string
  type: 'opening_position' | 'buy' | 'sell' | 'quantity_adjustment'
  quantity: string
  unitPrice: string
  tradeCurrency: string
  feeMinor: bigint
  /** Signed change to account cash in account-currency minor units. */
  cashEffectMinor: bigint
  date: string
  seq: number
  description?: string
  notes?: string
  createdAt: string
}

export interface AccountRecord {
  id: string
  name: string
  description?: string
  categoryId: string
  institutionId?: string
  currency: string
  trackingMode: 'balance' | 'positions'
  isIncludedInNetWorth: boolean
  costBasisMinor?: bigint
  accountReference?: string
  notes?: string
  openedAt: string
  archivedAt?: string
}

export interface GoalRecord {
  id: string
  name: string
  description: string | null
  targetMinor: bigint
  manualCurrentMinor: bigint
  currency: string
  targetDate: string
  linkedAccountId: string | null
  icon: string
  status: 'active' | 'paused' | 'completed' | 'cancelled'
  priority: number
  assumedAnnualReturnBps: number
  plannedContributionMinor: bigint
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'annually' | 'custom'
  planStartDate: string
  planEndDate: string | null
}

export interface MilestoneRecord {
  id: string
  goalId: string
  name: string
  targetMinor: bigint
  targetDate: string | null
}

export interface MockUser {
  id: string
  username: string
}

export interface World {
  user: MockUser
  settings: UserSettings
  categories: Category[]
  institutions: Institution[]
  instruments: Instrument[]
  prices: (SecurityPrice & { instrumentId: string })[]
  rates: ExchangeRate[]
  accounts: AccountRecord[]
  transactions: TxnRecord[]
  valuations: ValuationRecord[]
  positionEvents: PositionEventRecord[]
  goals: GoalRecord[]
  milestones: MilestoneRecord[]
  dismissedAlerts: Set<string>
  /** Monotonic counter bumped on every mutation (used for memoisation). */
  version: number
  seq: number
}

export type { MutableTransactionType }
