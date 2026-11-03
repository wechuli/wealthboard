import type { Account, PositionMovementAttribution } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { DateText, Money } from '@/components/format'

const ROWS: { key: keyof PositionMovementAttribution; label: string; hint: string }[] = [
  { key: 'externalCashMinor', label: 'Cash in and out', hint: 'Deposits, withdrawals, and transfers' },
  { key: 'incomeMinor', label: 'Income', hint: 'Interest and dividends' },
  { key: 'feesMinor', label: 'Fees', hint: 'Account and trading costs' },
  { key: 'cashAdjustmentsMinor', label: 'Cash adjustments', hint: 'Corrections to recorded cash' },
  { key: 'internalTradeCashMinor', label: 'Trade cash', hint: 'Cash spent or received on trades' },
  { key: 'quantityMovementMinor', label: 'Quantity changes', hint: 'Units bought, sold, or adjusted' },
  { key: 'priceMovementMinor', label: 'Price movement', hint: 'Unit prices rising or falling' },
  { key: 'currencyMovementMinor', label: 'Currency movement', hint: 'Exchange-rate changes' },
  { key: 'unattributedMinor', label: 'Unattributed', hint: 'What the recorded data can’t explain' },
]

/** Exact server-computed bridge from the first recorded value to today, for position accounts. */
export function MovementAttributionCard({ account, attribution }: { account: Account; attribution: PositionMovementAttribution }) {
  return (
    <Card aria-labelledby="attribution-heading">
      <CardHeader
        id="attribution-heading"
        title="What moved the value"
        description={
          <>
            From <DateText value={attribution.from} /> to <DateText value={attribution.to} />, built from recorded cash, quantities, prices, and rates.
          </>
        }
        action={<Badge tone={attribution.complete ? 'positive' : 'warning'}>{attribution.complete ? 'Complete' : 'Incomplete'}</Badge>}
      />
      <CardBody className="pt-2">
        <dl className="text-sm">
          <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
            <dt className="font-medium text-ink">Start value</dt>
            <dd>
              <Money minor={attribution.startValueMinor} currency={account.currency} className="font-medium" />
            </dd>
          </div>
          {ROWS.map((row) => {
            const value = attribution[row.key] as string
            if (row.key === 'unattributedMinor' && value === '0') return null
            return (
              <div key={row.key} className="flex items-baseline justify-between gap-3 border-b border-line/70 py-2">
                <dt className="min-w-0">
                  <span className="block text-ink">{row.label}</span>
                  <span className="block text-xs text-muted">{row.hint}</span>
                </dt>
                <dd className="shrink-0">
                  <Money minor={value} currency={account.currency} sign="always" />
                </dd>
              </div>
            )
          })}
          <div className="flex items-baseline justify-between gap-3 pt-2">
            <dt className="font-medium text-ink">Value today</dt>
            <dd>
              <Money minor={attribution.endValueMinor} currency={account.currency} className="font-medium" />
            </dd>
          </div>
        </dl>
        {!attribution.complete ? <p className="mt-3 text-xs text-warning">A historical price or exchange rate is missing, so part of the movement can’t be attributed exactly.</p> : null}
      </CardBody>
    </Card>
  )
}
