/**
 * Mock fixtures. Realistic, clearly fictional, and internally consistent: ledgers are generated
 * backwards from the anchor values so replaying them forward lands exactly on today's values.
 * Dates are relative to today (Africa/Nairobi), so the data never looks stale except where
 * staleness is intentional.
 */
import { addDays, addMonths, endOfMonth, format, getDaysInMonth } from 'date-fns'
import { parseDateOnly, todayISO } from '@/lib/dates'
import type { Category, ExchangeRate, Institution, Instrument, SecurityPrice, TransactionType, UserSettings } from '../types'
import { divRound, majorToMinor, mulToMinor } from './decimal'
import { mulberry32, stableId } from './rng'
import type { DataScenario } from './scenario'
import type { AccountRecord, GoalRecord, MilestoneRecord, MockUser, PositionEventRecord, TxnRecord, ValuationRecord, World } from './world'

const fmt = (d: Date) => format(d, 'yyyy-MM-dd')
export const shiftDays = (iso: string, n: number) => fmt(addDays(parseDateOnly(iso), n))
export const shiftMonths = (iso: string, n: number) => fmt(addMonths(parseDateOnly(iso), n))
export const monthEnd = (iso: string) => fmt(endOfMonth(parseDateOnly(iso)))

/** The date with `day` (clamped) in the month `monthsAgo` before `today`. */
function dayInMonth(today: string, monthsAgo: number, day: number): string {
  const base = addMonths(parseDateOnly(today), -monthsAgo)
  const clamped = Math.min(day, getDaysInMonth(base))
  return fmt(new Date(base.getFullYear(), base.getMonth(), clamped))
}

const ts = (date: string, hour = 9) => `${date}T${String(hour).padStart(2, '0')}:12:00Z`

export const DEMO_USER: MockUser = { id: stableId('user:amani'), username: 'amani' }

// ---------------------------------------------------------------------------
// Categories and settings
// ---------------------------------------------------------------------------

const CATEGORY_DEFS: [name: string, icon: string, kind: 'asset' | 'liability', liquid: boolean, investible: boolean, description: string][] = [
  ['Securities', 'trending-up', 'asset', true, true, 'Shares, ETFs, and funds held at a broker.'],
  ['Money Market Fund', 'landmark', 'asset', true, true, 'Low-risk unit trusts with daily interest.'],
  ['Fixed Income', 'scroll-text', 'asset', true, true, 'Bond funds, bills, and notes.'],
  ['Savings', 'piggy-bank', 'asset', true, false, 'Bank savings and fixed deposits.'],
  ['Cash', 'wallet', 'asset', true, false, 'Current accounts, mobile money, and cash.'],
  ['Land and Real Estate', 'map', 'asset', false, true, 'Land, homes, and rental property.'],
  ['Vehicle', 'car', 'asset', false, false, 'Cars and motorcycles you own.'],
  ['Retirement', 'hourglass', 'asset', false, true, 'Pension schemes and retirement funds.'],
  ['Business', 'briefcase', 'asset', false, true, 'Stakes in private businesses.'],
  ['Other Asset', 'gem', 'asset', false, false, 'Anything else of value.'],
  ['Liability', 'hand-coins', 'liability', false, false, 'Loans, mortgages, and credit you owe.'],
]

export function defaultCategories(): Category[] {
  return CATEGORY_DEFS.map(([name, icon, kind, liquid, investible, description], i) => ({
    id: stableId(`category:${name}`),
    name,
    slug: name.toLowerCase().replace(/[^a-z]+/g, '-'),
    icon,
    displayOrder: i + 1,
    assetOrLiability: kind,
    description,
    isLiquid: liquid,
    isInvestible: investible,
    isArchived: false,
    isSystem: true,
  }))
}

const catId = (name: string) => stableId(`category:${name}`)

export function defaultSettings(today: string, overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    displayName: 'Amani Wanjiru',
    appName: 'Wealthboard',
    baseCurrency: 'KES',
    supportedCurrencies: ['KES', 'USD', 'EUR', 'UGX'],
    timezone: 'Africa/Nairobi',
    preferredDateFormat: 'dd MMM yyyy',
    defaultDashboardPeriod: '1y',
    sessionTimeoutMinutes: 720,
    defaultGoalReturnBps: 800,
    positionStaleDaysStock: 7,
    positionStaleDaysEtf: 7,
    positionStaleDaysFund: 30,
    createdAt: ts(shiftMonths(today, -31)),
    updatedAt: ts(shiftDays(today, -12)),
    ...overrides,
  }
}

