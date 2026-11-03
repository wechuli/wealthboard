import { AlertTriangle, Info, Layers } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { AccountComparisonRow } from '@/api/extensions'
import { Bps, DateText, Money, Unavailable } from '@/components/format'
import { Badge } from '@/components/ui/Badge'
import { ErrorState } from '@/components/ui/ErrorState'
import { Segmented } from '@/components/ui/Segmented'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import { useAccountComparison } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { EmptyPortfolio, InsightsSkeleton, SectionTitle, useParamChoice } from './common'

type Period = '3m' | '1y' | 'all'
const PERIODS: { value: Period; label: string; ariaLabel: string }[] = [
  { value: '3m', label: '3M', ariaLabel: 'Three months' },
  { value: '1y', label: '1Y', ariaLabel: 'One year' },
  { value: 'all', label: 'All', ariaLabel: 'All time' },
]

const EXPLAIN = {
  short_period: 'This account has less than 90 days of history in the period. Annualizing a short period can exaggerate the result.',
  methodology_unavailable: 'Position-tracked accounts need a time-weighted method that accounts for each trade and price. It is not available yet, so no number is shown.',
  not_applicable: 'Liabilities do not earn a return. A falling balance means the debt is being paid down.',
  incomplete: 'The start or end value is missing an exchange rate or price, so a return cannot be calculated.',
} as const

export default function ComparePage() {
  usePageTitle('Compare accounts')
  const [period, setPeriod] = useParamChoice<Period>('period', ['3m', '1y', 'all'], '1y')
  const q = useAccountComparison(period)

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Segmented label="Period" value={period} onChange={setPeriod} options={PERIODS} />
      {q.data ? (
        <p className="text-sm text-muted">
          <DateText value={q.data.from} /> to <DateText value={q.data.to} />
          {q.isPlaceholderData ? <span className="ml-2 text-subtle">Updating…</span> : null}
        </p>
      ) : null}
    </div>
  )

  if (q.isPending)
    return (
      <div className="flex flex-col gap-6">
        {toolbar}
        <InsightsSkeleton charts={1} stats={false} />
      </div>
    )
  if (q.isError)
    return (
      <div className="flex flex-col gap-6">
        {toolbar}
        <div className="card">
          <ErrorState error={q.error} onRetry={() => q.refetch()} title="Account comparison could not be loaded" />
        </div>
      </div>
    )
  if (q.data.rows.length === 0) return <EmptyPortfolio what="Account comparisons" />

  const rows = [...q.data.rows.filter((r) => !r.isLiability), ...q.data.rows.filter((r) => r.isLiability)]
  return (
    <div className="flex flex-col gap-6">
      {toolbar}
      <section aria-labelledby="cmp-title">
        <SectionTitle id="cmp-title" title="Accounts side by side" description="Balances in each account's own currency. Deposits and withdrawals include transfers between your accounts." />
        <CompareTable rows={rows} />
        <ul className="grid gap-3 md:grid-cols-2 xl:hidden" aria-label="Accounts side by side">
          {rows.map((r) => (
            <CompareCard key={r.accountId} row={r} />
          ))}
        </ul>
      </section>
      <Methodology />
    </div>
  )
}

function ReturnCell({ row, align = 'end' }: { row: AccountComparisonRow; align?: 'start' | 'end' }) {
  const box = cn('flex flex-col gap-1', align === 'end' ? 'items-end' : 'items-start')
  switch (row.returnStatus) {
    case 'ok':
      return <Bps value={row.annualizedReturnBps} sign="always" className="font-semibold text-ink" />
    case 'short_period':
      return (
        <span className={box}>
          {row.annualizedReturnBps !== null ? <Bps value={row.annualizedReturnBps} sign="always" className="font-semibold text-ink" /> : <span className="text-subtle">—</span>}
          <Tooltip content={EXPLAIN.short_period}>
            <button type="button" className="cursor-help rounded-full" aria-label={`Short period, under 90 days. ${EXPLAIN.short_period}`}>
              <Badge tone="warning" icon={<AlertTriangle size={12} aria-hidden />}>
                Short period — under 90 days
              </Badge>
            </button>
          </Tooltip>
        </span>
      )
    case 'methodology_unavailable':
      return (
        <span className={box}>
          <Tooltip content={EXPLAIN.methodology_unavailable}>
            <button type="button" className="inline-flex cursor-help items-center gap-1.5 rounded-sm text-sm text-muted" aria-label={`Return methodology unavailable. ${EXPLAIN.methodology_unavailable}`}>
              <Layers size={14} aria-hidden className="shrink-0" />
              <span className="text-left">Return methodology unavailable</span>
              <Info size={13} aria-hidden className="shrink-0 text-subtle" />
            </button>
          </Tooltip>
        </span>
      )
    case 'not_applicable':
      return (
        <Tooltip content={EXPLAIN.not_applicable}>
          <button type="button" className="cursor-help rounded-sm text-sm text-subtle" aria-label={`Not applicable. ${EXPLAIN.not_applicable}`}>
            Not applicable
          </button>
        </Tooltip>
      )
    default:
      return <Unavailable label="Unavailable" reason={EXPLAIN.incomplete} />
  }
}

