import { Landmark } from 'lucide-react'
import { Money, Delta, DateText } from '@/components/format'
import { TOKENS } from '@/components/charts/utils'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useRecorder } from '@/features/recording/recorder'
import { minorSign } from '@/lib/money'
import { useAccountValuations } from '@/lib/queries'
import { ActivityFeed, CompletenessNotice, FlowLedger, LedgerRow, LinkedGoalsCard, NotesCard, TabSection, ValuationHistory, ValueHero } from './sections'
import { ValueHistoryChart } from './ValueHistoryChart'
import type { ViewProps } from './view-props'

/** Value-tracked asset: leads with value history and flows. Land and vehicles lead with valuations and change since purchase. */
export function ValueView({ account, summary, analytics, extras, tab, valuationLed, onEdit }: ViewProps) {
  const recorder = useRecorder()
  const valuations = useAccountValuations(account.id, { limit: 100 })
  const markers = (valuations.data?.items ?? []).map((v) => ({ date: v.valuationDate, kind: 'valuation' as const, label: v.notes ? `Valuation · ${v.notes}` : 'Valuation' }))
  const updateValue = () => recorder.open({ action: 'valuation', accountId: account.id })
  const a = analytics.data
  const m = a?.metrics
  const c = account.currency

  const valuationsCard = (
    <TabSection tab="valuations" current={tab}>
      <ValuationHistory account={account} onAdd={updateValue} addDisabled={!!account.archivedAt} />
    </TabSection>
  )

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <TabSection tab="overview" current={tab} className="space-y-5">
          <CompletenessNotice account={account} analytics={a} summary={summary} />
          <Card aria-label={`${account.name} value`}>
            <ValueHero account={account} summary={summary} label={valuationLed ? 'Estimated value' : 'Current value'} />
            <CardBody className="pt-6">
              {analytics.isPending ? (
                <Skeleton className="h-[260px]" />
              ) : analytics.isError ? (
                <ErrorState compact error={analytics.error} onRetry={() => void analytics.refetch()} />
              ) : (
                <ValueHistoryChart account={account} history={analytics.data.history} historyComplete={analytics.data.historyComplete} markers={markers} color={TOKENS.accent} label="Value history" />
              )}
            </CardBody>
          </Card>
        </TabSection>
        {valuationLed ? valuationsCard : null}
        <TabSection tab="activity" current={tab}>
          <ActivityFeed
            account={account}
            title="Activity"
            description="Transactions and valuations, newest first."
            emptyTitle="No activity yet"
            emptyBody="Deposits, withdrawals, interest, fees, and valuations recorded for this account appear here."
          />
        </TabSection>
        {valuationLed ? null : valuationsCard}
      </div>

      <aside className="min-w-0 space-y-5" aria-label="Account summary">
        <TabSection tab="overview" current={tab} className="space-y-5">
          <Card aria-labelledby="flows-heading">
            <CardHeader
              id="flows-heading"
              title={valuationLed ? 'Since purchase' : 'Flows since opening'}
              description={account.openedAt ? <>From <DateText value={account.openedAt} /></> : undefined}
            />
            <CardBody className="pt-2">
              {analytics.isPending ? (
                <div className="space-y-3">
                  <Skeleton className="h-8 w-40" />
                  <Skeleton className="h-28" />
                </div>
              ) : analytics.isError || !m ? (
                <ErrorState compact error={analytics.error} onRetry={() => void analytics.refetch()} />
              ) : valuationLed ? (
                <>
                  <p className="text-xl">
                    <Delta minor={m.capitalGrowthMinor} currency={c} className="font-semibold" />
                  </p>
                  <p className="mt-1 text-sm text-muted">Change in value after what you paid and anything added or taken out. Valuations set the value; they are never counted as contributions.</p>
                  <dl className="mt-3 divide-y divide-line border-t border-line">
                    <LedgerRow label="Purchase price and additions">
                      <Money minor={m.contributionsMinor} currency={c} />
                    </LedgerRow>
                    {minorSign(m.withdrawalsMinor) !== 0 ? (
                      <LedgerRow label="Taken out">
                        <Money minor={m.withdrawalsMinor} currency={c} />
                      </LedgerRow>
                    ) : null}
                    {minorSign(m.incomeMinor) !== 0 ? (
                      <LedgerRow label="Income" hint="Rent or other income recorded here">
                        <Money minor={m.incomeMinor} currency={c} />
                      </LedgerRow>
                    ) : null}
                    {minorSign(m.feesMinor) !== 0 ? (
                      <LedgerRow label="Costs and fees">
                        <Money minor={m.feesMinor} currency={c} />
                      </LedgerRow>
                    ) : null}
                    <LedgerRow strong label="Value today">
                      <Money minor={account.currentValueMinor} currency={c} />
                    </LedgerRow>
                  </dl>
                </>
              ) : (
                <FlowLedger account={account} analytics={a!} showGain />
              )}
            </CardBody>
          </Card>
          {valuationLed ? (
            <div className="flex gap-3 rounded-lg border border-line bg-sunken/50 px-4 py-3.5 text-sm text-muted">
              <Landmark size={18} aria-hidden className="mt-0.5 shrink-0 text-subtle" />
              <p>Without a market price, this value is only as current as your last valuation. Update it after an appraisal, a quote, or a comparable sale.</p>
            </div>
          ) : null}
          <LinkedGoalsCard goals={extras.data?.linkedGoals ?? (extras.isError ? [] : undefined)} />
        </TabSection>
        <TabSection tab="notes" current={tab}>
          <NotesCard account={account} onEdit={onEdit} />
        </TabSection>
      </aside>
    </div>
  )
}