export function emptyWorld(user: MockUser, settings?: Partial<UserSettings>): World {
  const today = todayISO()
  return {
    user,
    settings: defaultSettings(today, { displayName: user.username, supportedCurrencies: ['KES', 'USD'], createdAt: ts(today), updatedAt: ts(today), ...settings }),
    categories: defaultCategories(),
    institutions: [],
    instruments: [],
    prices: [],
    rates: [],
    accounts: [],
    transactions: [],
    valuations: [],
    positionEvents: [],
    goals: [],
    milestones: [],
    dismissedAlerts: new Set(),
    version: 1,
    seq: 1,
  }
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

class Builder {
  seq = 1
  readonly txns: TxnRecord[] = []
  readonly valuations: ValuationRecord[] = []
  readonly events: PositionEventRecord[] = []
  readonly prices: (SecurityPrice & { instrumentId: string })[] = []
  readonly rand = mulberry32(20261102)

  constructor(readonly today: string) {}

  txn(accountId: string, type: TransactionType, amount: bigint, date: string, extra: Partial<TxnRecord> = {}): TxnRecord {
    const n = this.seq++
    const record: TxnRecord = {
      id: stableId(`txn:${accountId}:${n}`),
      accountId,
      type,
      amountMinor: amount,
      date,
      seq: n,
      createdAt: ts(date, 8 + (n % 10)),
      ...extra,
    }
    this.txns.push(record)
    return record
  }

  valuation(accountId: string, value: bigint, date: string, notes?: string): void {
    const n = this.seq++
    this.valuations.push({ id: stableId(`val:${accountId}:${n}`), accountId, valueMinor: value, date, seq: n, notes, createdAt: ts(date, 18) })
  }

  price(instrument: Instrument, price: string, date: string, source = 'manual'): void {
    const n = this.seq++
    this.prices.push({
      id: stableId(`price:${instrument.id}:${date}`),
      instrumentId: instrument.id,
      externalId: null,
      price,
      currency: instrument.quoteCurrency,
      effectiveDate: `${date}T00:00:00Z`,
      source,
      provenance: source === 'manual' ? 'Entered from broker statement' : null,
      createdAt: ts(date, 19),
      updatedAt: ts(date, 19),
    })
    void n
  }

  trade(
    accountId: string,
    instrument: Instrument,
    type: PositionEventRecord['type'],
    quantity: string,
    unitPrice: string,
    feeMinor: bigint,
    date: string,
    accountCurrency: string,
  ): PositionEventRecord {
    const gross = mulToMinor(quantity, unitPrice, accountCurrency)
    const cash = type === 'buy' ? -(gross + feeMinor) : type === 'sell' ? gross - feeMinor : 0n
    const n = this.seq++
    const record: PositionEventRecord = {
      id: stableId(`pe:${accountId}:${n}`),
      accountId,
      instrumentId: instrument.id,
      type,
      quantity,
      unitPrice,
      tradeCurrency: instrument.quoteCurrency,
      feeMinor,
      cashEffectMinor: cash,
      date,
      seq: n,
      description: `${type === 'buy' ? 'Bought' : type === 'sell' ? 'Sold' : 'Opened'} ${quantity} ${instrument.symbol ?? instrument.name}`,
      createdAt: ts(date, 11),
    }
    this.events.push(record)
    return record
  }

  /** Geometric walk from `start` to `end` over the given dates with seeded noise; last value is exact. */
  walk(dates: string[], start: number, end: number, noise = 0.035): string[] {
    const n = dates.length - 1
    return dates.map((_, i) => {
      if (i === n) return end.toFixed(2)
      const base = start * (end / start) ** (i / Math.max(1, n))
      const jitter = 1 + (this.rand() * 2 - 1) * noise
      return Math.max(0.01, base * jitter).toFixed(2)
    })
  }
}

interface FlowEvent {
  date: string
  type: TransactionType
  /** +1 increases the balance, −1 decreases it; interest is solved for. */
  effect: 1 | -1
  amount: bigint
  description?: string
  transferGroupId?: string
  counterpart?: string
}

/**
 * Generates a value-tracked ledger backwards from `target` so it ends exactly there.
 * Interest is solved month by month: balanceBefore = balanceAfter / (1 + r/12).
 */
function balanceLedger(
  b: Builder,
  accountId: string,
  opts: {
    target: bigint
    startMonthsAgo: number
    annualRateBps: number
    monthly?: { type: TransactionType; amount: bigint; day: number; effect: 1 | -1; description: string }
    extras?: FlowEvent[]
    openingType?: TransactionType
  },
): string {
  const { today } = b
  const start = dayInMonth(today, opts.startMonthsAgo, 3)
  const events: (FlowEvent & { interest?: boolean })[] = (opts.extras ?? []).filter((e) => e.date <= today && e.date > start)
  for (let m = opts.startMonthsAgo; m >= 0; m--) {
    if (opts.monthly) {
      const date = dayInMonth(today, m, opts.monthly.day)
      if (date > start && date <= today) events.push({ date, type: opts.monthly.type, effect: opts.monthly.effect, amount: opts.monthly.amount, description: opts.monthly.description })
    }
    if (opts.annualRateBps > 0) {
      const date = monthEnd(dayInMonth(today, m, 1))
      if (date > start && date < today) events.push({ date, type: 'interest', effect: 1, amount: 0n, interest: true, description: 'Monthly interest' })
    }
  }
  events.sort((a, c) => (a.date === c.date ? (a.interest ? 1 : 0) - (c.interest ? 1 : 0) : a.date < c.date ? -1 : 1))
  let v = opts.target
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (e.interest) {
      const before = divRound(v * 120000n, 120000n + BigInt(opts.annualRateBps))
      e.amount = v - before
      v = before
    } else {
      v -= BigInt(e.effect) * e.amount
    }
  }
  if (v <= 0n) throw new Error(`Fixture ledger for ${accountId} would open at ${v}`)
  b.txn(accountId, opts.openingType ?? 'opening_balance', v, start, { description: 'Opening balance' })
  for (const e of events) {
    b.txn(accountId, e.type, e.type === 'transfer' ? BigInt(e.effect) * e.amount : e.amount, e.date, {
      description: e.description,
      transferGroupId: e.transferGroupId,
    })
  }
  return start
}

