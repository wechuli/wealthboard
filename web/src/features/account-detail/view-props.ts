import type { UseQueryResult } from '@tanstack/react-query'
import type { AccountExtras, AccountSummaryExt } from '@/api/extensions'
import type { Account, AccountAnalytics } from '@/api/types'
import type { DetailTab } from './sections'

export interface ViewProps {
  account: Account
  summary?: AccountSummaryExt
  analytics: UseQueryResult<AccountAnalytics>
  extras: UseQueryResult<AccountExtras>
  tab: DetailTab
  valuationLed: boolean
  onEdit(): void
}
