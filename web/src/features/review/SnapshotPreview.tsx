import { useMemo } from 'react'
import type { AIReviewFocus, AIReviewPeriod } from '@/api/types'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { usePrivacy } from '@/lib/privacy'
import { useAccounts, useDashboard, useGoals, useReportAllocation } from '@/lib/queries'
import { buildReviewSnapshot, SNAPSHOT_MAX_BYTES, snapshotBytes, type ReviewSharing } from './snapshot'

/** Shows the exact JSON a review would send with the current choices. Built from the same reads as the request. */
function SnapshotBody({ period, focus, sharing }: { period: AIReviewPeriod; focus: AIReviewFocus; sharing: ReviewSharing }) {
  const dashboard = useDashboard(period)
  const allocation = useReportAllocation()
  const goals = useGoals()
  const accounts = useAccounts('active')
  const queries = [dashboard, allocation, goals, accounts]
  const failed = queries.find((q) => q.isError)
  const snapshot = useMemo(
    () =>
      dashboard.data && allocation.data && goals.data && accounts.data
        ? buildReviewSnapshot({ period, focus, sharing }, { dashboard: dashboard.data, allocation: allocation.data, goals: goals.data, accounts: accounts.data })
        : null,
    [period, focus, sharing, dashboard.data, allocation.data, goals.data, accounts.data],
  )
  if (failed) return <ErrorState compact error={failed.error} onRetry={() => queries.forEach((q) => void q.refetch())} title="The snapshot could not be prepared" />
  if (!snapshot)
    return (
      <div role="status" aria-label="Preparing snapshot" className="space-y-2">
        {['w-1/3', 'w-2/3', 'w-1/2', 'w-3/4', 'w-2/5', 'w-3/5', 'w-1/2', 'w-1/4'].map((w, i) => (
          <Skeleton key={i} className={`h-4 ${w}`} />
        ))}
      </div>
    )
  const bytes = snapshotBytes(snapshot)
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        The time stamp is set again when you send. Size: <span className="num">{new Intl.NumberFormat('en-US').format(bytes)}</span> of <span className="num">25,000</span> bytes allowed.
        {bytes > SNAPSHOT_MAX_BYTES ? ' This is over the limit; the server will refuse it.' : ''}
      </p>
      <label htmlFor="review-snapshot-json" className="sr-only">
        Snapshot JSON
      </label>
      <textarea
        id="review-snapshot-json"
        readOnly
        spellCheck={false}
        value={JSON.stringify(snapshot, null, 2)}
        className="block h-[55vh] w-full resize-none rounded-md border border-line bg-sunken/60 p-3 font-mono text-xs leading-relaxed text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
      />
    </div>
  )
}

export function SnapshotPreview({ open, onOpenChange, period, focus, sharing }: { open: boolean; onOpenChange(open: boolean): void; period: AIReviewPeriod; focus: AIReviewFocus; sharing: ReviewSharing }) {
  const { hidden, setHidden } = usePrivacy()
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title="What this review sends" description="The exact snapshot, with your current period, focus, and sharing choices. Nothing else from your records is sent.">
      {!open ? null : hidden && sharing.includeExactAmounts ? (
        <div className="space-y-3 text-sm text-muted">
          <p>Values are hidden, and this snapshot includes exact amounts.</p>
          <button type="button" className="link" onClick={() => setHidden(false)}>
            Show values to preview it
          </button>
        </div>
      ) : (
        <SnapshotBody period={period} focus={focus} sharing={sharing} />
      )}
    </Dialog>
  )
}