// ---------------------------------------------------------------------------
// The anchor portfolio
// ---------------------------------------------------------------------------

export const IDS = {
  zimele: stableId('account:zimele'),
  madison: stableId('account:madison'),
  kcbCar: stableId('account:kcb-car-fund'),
  ibkr: stableId('account:ibkr'),
  land: stableId('account:southern-bypass-land'),
  honda: stableId('account:honda-fit'),
  equity: stableId('account:equity-savings'),
  loan: stableId('account:ncba-car-loan'),
  faida: stableId('account:faida-nse'),
  mpesa: stableId('account:mpesa'),
  sacco: stableId('account:old-sacco'),
  vwra: stableId('instrument:vwra'),
  scom: stableId('instrument:scom'),
  eqty: stableId('instrument:eqty'),
  kcbShares: stableId('instrument:kcb'),
  goalCar: stableId('goal:family-car'),
  goalEmergency: stableId('goal:emergency'),
  goalEducation: stableId('goal:education'),
  goalEtf: stableId('goal:etf-nest-egg'),
  goalJapan: stableId('goal:japan-trip'),
  goalLaptop: stableId('goal:laptop'),
} as const

function institutions(today: string): Institution[] {
  const make = (key: string, name: string, type: Institution['type'], websiteUrl?: string, countryCode = 'KE'): Institution => ({
    id: stableId(`institution:${key}`),
    name,
    type,
    websiteUrl,
    countryCode,
  })
  void today
  return [
    make('zimele', 'Zimele Asset Management', 'asset_manager', 'https://zimele.example'),
    make('madison', 'Madison Investment Managers', 'asset_manager', 'https://madison.example'),
    make('kcb', 'KCB Bank', 'bank', 'https://kcb.example'),
    make('ibkr', 'Interactive Brokers', 'brokerage', 'https://ibkr.example', 'IE'),
    make('equity', 'Equity Bank', 'bank', 'https://equity.example'),
    make('ncba', 'NCBA Bank', 'lender', 'https://ncba.example'),
    make('faida', 'Faida Investment Bank', 'brokerage', 'https://faida.example'),
    make('mpesa', 'M-Pesa', 'digital_wallet'),
    make('sacco', 'Mwangaza Sacco', 'credit_union'),
  ]
}
const instId = (key: string) => stableId(`institution:${key}`)

function instrument(id: string, name: string, symbol: string, identifierType: Instrument['identifierType'], identifier: string, assetType: string, quoteCurrency: string, created: string, exchangeMic: string | null): Instrument {
  return {
    id,
    externalId: null,
    name,
    symbol,
    identifierType,
    identifier,
    exchangeMic,
    assetType,
    quoteCurrency,
    archivedAt: null,
    createdAt: ts(created),
    updatedAt: ts(created),
    latestPrice: null,
  }
}

