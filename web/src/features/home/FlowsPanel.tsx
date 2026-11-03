import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import type { DashboardRange } from '@/api/types'
import { Money } from '@/components/format'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useFlows } from '@/lib/queries'
import { FlowsBridge, FlowsIncomplete, rangePhrase, useIsMdUp } from '@/features/insights/common'
import { Panel } from './Panel'

/** How much was contributed versus how much came from returns, over the selected range. */
export function FlowsPanel({ range }: { range: DashboardRange }) {
  const flows = useFlows(range)
  const isMd = useIsMdUp()
  const f = flows.data
  return (
    <Panel
      title="Contributions and growth"
      description={`What you put in and what your money earned over ${rangePhrase(range)}`}
      teaser={
        f ? (
          <>
            Contributed <Money minor={f.contributionsMinor} currency={f.baseCurrency} /> · growth <Money minor={f.growthMinor} currency={f.baseCurrency} sign="always" />
          </>
        ) : undefined
      }
      collapsible
      action={
        <Link to={`/insights/income?range=${range}`} className="link inline-flex min-h-9 items-center gap-1 text-sm">
          Income and returns <ArrowRight size={14} aria-hidden />
        </Link>
      }
    >
      {flows.isPending ? (
        <div role="status" aria-label="Loading flows" className="flex flex-col gap-2.5">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 flex-1" />
            </div>
          ))}
        </div>
      ) : flows.isError || !f ? (
        <ErrorState compact error={flows.error} onRetry={() => flows.refetch()} />
      ) : (
        <>
          <FlowsBridge flows={f} compactLabels={!isMd} />
          {!f.complete ? <FlowsIncomplete /> : null}
        </>
      )}
    </Panel>
  )
}
