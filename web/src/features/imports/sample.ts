/** Builds downloadable sample files for the direct account-history import, in the account's currency. */
import { format, subDays } from 'date-fns'
import type { Account } from '@/api/types'
import { parseDateOnly } from '@/lib/dates'
import { decimalToMinor, minorToDecimal } from '@/lib/money'

/** The exact header the server requires, in this order (see internal/service/account_history_import.go). */
export const CSV_HEADER = 'external_id,type,amount,date,description,notes'

interface SampleRow {
  type: string
  amount: string
  date: string
  description: string
  external_id: string
  notes: string
}

function rows(account: Account, today: string): SampleRow[] {
  const t = parseDateOnly(today)
  const d = (days: number) => format(subDays(t, days), 'yyyy-MM-dd')
  const amt = (major: string) => minorToDecimal(decimalToMinor(major, account.currency), account.currency)
  const plan: [string, string, number, string][] = account.isLiability
    ? [
        ['liability_payment', '20000', 88, 'Loan instalment'],
        ['liability_payment', '20000', 58, 'Loan instalment'],
        ['liability_increase', '15000', 40, 'Insurance premium financed'],
        ['liability_payment', '20000', 28, 'Loan instalment'],
      ]
    : [
        ['deposit', '25000', 88, 'Monthly top-up'],
        ['interest', '1840.50', 61, 'Interest for the month'],
        ['deposit', '25000', 58, 'Monthly top-up'],
        ['withdrawal', '12000', 45, 'School shoes'],
        ['fee', '150', 31, 'Account fee'],
      ]
  return plan.map(([type, major, days, description], i) => ({ type, amount: amt(major), date: d(days), description, external_id: `SAMPLE-${String(i + 1).padStart(3, '0')}`, notes: '' }))
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

export function sampleCsv(account: Account, today: string): string {
  return [CSV_HEADER, ...rows(account, today).map((r) => [r.external_id, r.type, r.amount, r.date, r.description, r.notes].map(csvCell).join(','))].join('\n') + '\n'
}

export function sampleJson(account: Account, today: string): string {
  return JSON.stringify({ format: 'wealthboard-account-history', version: 1, transactions: rows(account, today).map(({ notes, ...r }) => (notes ? { ...r, notes } : r)) }, null, 2) + '\n'
}

export function downloadText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const IMPORT_TYPES: { type: string; label: string; liability?: boolean }[] = [
  { type: 'deposit', label: 'Money in' },
  { type: 'withdrawal', label: 'Money out' },
  { type: 'interest', label: 'Interest' },
  { type: 'dividend', label: 'Dividend' },
  { type: 'fee', label: 'Fee' },
  { type: 'capital_gain', label: 'Capital gain' },
  { type: 'capital_loss', label: 'Capital loss' },
  { type: 'purchase', label: 'Purchase' },
  { type: 'sale', label: 'Sale' },
  { type: 'manual_adjustment', label: 'Adjustment' },
  { type: 'liability_payment', label: 'Loan payment', liability: true },
  { type: 'liability_increase', label: 'Loan increase', liability: true },
]

// ---- Investment History v1 (position-tracked accounts) ------------------------------

export const INVESTMENT_CSV_HEADERS = {
  holdings: 'instrument_external_id,event_external_id,price_external_id,instrument_name,symbol,identifier_type,identifier,exchange_mic,asset_type,quote_currency,quantity,unit_price,price_date,opening_cost_basis,notes',
  trades: 'external_id,instrument_external_id,type,quantity,unit_price,trade_currency,fee_amount,fee_currency,cash_effect,applied_exchange_rate,trade_date,settlement_date,description,notes',
  cash: 'external_id,type,amount,date,description,notes',
  prices: 'external_id,instrument_external_id,price,effective_date,source,provenance',
} as const

export type InvestmentTemplate = keyof typeof INVESTMENT_CSV_HEADERS

function investmentPlan(account: Account, today: string) {
  const t = parseDateOnly(today)
  const d = (days: number) => format(subDays(t, days), 'yyyy-MM-dd')
  const money = (major: string) => minorToDecimal(decimalToMinor(major, account.currency), account.currency)
  const c = account.currency
  const equity = { external_id: 'sample:instrument:equity-fund', name: 'Sample Equity Fund', symbol: 'SEQF', identifier_type: 'custom', identifier: 'SEQF', exchange_mic: null, asset_type: 'etf', quote_currency: c }
  const bond = { external_id: 'sample:instrument:bond-fund', name: 'Sample Bond Fund', symbol: 'SBDF', identifier_type: 'custom', identifier: 'SBDF', exchange_mic: null, asset_type: 'fund', quote_currency: c }
  return { d, money, c, equity, bond }
}

const nullEvent = { unit_price: null, fee_amount: null, fee_currency: null, cash_effect: null, applied_exchange_rate: null, opening_cost_basis: null, event_group_id: null, settlement_date: null, description: null, notes: null }

/** A complete, fictional `wealthboard-investment-history` v1 envelope in the account's currency. */
export function sampleInvestmentJson(account: Account, today: string): string {
  const { d, money, c, equity, bond } = investmentPlan(account, today)
  const group = 'sample:group:dividend-reinvestment:1'
  const envelope = {
    format: 'wealthboard-investment-history',
    version: 1,
    instruments: [equity, bond],
    position_events: [
      { ...nullEvent, external_id: 'sample:event:opening:equity', instrument_external_id: equity.external_id, type: 'opening_position', quantity: '120', trade_currency: c, opening_cost_basis: money('2400'), trade_date: d(120), description: 'Opening holding' },
      { ...nullEvent, external_id: 'sample:event:buy:bond:1', instrument_external_id: bond.external_id, type: 'buy', quantity: '40', unit_price: '12.50', trade_currency: c, fee_amount: money('5'), fee_currency: c, trade_date: d(90), settlement_date: d(88), description: 'Monthly buy' },
      { ...nullEvent, external_id: 'sample:event:sell:equity:1', instrument_external_id: equity.external_id, type: 'sell', quantity: '20', unit_price: '24.10', trade_currency: c, fee_amount: money('5'), fee_currency: c, trade_date: d(45), settlement_date: d(43), description: 'Partial sale' },
      { ...nullEvent, external_id: 'sample:event:reinvest:equity:1', instrument_external_id: equity.external_id, type: 'buy', quantity: '2', unit_price: '25.00', trade_currency: c, event_group_id: group, trade_date: d(20), settlement_date: d(20), description: 'Dividend reinvestment purchase' },
    ],
    cash_transactions: [
      { external_id: 'sample:cash:deposit:1', type: 'deposit', amount: money('1000'), date: d(100), event_group_id: null, description: 'Cash deposit', notes: null },
      { external_id: 'sample:cash:dividend:1', type: 'dividend', amount: money('50'), date: d(20), event_group_id: group, description: 'Dividend reinvested', notes: null },
      { external_id: 'sample:cash:fee:1', type: 'fee', amount: money('3'), date: d(15), event_group_id: null, description: 'Platform fee', notes: null },
    ],
    prices: [
      { external_id: 'sample:price:equity:1', instrument_external_id: equity.external_id, price: '21.80', effective_date: d(120), source: 'statement', provenance: 'Opening statement' },
      { external_id: 'sample:price:bond:1', instrument_external_id: bond.external_id, price: '12.75', effective_date: d(10), source: 'statement', provenance: 'Monthly statement' },
      { external_id: 'sample:price:equity:2', instrument_external_id: equity.external_id, price: '25.40', effective_date: d(10), source: 'statement', provenance: 'Monthly statement' },
    ],
  }
  return JSON.stringify(envelope, null, 2) + '\n'
}

/** One of the four published Investment History v1 CSV templates, with fictional rows. */
export function sampleInvestmentCsv(template: InvestmentTemplate, account: Account, today: string): string {
  const { d, money, c, equity, bond } = investmentPlan(account, today)
  const rowsFor: Record<InvestmentTemplate, string[][]> = {
    holdings: [
      [equity.external_id, 'sample:event:opening:equity', 'sample:price:equity:1', equity.name, equity.symbol, 'custom', equity.identifier, '', 'etf', c, '120', '21.80', d(120), money('2400'), 'Opening holding'],
      [bond.external_id, 'sample:event:opening:bond', 'sample:price:bond:1', bond.name, bond.symbol, 'custom', bond.identifier, '', 'fund', c, '40', '12.50', d(120), money('500'), 'Opening holding'],
    ],
    trades: [
      ['sample:event:buy:bond:1', bond.external_id, 'buy', '10', '12.60', c, money('5'), c, '', '', d(60), d(58), 'Monthly buy', ''],
      ['sample:event:sell:equity:1', equity.external_id, 'sell', '20', '24.10', c, money('5'), c, '', '', d(45), d(43), 'Partial sale', ''],
    ],
    cash: [
      ['sample:cash:deposit:1', 'deposit', money('1000'), d(100), 'Cash deposit', ''],
      ['sample:cash:fee:1', 'fee', money('3'), d(15), 'Platform fee', ''],
    ],
    prices: [
      ['sample:price:equity:2', equity.external_id, '25.40', d(10), 'statement', 'Monthly statement'],
      ['sample:price:bond:2', bond.external_id, '12.75', d(10), 'statement', 'Monthly statement'],
    ],
  }
  return [INVESTMENT_CSV_HEADERS[template], ...rowsFor[template].map((r) => r.map(csvCell).join(','))].join('\n') + '\n'
}