function rates(b: Builder): ExchangeRate[] {
  const out: ExchangeRate[] = []
  const usdDates: string[] = []
  for (let m = 30; m >= 1; m--) usdDates.push(dayInMonth(b.today, m, 14))
  usdDates.push(shiftDays(b.today, -9))
  const usd = b.walk(usdDates, 131.4, 129.25, 0.006)
  usdDates.forEach((date, i) => {
    out.push({ id: stableId(`rate:USD:KES:${date}`), baseCurrency: 'USD', quoteCurrency: 'KES', rate: usd[i]!, effectiveDate: `${date}T00:00:00Z`, source: 'manual', createdAt: ts(date, 20) })
  })
  const eurDates = [dayInMonth(b.today, 9, 10), dayInMonth(b.today, 5, 10), shiftDays(b.today, -75)]
  ;['138.90', '141.35', '140.10'].forEach((rate, i) => {
    const date = eurDates[i]!
    out.push({ id: stableId(`rate:EUR:KES:${date}`), baseCurrency: 'EUR', quoteCurrency: 'KES', rate, effectiveDate: `${date}T00:00:00Z`, source: 'manual', createdAt: ts(date, 20) })
  })
  return out
}

/** Monthly prices historically, weekly for the last three months (so recent prices stay fresh). */
function priceDates(today: string, fromMonthsAgo: number, lastOffsetDays: number): string[] {
  const dates: string[] = []
  const last = shiftDays(today, -lastOffsetDays)
  const weeklyFrom = shiftMonths(today, -3)
  for (let m = fromMonthsAgo; m >= 3; m--) {
    const d = dayInMonth(today, m, 26)
    if (d < last && d < weeklyFrom) dates.push(d)
  }
  for (let d = shiftDays(last, -7 * 13); d < last; d = shiftDays(d, 7)) if (d >= weeklyFrom && d > (dates.at(-1) ?? '')) dates.push(d)
  dates.push(last)
  return dates
}

