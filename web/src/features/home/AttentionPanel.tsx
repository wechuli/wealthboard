import { CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import type { Dashboard } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useAttention } from '@/lib/queries'
import { AttentionList } from '@/features/shell/AttentionList'
import { IncompleteTotalsNotice } from '@/features/insights/common'
import { Panel } from './Panel'

const LIMIT = 4

/** Stale prices, missing rates, and goals behind plan, each with its fix. */
export function AttentionPanel({ dash }: { dash: Dashboard }) {
  const q = useAttention()
  const [all, setAll] = useState(false)
  const items = q.data?.items ?? []
  const shown = all ? items : items.slice(0, LIMIT)
  const count = items.length
  return (
    <Panel
      title="Needs attention"
      description={count ? 'Fix these to keep totals complete and current' : 'Prices, rates, and goals'}
      teaser={count ? `${count} ${count === 1 ? 'item' : 'items'} to review` : 'Everything is current'}
      collapsible={dash.currentComplete}
      action={count ? <Badge tone="warning">{count} open</Badge> : <Badge tone="positive" icon={<CheckCircle2 size={12} aria-hidden />}>All clear</Badge>}
    >
      {!dash.currentComplete ? <IncompleteTotalsNotice missingCurrencies={dash.missingCurrencies} scope="net-worth totals" className="mb-3" /> : null}
      {q.isPending ? (
        <div role="status" aria-label="Loading" className="flex flex-col gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : q.isError ? (
        <ErrorState compact error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <AttentionList items={shown} compact />
          {count > LIMIT ? (
            <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 min-h-9 px-3 text-sm font-medium text-accent hover:underline" aria-expanded={all}>
              {all ? 'Show fewer' : `Show ${count - LIMIT} more`}
            </button>
          ) : null}
        </>
      )}
    </Panel>
  )
}
