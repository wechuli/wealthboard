import { TZDate } from '@date-fns/tz'
import { useState } from 'react'
import type { Dashboard, DashboardRange } from '@/api/types'
import { ErrorState } from '@/components/ui/ErrorState'
import { PageHeader } from '@/components/ui/PageHeader'
import { usePrefs } from '@/lib/prefs'
import { useDashboard, useNetWorthStats } from '@/lib/queries'
import { useSession } from '@/lib/session'
import { usePageTitle } from '@/lib/usePageTitle'
import { useRangeParam } from '@/features/insights/common'
import { ActivityPanel } from './ActivityPanel'
import { AllocationPanel } from './AllocationPanel'
import { AttentionPanel } from './AttentionPanel'
import { FirstRun } from './FirstRun'
import { FlowsPanel } from './FlowsPanel'
import { GoalReminder } from './GoalReminder'
import { GoalsPanel } from './GoalsPanel'
import { HomeSkeleton } from './HomeSkeleton'
import { NetWorthHero } from './NetWorthHero'
import { QuickActions } from './QuickActions'

export default function HomePage() {
  usePageTitle('Home')
  const [range, setRange] = useRangeParam()
  const dash = useDashboard(range)

  if (!dash.data) {
    if (dash.isError)
      return (
        <div className="page">
          <PageHeader title="Home" />
          <div className="card">
            <ErrorState error={dash.error} onRetry={() => dash.refetch()} title="Your overview could not be loaded" />
          </div>
        </div>
      )
    return <HomeSkeleton />
  }
  if (dash.data.accountCount === 0) return <FirstRun />
  return <Overview dash={dash.data} range={range} onRange={setRange} updating={dash.isPlaceholderData} />
}

function useGreeting(): string {
  const { displayName, timezone } = usePrefs()
  const { user } = useSession()
  const [hour] = useState(() => new TZDate(Date.now(), timezone).getHours())
  const part = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const name = displayName.trim() || user?.username
  return name ? `${part}, ${name}` : part
}

function Overview({ dash, range, onRange, updating }: { dash: Dashboard; range: DashboardRange; onRange: (r: DashboardRange) => void; updating: boolean }) {
  const greeting = useGreeting()
  const stats = useNetWorthStats()
  const accounts = dash.accountCount
  return (
    <div className="page">
      <PageHeader
        title={greeting}
        description={
          <>
            {accounts} {accounts === 1 ? 'account' : 'accounts'}
            {dash.goalCount ? ` and ${dash.goalCount} ${dash.goalCount === 1 ? 'goal' : 'goals'}` : ''}, valued in {dash.baseCurrency}.
          </>
        }
      />

      <NetWorthHero dash={dash} range={range} onRange={onRange} highest={stats.data?.highest} updating={updating} />

      {/* Below 1024 px the two columns dissolve into one ordered stack: goals and quick actions come first. */}
      <div className="mt-4 flex flex-col gap-4 md:mt-6 md:gap-6 lg:grid lg:grid-cols-12 lg:items-start">
        <div className="contents lg:col-span-7 lg:flex lg:flex-col lg:gap-6">
          <div className="order-5 lg:order-none">
            <AllocationPanel dash={dash} />
          </div>
          <div className="order-6 lg:order-none">
            <FlowsPanel range={range} />
          </div>
          <div className="order-7 lg:order-none">
            <ActivityPanel />
          </div>
        </div>
        <div className="contents lg:col-span-5 lg:flex lg:flex-col lg:gap-6">
          <GoalReminder className="order-1 lg:order-none" />
          <div className="order-2 lg:order-none">
            <GoalsPanel />
          </div>
          <QuickActions className="order-3 md:hidden" />
          <div className="order-4 lg:order-none">
            <AttentionPanel dash={dash} />
          </div>
        </div>
      </div>
    </div>
  )
}