export function fullWorld(scenario: DataScenario): World {
  const today = todayISO()
  const b = new Builder(today)
  const ago = (m: number, day: number) => dayInMonth(today, m, day)
  const K = (major: number) => BigInt(Math.round(major * 100))

  const accounts: AccountRecord[] = []
  const add = (rec: Omit<AccountRecord, 'isIncludedInNetWorth'> & { isIncludedInNetWorth?: boolean }) => {
    accounts.push({ isIncludedInNetWorth: true, ...rec })
  }

  // Paired transfer: Equity savings → KCB Car Fund.
  const transferGroup = stableId('transfer:equity-kcb')
  const transferDate = ago(2, 18)

  // Zimele Fixed Income Fund — KES 4,576,918.00
  const zStart = balanceLedger(b, IDS.zimele, {
    target: K(4_576_918),
    startMonthsAgo: 30,
    annualRateBps: 1320,
    monthly: { type: 'deposit', amount: K(50_000), day: 5, effect: 1, description: 'Monthly top-up' },
    extras: [{ date: ago(14, 20), type: 'withdrawal', effect: -1, amount: K(200_000), description: 'School fees' }],
  })
  add({ id: IDS.zimele, name: 'Zimele Fixed Income Fund', categoryId: catId('Fixed Income'), institutionId: instId('zimele'), currency: 'KES', trackingMode: 'balance', openedAt: zStart, accountReference: 'ZFI-20871', notes: 'Interest posts at month end. Top-ups by standing order on the 5th.' })

  // Madison Money Market Fund — KES 1,396,000.00
  const mStart = balanceLedger(b, IDS.madison, {
    target: K(1_396_000),
    startMonthsAgo: 26,
    annualRateBps: 1250,
    monthly: { type: 'deposit', amount: K(30_000), day: 7, effect: 1, description: 'Salary sweep' },
    extras: [{ date: ago(8, 12), type: 'withdrawal', effect: -1, amount: K(85_000), description: 'Car service and insurance' }],
  })
  add({ id: IDS.madison, name: 'Madison Money Market Fund', categoryId: catId('Money Market Fund'), institutionId: instId('madison'), currency: 'KES', trackingMode: 'balance', openedAt: mStart, accountReference: 'MMF-55102' })

  // KCB Car Fund — KES 119,617.00 (linked to the 2028 Family Car goal)
  const kStart = balanceLedger(b, IDS.kcbCar, {
    target: K(119_617),
    startMonthsAgo: 7,
    annualRateBps: 1100,
    monthly: { type: 'deposit', amount: K(12_000), day: 9, effect: 1, description: 'Car fund contribution' },
    extras: [{ date: transferDate, type: 'transfer', effect: 1, amount: K(20_000), description: 'From Equity Bank Savings', transferGroupId: transferGroup }],
  })
  add({ id: IDS.kcbCar, name: 'KCB Car Fund', categoryId: catId('Money Market Fund'), institutionId: instId('kcb'), currency: 'KES', trackingMode: 'balance', openedAt: kStart, notes: 'Saving towards the family car in 2028.' })

  // Equity Bank Savings — KES 245,300.00
  const eStart = balanceLedger(b, IDS.equity, {
    target: K(245_300),
    startMonthsAgo: 30,
    annualRateBps: 400,
    monthly: { type: 'deposit', amount: K(10_000), day: 2, effect: 1, description: 'Monthly saving' },
    extras: [
      { date: transferDate, type: 'transfer', effect: -1, amount: K(20_000), description: 'To KCB Car Fund', transferGroupId: transferGroup },
      { date: ago(11, 22), type: 'withdrawal', effect: -1, amount: K(60_000), description: 'Household emergency' },
      { date: ago(4, 15), type: 'fee', effect: -1, amount: K(350), description: 'Ledger fee' },
    ],
  })
  add({ id: IDS.equity, name: 'Equity Bank Savings', categoryId: catId('Savings'), institutionId: instId('equity'), currency: 'KES', trackingMode: 'balance', openedAt: eStart, accountReference: '•••• 4417' })

  // M-Pesa wallet — KES 18,250.00
  const pStart = balanceLedger(b, IDS.mpesa, {
    target: K(18_250),
    startMonthsAgo: 12,
    annualRateBps: 0,
    monthly: { type: 'deposit', amount: K(6_000), day: 25, effect: 1, description: 'Top-up' },
    extras: Array.from({ length: 12 }, (_, i) => ({ date: ago(11 - i, 12), type: 'withdrawal' as const, effect: -1 as const, amount: K(5_400 + (i % 3) * 300), description: 'Spending' })),
  })
  add({ id: IDS.mpesa, name: 'M-Pesa Wallet', categoryId: catId('Cash'), institutionId: instId('mpesa'), currency: 'KES', trackingMode: 'balance', openedAt: pStart })

  // NCBA Car Loan — KES 420,000.00 outstanding
  const lStart = balanceLedger(b, IDS.loan, {
    target: K(420_000),
    startMonthsAgo: 24,
    annualRateBps: 0,
    monthly: { type: 'liability_payment', amount: K(20_000), day: 28, effect: -1, description: 'Loan instalment' },
    extras: [{ date: ago(10, 6), type: 'liability_increase', effect: 1, amount: K(15_000), description: 'Insurance premium financed' }],
  })
  add({ id: IDS.loan, name: 'NCBA Car Loan', categoryId: catId('Liability'), institutionId: instId('ncba'), currency: 'KES', trackingMode: 'balance', openedAt: lStart, notes: 'Asset finance for the Honda Fit. 36 months.' })

  // Southern Bypass Land — KES 5,000,000.00 (appreciating)
  const landStart = ago(30, 15)
  b.txn(IDS.land, 'opening_balance', K(3_800_000), landStart, { description: 'Purchase price' })
  ;[
    [24, 4_050_000],
    [18, 4_300_000],
    [12, 4_550_000],
    [6, 4_800_000],
  ].forEach(([m, v]) => b.valuation(IDS.land, K(v!), ago(m!, 20), 'Agent appraisal'))
  b.valuation(IDS.land, K(5_000_000), shiftDays(today, -45), 'Registered valuer report')
  add({ id: IDS.land, name: 'Southern Bypass Land', categoryId: catId('Land and Real Estate'), currency: 'KES', trackingMode: 'balance', openedAt: landStart, description: '⅛ acre plot, Kajiado North', notes: 'Title deed in safe deposit box.' })

  // Honda Fit — KES 750,000.00 (depreciating)
  const carStart = lStart
  b.txn(IDS.honda, 'opening_balance', K(1_050_000), carStart, { description: 'Purchase price' })
  ;[
    [21, 1_000_000],
    [18, 960_000],
    [15, 930_000],
    [12, 890_000],
    [9, 860_000],
    [6, 820_000],
    [3, 785_000],
  ].forEach(([m, v]) => b.valuation(IDS.honda, K(v!), ago(m!, 21), 'Market estimate'))
  b.valuation(IDS.honda, K(750_000), shiftDays(today, -20), 'Dealer trade-in quote')
  add({ id: IDS.honda, name: 'Honda Fit', categoryId: catId('Vehicle'), currency: 'KES', trackingMode: 'balance', openedAt: carStart, description: '2017 hybrid, silver' })

  // Archived: Mwangaza Sacco shares (closed out)
  const saccoStart = ago(30, 4)
  b.txn(IDS.sacco, 'opening_balance', K(50_000), saccoStart, { description: 'Share capital' })
  b.txn(IDS.sacco, 'withdrawal', K(50_000), ago(6, 8), { description: 'Shares refunded on exit' })
  add({ id: IDS.sacco, name: 'Mwangaza Sacco Shares', categoryId: catId('Other Asset'), institutionId: instId('sacco'), currency: 'KES', trackingMode: 'balance', openedAt: saccoStart, archivedAt: ts(ago(5, 2)) })

  // Instruments
  const vwra = instrument(IDS.vwra, 'Vanguard FTSE All-World UCITS ETF (Acc)', 'VWRA', 'isin', 'IE00BK5BQT80', 'etf', 'USD', ago(29, 1), 'XLON')
  const scom = instrument(IDS.scom, 'Safaricom PLC', 'SCOM', 'ticker_exchange', 'SCOM', 'stock', 'KES', ago(25, 1), 'XNAI')
  const eqty = instrument(IDS.eqty, 'Equity Group Holdings PLC', 'EQTY', 'ticker_exchange', 'EQTY', 'stock', 'KES', ago(21, 1), 'XNAI')
  const kcbS = instrument(IDS.kcbShares, 'KCB Group PLC', 'KCB', 'ticker_exchange', 'KCB', 'stock', 'KES', ago(17, 1), 'XNAI')

  // Prices (monthly), keyed by date for trade lookups.
  const series = (inst: Instrument, fromMonths: number, start: number, end: number, lastOffsetDays: number) => {
    const dates = priceDates(today, fromMonths, lastOffsetDays)
    const values = b.walk(dates, start, end)
    dates.forEach((d, i) => b.price(inst, values[i]!, d))
    return (date: string) => {
      let p = values[0]!
      dates.forEach((d, i) => {
        if (d <= date) p = values[i]!
      })
      return p
    }
  }
  const vwraAt = series(vwra, 29, 78.4, 100.0, 3)
  const scomAt = series(scom, 25, 13.9, 18.45, 2)
  const eqtyAt = series(eqty, 21, 36.5, 46.2, 2)
  const kcbAt = series(kcbS, 17, 30.2, 38.5, 40)

  // Interactive Brokers (USD, positions): cash 111.00 + 40 VWRA × 100.00 = 4,111.00
  const ibStart = ago(29, 2)
  const usd = (major: number) => BigInt(Math.round(major * 100))
  let ibCash = 0n
  const ibDeposit = (amount: bigint, date: string, description: string) => {
    b.txn(IDS.ibkr, ibCash === 0n && b.txns.every((t) => t.accountId !== IDS.ibkr) ? 'opening_balance' : 'deposit', amount, date, { description })
    ibCash += amount
  }
  const ibBuys = [28, 20, 12, 4]
  ibBuys.forEach((m, i) => {
    const date = ago(m, 27)
    const price = vwraAt(date)
    const cost = mulToMinor('10', price, 'USD') + usd(1)
    if (i < ibBuys.length - 1) {
      const deposit = ((cost + usd(60)) / 10000n + 1n) * 10000n
      ibDeposit(deposit, shiftDays(date, -1), 'Wire from Equity Bank')
    } else {
      // Final deposit calibrates closing cash to exactly USD 111.00 after the remaining flows.
      const futureFees = usd(10)
      const futureInterest = usd(1.2)
      const deposit = usd(111) + cost + futureFees - futureInterest - ibCash
      ibDeposit(deposit, shiftDays(date, -1), 'Wire from Equity Bank')
    }
    const e = b.trade(IDS.ibkr, vwra, 'buy', '10', price, usd(1), date, 'USD')
    ibCash += e.cashEffectMinor
    if (m === 12) {
      b.txn(IDS.ibkr, 'fee', usd(10), ago(13, 3), { description: 'Annual platform fee' })
      ibCash -= usd(10)
    }
  })
  b.txn(IDS.ibkr, 'interest', usd(1.2), ago(2, 1), { description: 'Interest on cash balance' })
  ibCash += usd(1.2)
  b.txn(IDS.ibkr, 'fee', usd(10), ago(1, 3), { description: 'Annual platform fee' })
  ibCash -= usd(10)
  if (ibCash !== usd(111)) throw new Error(`IBKR cash fixture mismatch: ${ibCash}`)
  add({ id: IDS.ibkr, name: 'Interactive Brokers Brokerage', categoryId: catId('Securities'), institutionId: instId('ibkr'), currency: 'USD', trackingMode: 'positions', openedAt: ibStart, accountReference: 'U•••8810', notes: 'Accumulating global ETF; buy 10 units roughly every 8 months.' })

  // Faida NSE Portfolio (KES, positions): cash 12,450 + SCOM 5,000×18.45 + EQTY 800×46.20 + KCB 600×38.50
  const fStart = ago(24, 3)
  const fee = K(150)
  let faidaCash = 0n
  const fDeposit = (amount: bigint, date: string) => {
    b.txn(IDS.faida, faidaCash === 0n && b.txns.every((t) => t.accountId !== IDS.faida) ? 'opening_balance' : 'deposit', amount, date, { description: 'Transfer from M-Pesa' })
    faidaCash += amount
  }
  const fTrade = (inst: Instrument, type: 'buy' | 'sell', qty: string, priceAt: (d: string) => string, date: string) => {
    const price = priceAt(date)
    if (type === 'buy') {
      const cost = mulToMinor(qty, price, 'KES') + fee
      if (faidaCash < cost) fDeposit(((cost - faidaCash) / 100000n + 1n) * 100000n, shiftDays(date, -1))
    }
    const e = b.trade(IDS.faida, inst, type, qty, price, fee, date, 'KES')
    faidaCash += e.cashEffectMinor
  }
  const fDividend = (inst: Instrument, perShare: string, qty: string, date: string) => {
    const amount = mulToMinor(qty, perShare, 'KES')
    b.txn(IDS.faida, 'dividend', amount, date, { description: `${inst.symbol} dividend (KES ${perShare}/share)`, instrumentId: inst.id })
    faidaCash += amount
  }
  fTrade(scom, 'buy', '3000', scomAt, ago(24, 10))
  fTrade(eqty, 'buy', '500', eqtyAt, ago(20, 10))
  fDividend(eqty, '4.00', '500', ago(19, 24))
  fDividend(scom, '1.20', '3000', ago(17, 24))
  fTrade(kcbS, 'buy', '600', kcbAt, ago(16, 10))
  b.txn(IDS.faida, 'fee', K(500), ago(13, 2), { description: 'CDSC annual account fee' })
  faidaCash -= K(500)
  fTrade(scom, 'buy', '2500', scomAt, ago(12, 10))
  fDividend(eqty, '4.00', '500', ago(7, 24))
  fTrade(eqty, 'buy', '300', eqtyAt, ago(6, 10))
  fDividend(scom, '1.20', '5500', ago(5, 24))
  fTrade(scom, 'sell', '500', scomAt, ago(3, 10))
  b.txn(IDS.faida, 'fee', K(500), ago(1, 2), { description: 'CDSC annual account fee' })
  faidaCash -= K(500)
  const faidaTarget = K(12_450)
  const calibration = faidaTarget - faidaCash
  b.txn(IDS.faida, calibration >= 0n ? 'deposit' : 'withdrawal', calibration >= 0n ? calibration : -calibration, ago(0, 1) <= today ? ago(0, 1) : shiftDays(today, -1), {
    description: calibration >= 0n ? 'Transfer from M-Pesa' : 'Withdrawal to M-Pesa',
  })
  add({ id: IDS.faida, name: 'Faida NSE Portfolio', categoryId: catId('Securities'), institutionId: instId('faida'), currency: 'KES', trackingMode: 'positions', openedAt: fStart, accountReference: 'CDS-A0041782' })

  // Goals
  const goals: GoalRecord[] = [
    {
      id: IDS.goalCar,
      name: '2028 Family Car',
      description: 'A 7-seater for the family, bought cash so there is no second loan.',
      targetMinor: K(3_250_000),
      manualCurrentMinor: 0n,
      currency: 'KES',
      targetDate: '2028-07-01',
      linkedAccountId: IDS.kcbCar,
      icon: 'car',
      status: 'active',
      priority: 1,
      assumedAnnualReturnBps: 800,
      plannedContributionMinor: K(120_000),
      frequency: 'monthly',
      planStartDate: kStart,
      planEndDate: null,
    },
    {
      id: IDS.goalEmergency,
      name: 'Emergency fund',
      description: 'Six months of household costs, kept liquid.',
      targetMinor: K(1_500_000),
      manualCurrentMinor: 0n,
      currency: 'KES',
      targetDate: shiftMonths(today, 10),
      linkedAccountId: IDS.madison,
      icon: 'shield',
      status: 'active',
      priority: 2,
      assumedAnnualReturnBps: 1100,
      plannedContributionMinor: K(30_000),
      frequency: 'monthly',
      planStartDate: mStart,
      planEndDate: null,
    },
    {
      id: IDS.goalEducation,
      name: "Kids' education",
      description: 'University fees for two, starting 2035.',
      targetMinor: K(6_000_000),
      manualCurrentMinor: K(1_850_000),
      currency: 'KES',
      targetDate: '2035-01-05',
      linkedAccountId: null,
      icon: 'graduation-cap',
      status: 'active',
      priority: 3,
      assumedAnnualReturnBps: 1000,
      plannedContributionMinor: K(25_000),
      frequency: 'monthly',
      planStartDate: ago(18, 1),
      planEndDate: null,
    },
    {
      id: IDS.goalEtf,
      name: 'Global ETF nest egg',
      description: 'Long-term global equity, held offshore.',
      targetMinor: K(2_000_000),
      manualCurrentMinor: 0n,
      currency: 'KES',
      targetDate: '2030-12-31',
      linkedAccountId: IDS.ibkr,
      icon: 'globe',
      status: 'active',
      priority: 4,
      assumedAnnualReturnBps: 900,
      plannedContributionMinor: K(25_000),
      frequency: 'monthly',
      planStartDate: ibStart,
      planEndDate: null,
    },
    {
      id: IDS.goalJapan,
      name: 'Japan trip',
      description: 'Two weeks in spring. On hold while the car fund catches up.',
      targetMinor: K(600_000),
      manualCurrentMinor: K(140_000),
      currency: 'KES',
      targetDate: shiftMonths(today, 14),
      linkedAccountId: null,
      icon: 'plane',
      status: 'paused',
      priority: 5,
      assumedAnnualReturnBps: 0,
      plannedContributionMinor: K(20_000),
      frequency: 'monthly',
      planStartDate: ago(9, 1),
      planEndDate: null,
    },
    {
      id: IDS.goalLaptop,
      name: 'New work laptop',
      description: null,
      targetMinor: K(220_000),
      manualCurrentMinor: K(220_000),
      currency: 'KES',
      targetDate: ago(3, 15),
      linkedAccountId: null,
      icon: 'laptop',
      status: 'completed',
      priority: 6,
      assumedAnnualReturnBps: 0,
      plannedContributionMinor: K(20_000),
      frequency: 'monthly',
      planStartDate: ago(14, 1),
      planEndDate: ago(3, 15),
    },
  ]
  const milestones: MilestoneRecord[] = [
    { id: stableId('ms:car:100k'), goalId: IDS.goalCar, name: 'First KES 100,000', targetMinor: K(100_000), targetDate: ago(1, 30) },
    { id: stableId('ms:car:250k'), goalId: IDS.goalCar, name: 'KES 250,000 cushion', targetMinor: K(250_000), targetDate: ago(1, 1) },
    { id: stableId('ms:car:1m'), goalId: IDS.goalCar, name: 'First million', targetMinor: K(1_000_000), targetDate: '2027-06-30' },
    { id: stableId('ms:car:half'), goalId: IDS.goalCar, name: 'Halfway there', targetMinor: K(1_625_000), targetDate: '2027-10-31' },
    { id: stableId('ms:edu:2m'), goalId: IDS.goalEducation, name: 'KES 2 million', targetMinor: K(2_000_000), targetDate: shiftMonths(today, 6) },
  ]

  const world: World = {
    user: DEMO_USER,
    settings: defaultSettings(today),
    categories: defaultCategories(),
    institutions: institutions(today),
    instruments: [vwra, scom, eqty, kcbS],
    prices: b.prices,
    rates: rates(b),
    accounts,
    transactions: b.txns,
    valuations: b.valuations,
    positionEvents: b.events,
    goals,
    milestones,
    dismissedAlerts: new Set(),
    version: 1,
    seq: b.seq + 1,
  }

  if (scenario === 'incomplete') {
    world.rates = world.rates.filter((r) => r.baseCurrency !== 'USD' && r.quoteCurrency !== 'USD')
    world.prices = world.prices.filter((p) => p.instrumentId !== IDS.kcbShares)
  }
  return world
}

export { majorToMinor }
