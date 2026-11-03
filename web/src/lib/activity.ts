import type { ActivityItem } from '@/api/types'

/**
 * Signed effect of an activity item on its account (cash, for position accounts). The API sends it
 * as `effectMinor`; `amountMinor` is the recorded amount, which is unsigned for most types.
 * Valuations and price updates carry no effect.
 */
export function activityEffect(item: Pick<ActivityItem, 'amountMinor' | 'effectMinor'>): string {
  return item.effectMinor ?? item.amountMinor
}