function MoneyCell({ minor, currency }: { minor: string | null; currency: string }) {
  return <Money minor={minor} currency={currency} hideCode unavailable={<Unavailable reason={EXPLAIN.incomplete} />} />
}

function AccountName({ row }: { row: AccountComparisonRow }) {
  return (
    <span className="flex min-w-0 flex-col">
      <Link to={`/accounts/${row.accountId}`} className="truncate font-medium text-ink hover:underline">
        {row.name}
      </Link>
      <span className="text-xs text-muted">
        {row.currency} · {row.isLiability ? 'Liability' : row.trackingMode === 'positions' ? 'Tracked by position' : 'Tracked by value'}
      </span>
    </span>
  )
}

function CompareTable({ rows }: { rows: AccountComparisonRow[] }) {
  const firstLiability = rows.findIndex((r) => r.isLiability)
  return (
    <div className="card hidden overflow-hidden xl:block">
      <div className="scroll-x">
        <table className="w-full text-sm">
          <caption className="sr-only">Account comparison: balances, flows, and simple annualized return</caption>
          <thead className="border-b border-line bg-sunken/60 text-xs text-muted">
            <tr>
              <th scope="col" className="px-5 py-2.5 text-left font-medium">
                Account
              </th>
              {['Start balance', 'End balance', 'Deposits', 'Withdrawals', 'Net income'].map((h) => (
                <th key={h} scope="col" className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
              <th scope="col" className="px-5 py-2.5 text-right font-medium whitespace-nowrap">
                Annualized return
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.accountId} className={cn('border-b border-line last:border-b-0 hover:bg-sunken/40', i === firstLiability && i > 0 && 'border-t-2 border-t-line')}>
                <th scope="row" className="max-w-[16rem] px-5 py-3 text-left font-normal">
                  <AccountName row={r} />
                </th>
                <td className="px-3 py-3 text-right text-muted">
                  <MoneyCell minor={r.startMinor} currency={r.currency} />
                </td>
                <td className="px-3 py-3 text-right font-medium text-ink">
                  <MoneyCell minor={r.endMinor} currency={r.currency} />
                </td>
                <td className="px-3 py-3 text-right">
                  <MoneyCell minor={r.depositsMinor} currency={r.currency} />
                </td>
                <td className="px-3 py-3 text-right">
                  <MoneyCell minor={r.withdrawalsMinor} currency={r.currency} />
                </td>
                <td className="px-3 py-3 text-right">
                  <Money minor={r.netIncomeMinor} currency={r.currency} hideCode sign="always" />
                </td>
                <td className="w-56 px-5 py-3 text-right">
                  <ReturnCell row={r} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-5 py-2.5 text-xs text-subtle">Amounts are in each account's currency, shown next to its name.</p>
    </div>
  )
}

function CompareCard({ row }: { row: AccountComparisonRow }) {
  const facts: { label: string; value: ReactNode }[] = [
    { label: 'Start balance', value: <Money minor={row.startMinor} currency={row.currency} unavailable={<Unavailable reason={EXPLAIN.incomplete} />} /> },
    { label: 'End balance', value: <Money minor={row.endMinor} currency={row.currency} unavailable={<Unavailable reason={EXPLAIN.incomplete} />} /> },
    { label: 'Deposits', value: <Money minor={row.depositsMinor} currency={row.currency} /> },
    { label: 'Withdrawals', value: <Money minor={row.withdrawalsMinor} currency={row.currency} /> },
    { label: 'Net income', value: <Money minor={row.netIncomeMinor} currency={row.currency} sign="always" /> },
  ]
  return (
    <li className="card min-w-0 p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <AccountName row={row} />
      </div>
      <div className="mt-3 rounded-md bg-sunken/60 px-3 py-2.5">
        <p className="text-xs text-muted">Simple annualized return</p>
        <div className="mt-1 text-md">
          <ReturnCell row={row} align="start" />
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-xs text-muted">{f.label}</dt>
            <dd className="truncate text-ink">{f.value}</dd>
          </div>
        ))}
      </dl>
    </li>
  )
}

function Methodology() {
  return (
    <section aria-labelledby="cmp-method" className="max-w-[72ch] text-sm text-muted">
      <h2 id="cmp-method" className="text-md font-semibold text-ink">
        How the return is calculated
      </h2>
      <p className="mt-1.5">
        The simple annualized return compares the gain over the period (the change in balance after deposits and withdrawals) with the average capital in the
        account, then scales it to a year. It does not account for exactly when money moved, so treat it as a guide rather than a precise rate.
      </p>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
        <li>Periods under 90 days are flagged, because annualizing them can exaggerate the result.</li>
        <li>Position-tracked accounts show no number: they need a time-weighted method that is not available yet.</li>
        <li>Liabilities have no return. Values with a missing rate or price are marked unavailable rather than counted as zero.</li>
      </ul>
    </section>
  )
}
