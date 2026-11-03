import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { api } from '@/api'
import type { ActivityQuery } from '@/api/extensions'
import { useSession } from '@/lib/session'

export const PAGE_SIZE = 50

export type LedgerFilters = Omit<ActivityQuery, 'limit' | 'offset'>

/**
 * The cross-account ledger with "Load more". It pages through the same GET /activity endpoint as
 * `useActivity`, but as one infinite query keyed under the signed-in user, so that edits and
 * deletes (which invalidate the user's cache) refresh every loaded page instead of leaving stale
 * rows behind, and so the API's 100-row page limit is never exceeded.
 */
export function useActivityLedger(filters: LedgerFilters) {
  const { user } = useSession()
  return useInfiniteQuery({
    queryKey: ['u', user?.id ?? 'anonymous', 'activity', 'ledger', filters],
    queryFn: ({ pageParam }) => api.activity.list({ ...filters, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.offset + last.limit : undefined),
    enabled: !!user,
    placeholderData: keepPreviousData,
  })
}
