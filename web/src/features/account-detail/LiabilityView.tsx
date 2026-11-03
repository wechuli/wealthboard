import { HandCoins } from 'lucide-react'
import { DateText, Money } from '@/components/format'
import { TOKENS } from '@/components/charts/utils'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useRecorder } from '@/features/recording/recorder'
import { minorSign } from '@/lib/money'
import { ActivityFeed, CompletenessNotice, LedgerRow, NotesCard, TabSection, ValueHero, LinkedGoalsCard } from './sections'
import { ValueHistoryChart } from './ValueHistoryChart'
import type { ViewProps } from './view-props'

/** Liability: outstanding balance, payments made, and a paydown line. No returns. */
export function LiabilityView({ account, summary, analytics, extras, tab, onEdit }: ViewProps) {
  const recorder = useRecorder()
  const a = analytics.data
  const m = a?.metrics
  const c = account.currency
  const goals = extras.data?.linkedGoals ?? []

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <TabSection tab="overview" current={tab} className="space-y-5">
          <CompletenessNotice account={account} analytics={a} summary={summary} />
          <Card aria-label={`${account.name} balance`}>
            <ValueHero account={account} summary={summary} label="Outstanding balance · you owe" />
            <CardBody className="pt-6">
              {analytics.isPending ? (
                <Skeleton className="h-[240px]" />
              ) : analytics.isError ? (
                <ErrorState compact error={analytics.error} onRetry={() => void analytics.refetch()} />
              ) : (
                <ValueHistoryChart account={account} history={analytics.data.history} historyComplete={analytics.data.historyComplete} color={TOKENS.negative} height={240} label="Balance paydown" />
              )}
              <p className="mt-3 text-xs text-muted">A falling line is progress: each payment lowers what you owe and raises your net worth.</p>
            </CardBody>
          </Card>
        </TabSection>
        <TabSection tab="activity" current={tab}>
          <ActivityFeed
            account={account}
            title="Payment history"
            description="Payments and anything added to the balance, newest first."
            emptyTitle="No payments recorded"
            emptyBody="Record each instalment to watch the balance come down. Financed charges, such as an insurance premium, go in as increases."
            emptyAction={
              !account.archivedAt ? (
                <Button variant="primary" icon={<HandCoins size={16} aria-hidden />} onClick={() => recorder.open({ action: 'payment', accountId: account.id })}>
                  Record payment
                </Button>
              ) : undefined
            }
          />
        </TabSection>
      </div>

      <aside className="min-w-0 space-y-5" aria-label="Loan summary">
        <TabSection tab="overview" current={tab} className="space-y-5">
          <Card aria-labelledby="paydown-heading">
            <CardHeader id="paydown-heading" title="Paydown" description={account.openedAt ? <>Since <DateText value={account.openedAt} /></> : undefined} />
            <CardBody className="pt-2">
              {analytics.isPending ? (
                <Skeleton className="h-36" />
              ) : analytics.isError || !m ? (
                <ErrorState compact error={analytics.error} onRetry={() => void analytics.refetch()} />
              ) : (
                <dl className="divide-y divide-line">
                  <LedgerRow label="Borrowed and added" hint="The opening balance plus any increases">
                    <Money minor={m.contributionsMinor} currency={c} />
                  </LedgerRow>
                  <LedgerRow label="Payments made" hint="Everything paid towards the balance">
                    <Money minor={m.withdrawalsMinor} currency={c} className="text-positive" />
                  </LedgerRow>
                  {minorSign(m.feesMinor) !== 0 ? (
                    <LedgerRow label="Fees">
                      <Money minor={m.feesMinor} currency={c} />
                    </LedgerRow>
                  ) : null}
                  <LedgerRow strong label="Still owed">
                    <Money minor={account.currentValueMinor} currency={c} className="text-negative" />
                  </LedgerRow>
                </dl>
              )}
              <p className="mt-3 text-xs text-muted">Returns don't apply to what you owe. Record lender interest as an increase so the balance matches your statement.</p>
            </CardBody>
          </Card>
          {goals.length ? <LinkedGoalsCard goals={goals} /> : null}
        </TabSection>
        <TabSection tab="notes" current={tab}>
          <NotesCard account={account} onEdit={onEdit} />
        </TabSection>
      </aside>
    </div>
  )
}
