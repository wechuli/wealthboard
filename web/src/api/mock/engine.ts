/**
 * Mock "server": derives every read model from the World ledger with BigInt arithmetic.
 * This is the only place outside tests where financial results are computed, standing in for
 * the backend. UI components never compute these values.
 */
import { addDays, addMonths, differenceInCalendarDays, format, startOfMonth } from 'date-fns'
import { parseDateOnly, todayISO } from '@/lib/dates'
import type { AccountComparison, AccountComparisonRow, AccountExtras, AccountSummaryExt, ActivityQuery, AttentionItem, AttentionSummary, FlowsReport, Freshness, IncomeReport, InstrumentHoldings, MonthlyFlowPoint, NetWorthStats } from '../extensions'
import type {
  Account,
  AccountAnalytics,
  ActivityItem,
  ActivityPage,
  AllocationItem,
  Category,
  Dashboard,
  DashboardRange,
  Goal,
  GoalAlert,
  GoalMilestone,
  GoalScenario,
  GoalScenarios,
  HistoricalPoint,
  Instrument,
  ReportAllocation,
  ReportSummary,
  SecurityPrice,
  SettingsRead,
  Transaction,
  TransactionType,
  Valuation,
} from '../types'
import { convertMinor, divRound, fromScaled, minorToMajor, mulToMinor, percentOf, toScaled } from './decimal'
import type { AccountRecord, GoalRecord, PositionEventRecord, TxnRecord, World } from './world'

const fmt = (d: Date) => format(d, 'yyyy-MM-dd')
const s = (v: bigint) => v.toString()
const tsOf = (date: string) => `${date}T00:00:00Z`
const dateOf = (iso: string) => iso.slice(0, 10)

/** Signed effect of a transaction on a value-tracked balance (or position-account cash). */
export function txnEffect(t: Pick<TxnRecord, 'type' | 'amountMinor'>): bigint {
  switch (t.type) {
    case 'withdrawal':
    case 'fee':
    case 'capital_loss':
    case 'sale':
    case 'liability_payment':
      return -t.amountMinor
    case 'transfer':
    case 'manual_adjustment':
      return t.amountMinor
    default:
      return t.amountMinor
  }
}

type Flow = 'contribution' | 'withdrawal' | 'income' | 'fee' | 'internal' | 'growth'

function flowKind(type: TransactionType, isLiability: boolean): Flow {
  switch (type) {
    case 'opening_balance':
      return isLiability ? 'withdrawal' : 'contribution'
    case 'deposit':
      return 'contribution'
    case 'withdrawal':
      return 'withdrawal'
    case 'interest':
    case 'dividend':
      return 'income'
    case 'fee':
      return 'fee'
    case 'liability_payment':
      return 'contribution'
    case 'liability_increase':
      return 'withdrawal'
    case 'transfer':
      return 'internal'
    default:
      return 'growth'
  }
}

interface ValueResult {
  value: bigint
  complete: boolean
  missingPrices: string[]
  missingCurrencies: string[]
}

interface Totals {
  assets: bigint
  liabilities: bigint
  netWorth: bigint
  liquid: bigint
  investible: bigint
  complete: boolean
  missingCurrencies: string[]
}

export class Engine {
  readonly today: string
  private readonly cache = new Map<string, unknown>()
  private readonly txByAccount = new Map<string, TxnRecord[]>()
  private readonly valByAccount = new Map<string, World['valuations']>()
  private readonly peByAccount = new Map<string, PositionEventRecord[]>()
  private readonly pricesByInstrument = new Map<string, (SecurityPrice & { instrumentId: string })[]>()

  constructor(readonly world: World) {
    this.today = todayISO(world.settings.timezone)
    const bySeq = <T extends { date: string; seq: number }>(a: T, b: T) => (a.date === b.date ? a.seq - b.seq : a.date < b.date ? -1 : 1)
    for (const t of world.transactions) push(this.txByAccount, t.accountId, t)
    for (const v of world.valuations) push(this.valByAccount, v.accountId, v)
    for (const e of world.positionEvents) push(this.peByAccount, e.accountId, e)
    for (const p of world.prices) push(this.pricesByInstrument, p.instrumentId, p)
    this.txByAccount.forEach((l) => l.sort(bySeq))
    this.valByAccount.forEach((l) => l.sort(bySeq))
    this.peByAccount.forEach((l) => l.sort(bySeq))
    this.pricesByInstrument.forEach((l) => l.sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1)))
  }

  private memo<T>(key: string, fn: () => T): T {
    if (this.cache.has(key)) return this.cache.get(key) as T
    const v = fn()
    this.cache.set(key, v)
    return v
  }

  // ---- lookups ---------------------------------------------------------------

  get base(): string {
    return this.world.settings.baseCurrency
  }

  account(id: string): AccountRecord | undefined {
    return this.world.accounts.find((a) => a.id === id)
  }

  category(id: string): Category | undefined {
    return this.world.categories.find((c) => c.id === id)
  }

  isLiability(a: AccountRecord): boolean {
    return this.category(a.categoryId)?.assetOrLiability === 'liability'
  }

  instrument(id: string): Instrument | undefined {
    return this.world.instruments.find((i) => i.id === id)
  }

  txns(accountId: string): TxnRecord[] {
    return this.txByAccount.get(accountId) ?? []
  }

  valuations(accountId: string) {
    return this.valByAccount.get(accountId) ?? []
  }

  events(accountId: string): PositionEventRecord[] {
    return this.peByAccount.get(accountId) ?? []
  }

  staleDays(inst: Instrument): number {
    const st = this.world.settings
    return inst.assetType === 'etf' ? st.positionStaleDaysEtf : inst.assetType === 'fund' ? st.positionStaleDaysFund : st.positionStaleDaysStock
  }

  priceAt(instrumentId: string, date: string): (SecurityPrice & { instrumentId: string }) | null {
    const list = this.pricesByInstrument.get(instrumentId) ?? []
    let found: (SecurityPrice & { instrumentId: string }) | null = null
    for (const p of list) {
      if (dateOf(p.effectiveDate) <= date) found = p
      else break
    }
    return found
  }

  latestPrice(instrumentId: string): SecurityPrice | null {
    const p = this.priceAt(instrumentId, this.today)
    if (!p) return null
    const { instrumentId: _drop, ...rest } = p
    return rest
  }

  /** Latest rate on or before `date` converting `from` → `to`, using the implied inverse when needed. */
  rateAt(from: string, to: string, date: string): { rate: string; invert: boolean; date: string } | null {
    let best: { rate: string; invert: boolean; date: string } | null = null
    for (const r of this.world.rates) {
      const d = dateOf(r.effectiveDate)
      if (d > date) continue
      const direct = r.baseCurrency === from && r.quoteCurrency === to
      const inverse = r.baseCurrency === to && r.quoteCurrency === from
      if ((direct || inverse) && (!best || d > best.date)) best = { rate: r.rate, invert: inverse, date: d }
    }
    return best
  }

  convert(minor: bigint, from: string, to: string, date: string): bigint | null {
    if (from === to) return minor
    const r = this.rateAt(from, to, date)
    if (!r) return null
    return convertMinor(minor, from, to, r.rate, r.invert)
  }

  // ---- account values --------------------------------------------------------

  quantitiesAt(accountId: string, date: string): Map<string, bigint> {
    const q = new Map<string, bigint>()
    for (const e of this.events(accountId)) {
      if (e.date > date) break
      const qty = toScaled(e.quantity)
      const delta = e.type === 'sell' ? -qty : qty
      q.set(e.instrumentId, (q.get(e.instrumentId) ?? 0n) + delta)
    }
    for (const [k, v] of q) if (v === 0n) q.delete(k)
    return q
  }

  cashAt(accountId: string, date: string): bigint {
    let cash = 0n
    for (const t of this.txns(accountId)) {
      if (t.date > date) break
      cash += txnEffect(t)
    }
    for (const e of this.events(accountId)) {
      if (e.date > date) break
      cash += e.cashEffectMinor
    }
    return cash
  }

  valueAt(accountId: string, date: string): ValueResult {
    return this.memo(`v|${accountId}|${date}`, () => {
      const a = this.account(accountId)
      if (!a) return { value: 0n, complete: true, missingPrices: [], missingCurrencies: [] }
      if (a.trackingMode === 'positions') {
        let value = this.cashAt(accountId, date)
        const missingPrices: string[] = []
        const missingCurrencies: string[] = []
        for (const [instrumentId, qty] of this.quantitiesAt(accountId, date)) {
          const inst = this.instrument(instrumentId)
          const p = this.priceAt(instrumentId, date)
          if (!inst || !p) {
            missingPrices.push(instrumentId)
            continue
          }
          const native = mulToMinor(fromScaled(qty, 12), p.price, inst.quoteCurrency)
          const converted = this.convert(native, inst.quoteCurrency, a.currency, date)
          if (converted === null) missingCurrencies.push(inst.quoteCurrency)
          else value += converted
        }
        return { value, complete: missingPrices.length === 0 && missingCurrencies.length === 0, missingPrices, missingCurrencies }
      }
      // Value-tracked: replay transactions; a valuation sets an absolute value.
      let value = 0n
      const txns = this.txns(accountId)
      const vals = this.valuations(accountId)
      let i = 0
      let j = 0
      while (i < txns.length || j < vals.length) {
        const t = txns[i]
        const v = vals[j]
        const takeVal = v && (!t || v.date < t.date || (v.date === t.date && v.seq < t.seq))
        if (takeVal) {
          if (v.date > date) break
          value = v.valueMinor
          j++
        } else if (t) {
          if (t.date > date) break
          value += txnEffect(t)
          i++
        }
      }
      return { value, complete: true, missingPrices: [], missingCurrencies: [] }
    })
  }

  /** Value converted to the base currency; null when a rate is missing. */
  baseValueAt(accountId: string, date: string): { value: bigint | null; complete: boolean; missingCurrencies: string[] } {
    const a = this.account(accountId)!
    const v = this.valueAt(accountId, date)
    const converted = this.convert(v.value, a.currency, this.base, date)
    const missingCurrencies = [...v.missingCurrencies]
    if (converted === null) missingCurrencies.push(a.currency)
    return { value: converted, complete: v.complete && converted !== null, missingCurrencies: unique(missingCurrencies) }
  }

  activeAt(a: AccountRecord, date: string): boolean {
    if (a.openedAt > date) return false
    if (a.archivedAt && dateOf(a.archivedAt) <= date) return false
    return true
  }

  totalsAt(date: string): Totals {
    return this.memo(`t|${date}`, () => {
      let assets = 0n
      let liabilities = 0n
      let liquid = 0n
      let investible = 0n
      let complete = true
      const missing: string[] = []
      for (const a of this.world.accounts) {
        if (!a.isIncludedInNetWorth || !this.activeAt(a, date)) continue
        const bv = this.baseValueAt(a.id, date)
        if (!bv.complete) complete = false
        missing.push(...bv.missingCurrencies)
        if (bv.value === null) continue
        const cat = this.category(a.categoryId)
        if (cat?.assetOrLiability === 'liability') liabilities += bv.value
        else {
          assets += bv.value
          if (cat?.isLiquid) liquid += bv.value
          if (cat?.isInvestible) investible += bv.value
        }
      }
      return { assets, liabilities, netWorth: assets - liabilities, liquid, investible, complete, missingCurrencies: unique(missing) }
    })
  }

  firstDate(): string | null {
    const opens = this.world.accounts.map((a) => a.openedAt).sort()
    return opens[0] ?? null
  }

  // ---- DTOs --------------------------------------------------------------------

  toAccount(a: AccountRecord): Account {
    const v = this.valueAt(a.id, this.today)
    const bv = this.baseValueAt(a.id, this.today)
    const monthAgo = fmt(addMonths(parseDateOnly(this.today), -1))
    const prev = a.openedAt <= monthAgo ? this.baseValueAt(a.id, monthAgo).value : null
    const inst = a.institutionId ? this.world.institutions.find((i) => i.id === a.institutionId) : undefined
    return {
      id: a.id,
      categoryId: a.categoryId,
      institutionId: a.institutionId,
      name: a.name,
      description: a.description,
      currency: a.currency,
      trackingMode: a.trackingMode,
      currentValueMinor: s(v.value),
      convertedValueMinor: bv.value === null ? null : s(bv.value),
      monthlyChangeMinor: prev === null || bv.value === null || a.archivedAt ? null : s(bv.value - prev),
      costBasisMinor: a.costBasisMinor === undefined ? undefined : s(a.costBasisMinor),
      isLiability: this.isLiability(a),
      isIncludedInNetWorth: a.isIncludedInNetWorth,
      categoryName: this.category(a.categoryId)?.name ?? 'Uncategorised',
      institutionName: inst?.name,
      accountReference: a.accountReference,
      notes: a.notes,
      openedAt: a.openedAt,
      archivedAt: a.archivedAt,
    }
  }

  accounts(filter: 'active' | 'archived' | 'all' = 'active'): Account[] {
    return this.world.accounts
      .filter((a) => (filter === 'all' ? true : filter === 'archived' ? !!a.archivedAt : !a.archivedAt))
      .map((a) => this.toAccount(a))
  }

  toTransaction(t: TxnRecord): Transaction {
    const a = this.account(t.accountId)!
    return {
      id: t.id,
      accountId: t.accountId,
      accountName: a.name,
      type: t.type,
      amountMinor: s(t.amountMinor),
      currency: a.currency,
      transactionDate: t.date,
      description: t.description,
      notes: t.notes,
      externalId: t.externalId,
      transferGroupId: t.transferGroupId,
    }
  }

  toValuation(v: World['valuations'][number]): Valuation {
    const a = this.account(v.accountId)!
    return { id: v.id, accountId: v.accountId, accountName: a.name, valueMinor: s(v.valueMinor), currency: a.currency, valuationDate: v.date, notes: v.notes }
  }

  // ---- history -----------------------------------------------------------------

  rangeStart(range: DashboardRange): string {
    const t = parseDateOnly(this.today)
    const first = this.firstDate() ?? this.today
    const r =
      range === '1m' ? fmt(addMonths(t, -1)) : range === '3m' ? fmt(addMonths(t, -3)) : range === '6m' ? fmt(addMonths(t, -6)) : range === '1y' ? fmt(addMonths(t, -12)) : first
    return r < first ? first : r
  }

  historyDates(range: DashboardRange): string[] {
    const first = this.firstDate()
    if (!first) return []
    const start = this.rangeStart(range)
    const dates: string[] = []
    const t = parseDateOnly(this.today)
    if (range === 'all') {
      let d = startOfMonth(parseDateOnly(start))
      while (fmt(d) <= this.today) {
        const iso = fmt(d)
        if (iso >= first) dates.push(iso)
        d = addMonths(d, 1)
      }
      if (dates[0] !== first) dates.unshift(first)
    } else {
      const step = range === '1m' ? 2 : range === '3m' || range === '6m' ? 7 : 14
      let d = t
      while (fmt(d) >= start) {
        dates.unshift(fmt(d))
        d = addDays(d, -step)
      }
      if (dates[0] !== start) dates.unshift(start)
    }
    if (dates.at(-1) !== this.today) dates.push(this.today)
    return unique(dates)
  }

  historyPoint(date: string): HistoricalPoint {
    const tt = this.totalsAt(date)
    return {
      date: tsOf(date),
      assetsMinor: s(tt.assets),
      liabilitiesMinor: s(tt.liabilities),
      netWorthMinor: s(tt.netWorth),
      liquidMinor: s(tt.liquid),
      investibleMinor: s(tt.investible),
      complete: tt.complete,
      missingCurrencies: tt.missingCurrencies,
    }
  }

  // ---- flows -------------------------------------------------------------------

  /** Portfolio-level flows in the base currency over (from, to]. */
  flowsBetween(from: string, to: string) {
    let contributions = 0n
    let withdrawals = 0n
    let income = 0n
    let fees = 0n
    let complete = true
    const add = (kind: Flow, amount: bigint) => {
      if (kind === 'contribution') contributions += amount
      else if (kind === 'withdrawal') withdrawals += amount
      else if (kind === 'income') income += amount
      else if (kind === 'fee') fees += amount
    }
    for (const a of this.world.accounts) {
      if (!a.isIncludedInNetWorth) continue
      const liab = this.isLiability(a)
      for (const t of this.txns(a.id)) {
        if (t.date <= from || t.date > to) continue
        const kind = flowKind(t.type, liab)
        if (kind === 'internal' || kind === 'growth') continue
        const c = this.convert(t.amountMinor, a.currency, this.base, t.date)
        if (c === null) {
          complete = false
          continue
        }
        add(kind, c)
      }
      for (const e of this.events(a.id)) {
        if (e.date <= from || e.date > to || e.feeMinor === 0n) continue
        const c = this.convert(e.feeMinor, a.currency, this.base, e.date)
        if (c === null) complete = false
        else fees += c
      }
    }
    const start = this.totalsAt(from)
    const end = this.totalsAt(to)
    const growth = end.netWorth - start.netWorth - contributions + withdrawals - income + fees
    return { start: start.netWorth, end: end.netWorth, contributions, withdrawals, income, fees, growth, complete: complete && start.complete && end.complete }
  }

  months(from: string, to: string): MonthlyFlowPoint[] {
    const out: MonthlyFlowPoint[] = []
    let m = startOfMonth(parseDateOnly(from))
    while (fmt(m) <= to) {
      const monthStart = fmt(m)
      const prevEnd = fmt(addDays(m, -1))
      const nextStart = addMonths(m, 1)
      const monthEndDate = fmt(addDays(nextStart, -1))
      const end = monthEndDate > to ? to : monthEndDate
      const f = this.flowsBetween(prevEnd, end)
      out.push({
        month: monthStart,
        contributionsMinor: s(f.contributions),
        withdrawalsMinor: s(f.withdrawals),
        incomeMinor: s(f.income),
        feesMinor: s(f.fees),
        growthMinor: s(f.growth),
        netChangeMinor: s(f.end - f.start),
        complete: f.complete,
      })
      m = nextStart
    }
    return out
  }

  // ---- dashboard & reports -----------------------------------------------------

  allocation(date: string, by: 'category' | 'institution' | 'currency' | 'investible'): AllocationItem[] {
    const buckets = new Map<string, bigint>()
    let total = 0n
    for (const a of this.world.accounts) {
      if (!a.isIncludedInNetWorth || !this.activeAt(a, date) || this.isLiability(a)) continue
      const cat = this.category(a.categoryId)
      if (by === 'investible' && !cat?.isInvestible) continue
      const bv = this.baseValueAt(a.id, date)
      if (bv.value === null || bv.value <= 0n) continue
      const key =
        by === 'institution' ? (this.world.institutions.find((i) => i.id === a.institutionId)?.name ?? 'No institution') : by === 'currency' ? a.currency : (cat?.name ?? 'Other')
      buckets.set(key, (buckets.get(key) ?? 0n) + bv.value)
      total += bv.value
    }
    return toAllocation(buckets, total)
  }

  instrumentAllocation(date: string): AllocationItem[] {
    const buckets = new Map<string, bigint>()
    let total = 0n
    for (const a of this.world.accounts) {
      if (a.trackingMode !== 'positions' || !this.activeAt(a, date)) continue
      for (const [instrumentId, qty] of this.quantitiesAt(a.id, date)) {
        const inst = this.instrument(instrumentId)
        const p = this.priceAt(instrumentId, date)
        if (!inst || !p) continue
        const native = mulToMinor(fromScaled(qty, 12), p.price, inst.quoteCurrency)
        const b = this.convert(native, inst.quoteCurrency, this.base, date)
        if (b === null) continue
        const key = inst.symbol ? `${inst.symbol} · ${inst.name}` : inst.name
        buckets.set(key, (buckets.get(key) ?? 0n) + b)
        total += b
      }
      const cash = this.convert(this.cashAt(a.id, date), a.currency, this.base, date)
      if (cash !== null && cash > 0n) {
        buckets.set('Broker cash', (buckets.get('Broker cash') ?? 0n) + cash)
        total += cash
      }
    }
    return toAllocation(buckets, total)
  }

  completenessReasons(): string[] {
    return this.attention()
      .items.filter((i) => i.kind === 'missing_rate' || i.kind === 'missing_price')
      .map((i) => i.title)
  }

  dashboard(range: DashboardRange): Dashboard {
    const now = this.totalsAt(this.today)
    const history = this.historyDates(range).map((d) => this.historyPoint(d))
    const start = this.rangeStart(range)
    const flows = this.firstDate() ? this.flowsBetween(fmt(addDays(parseDateOnly(start), -1)), this.today) : null
    const t = parseDateOnly(this.today)
    const first = this.firstDate()
    const change = (date: string | null): string | null => {
      if (!first || !date || date < first) return null
      const then = this.totalsAt(date)
      if (!then.complete || !now.complete) return null
      return s(now.netWorth - then.netWorth)
    }
    const reasons = this.completenessReasons()
    return {
      asOf: this.today,
      baseCurrency: this.base,
      totals: {
        assets: s(now.assets),
        liabilities: s(now.liabilities),
        netWorth: s(now.netWorth),
        liquid: s(now.liquid),
        investible: s(now.investible),
        contributions: s(flows?.contributions ?? 0n),
        withdrawals: s(flows?.withdrawals ?? 0n),
        income: s(flows?.income ?? 0n),
        fees: s(flows?.fees ?? 0n),
        capitalGrowth: s(flows?.growth ?? 0n),
      },
      accountCount: this.world.accounts.filter((a) => !a.archivedAt).length,
      goalCount: this.world.goals.length,
      currentComplete: now.complete,
      missingCurrencies: now.missingCurrencies,
      historicalAvailable: history.length >= 2,
      historicalComplete: history.every((h) => h.complete),
      periodChanges: {
        oneMonth: change(fmt(addMonths(t, -1))),
        threeMonths: change(fmt(addMonths(t, -3))),
        oneYear: change(fmt(addMonths(t, -12))),
        allTime: first ? change(first) : null,
      },
      valueBasis: 'latest_values',
      history,
      allocation: this.allocation(this.today, 'category'),
      investibleAllocation: this.allocation(this.today, 'investible'),
      institutionAllocation: this.allocation(this.today, 'institution'),
      currencyAllocation: this.allocation(this.today, 'currency'),
      instrumentAllocation: this.instrumentAllocation(this.today),
      compositionComplete: now.complete,
      completenessReasons: reasons,
    }
  }

  reportSummary(): ReportSummary {
    const d = this.dashboard('all')
    return {
      asOf: d.asOf,
      baseCurrency: d.baseCurrency,
      totals: d.totals,
      accountCount: d.accountCount,
      goalCount: d.goalCount,
      currentComplete: d.currentComplete,
      missingCurrencies: d.missingCurrencies,
      valueBasis: d.valueBasis,
      history: d.history,
      historicalComplete: d.historicalComplete,
      compositionComplete: d.compositionComplete,
      completenessReasons: d.completenessReasons,
    }
  }

  reportAllocation(): ReportAllocation {
    const now = this.totalsAt(this.today)
    return {
      asOf: this.today,
      baseCurrency: this.base,
      currentComplete: now.complete,
      missingCurrencies: now.missingCurrencies,
      valueBasis: 'latest_values',
      categories: this.allocation(this.today, 'category'),
      institutions: this.allocation(this.today, 'institution'),
      currencies: this.allocation(this.today, 'currency'),
      investibleCategories: this.allocation(this.today, 'investible'),
      instruments: this.instrumentAllocation(this.today),
    }
  }

  flowsReport(range: DashboardRange): FlowsReport {
    const start = this.rangeStart(range)
    const from = fmt(addDays(parseDateOnly(start), -1))
    const f = this.firstDate() ? this.flowsBetween(from, this.today) : null
    return {
      baseCurrency: this.base,
      range,
      from: start,
      to: this.today,
      startValueMinor: s(f?.start ?? 0n),
      endValueMinor: s(f?.end ?? 0n),
      contributionsMinor: s(f?.contributions ?? 0n),
      incomeMinor: s(f?.income ?? 0n),
      growthMinor: s(f?.growth ?? 0n),
      withdrawalsMinor: s(f?.withdrawals ?? 0n),
      feesMinor: s(f?.fees ?? 0n),
      complete: f?.complete ?? true,
      months: this.firstDate() ? this.months(start, this.today) : [],
    }
  }

  incomeReport(range: DashboardRange): IncomeReport {
    const start = this.rangeStart(range)
    const flows = this.flowsReport(range)
    const interest = new Map<string, bigint>()
    const fees = new Map<string, bigint>()
    const dividends: IncomeReport['dividends'] = []
    const divByKey = new Map<string, bigint>()
    for (const a of this.world.accounts) {
      for (const t of this.txns(a.id)) {
        if (t.date < start || t.date > this.today) continue
        if (t.type === 'interest') interest.set(a.id, (interest.get(a.id) ?? 0n) + t.amountMinor)
        if (t.type === 'fee') fees.set(a.id, (fees.get(a.id) ?? 0n) + t.amountMinor)
        if (t.type === 'dividend') {
          const key = `${a.id}|${t.instrumentId ?? ''}`
          divByKey.set(key, (divByKey.get(key) ?? 0n) + t.amountMinor)
        }
      }
      for (const e of this.events(a.id)) {
        if (e.date < start || e.date > this.today || e.feeMinor === 0n) continue
        fees.set(a.id, (fees.get(a.id) ?? 0n) + e.feeMinor)
      }
    }
    const perAccount = (m: Map<string, bigint>) =>
      [...m.entries()]
        .map(([id, native]) => {
          const a = this.account(id)!
          const b = this.convert(native, a.currency, this.base, this.today)
          return { accountId: id, name: a.name, currency: a.currency, nativeMinor: s(native), baseMinor: b === null ? null : s(b) }
        })
        .sort((x, y) => Number(BigInt(y.baseMinor ?? '0') - BigInt(x.baseMinor ?? '0')))
    for (const [key, native] of divByKey) {
      const [accountId, instrumentId] = key.split('|') as [string, string]
      const a = this.account(accountId)!
      const inst = instrumentId ? this.instrument(instrumentId) : undefined
      const b = this.convert(native, a.currency, this.base, this.today)
      dividends.push({ accountId, accountName: a.name, instrumentId: inst?.id ?? null, name: inst ? `${inst.symbol} · ${inst.name}` : 'Dividends', currency: a.currency, nativeMinor: s(native), baseMinor: b === null ? null : s(b) })
    }
    let dividendsTotal = 0n
    for (const d of dividends) dividendsTotal += BigInt(d.baseMinor ?? '0')
    return {
      baseCurrency: this.base,
      from: start,
      to: this.today,
      complete: flows.complete,
      totals: {
        interestMinor: s(BigInt(flows.incomeMinor) - dividendsTotal),
        dividendsMinor: s(dividendsTotal),
        capitalGrowthMinor: flows.growthMinor,
        feesMinor: flows.feesMinor,
        contributionsMinor: flows.contributionsMinor,
      },
      interestByAccount: perAccount(interest),
      dividends,
      feesByAccount: perAccount(fees),
      months: flows.months,
    }
  }

  netWorthStats(): NetWorthStats {
    const dates = this.historyDates('all')
    const points = dates.map((d) => ({ d, t: this.totalsAt(d) }))
    const months = points.map((p, i) => ({
      month: p.d,
      netWorthMinor: s(p.t.netWorth),
      assetsMinor: s(p.t.assets),
      liabilitiesMinor: s(p.t.liabilities),
      changeMinor: i === 0 || !p.t.complete || !points[i - 1]!.t.complete ? null : s(p.t.netWorth - points[i - 1]!.t.netWorth),
      complete: p.t.complete,
    }))
    const now = this.totalsAt(this.today)
    const yearAgo = fmt(addMonths(parseDateOnly(this.today), -12))
    const first = this.firstDate() ?? this.today
    const then = this.totalsAt(yearAgo < first ? first : yearAgo)
    let highest = points[0] ?? { d: this.today, t: now }
    for (const p of points) if (p.t.complete && p.t.netWorth > highest.t.netWorth) highest = p
    const start = points[0]?.t ?? now
    const yoy = now.complete && then.complete ? now.netWorth - then.netWorth : null
    return {
      baseCurrency: this.base,
      complete: points.every((p) => p.t.complete),
      months,
      yearOverYear: {
        fromDate: yearAgo < first ? first : yearAgo,
        toDate: this.today,
        changeMinor: yoy === null ? null : s(yoy),
        changePercent: yoy === null || then.netWorth === 0n ? null : percentOf(yoy, then.netWorth, 1),
      },
      highest: { date: highest.d, netWorthMinor: s(highest.t.netWorth) },
      sinceStart: {
        startDate: points[0]?.d ?? this.today,
        startMinor: s(start.netWorth),
        changeMinor: s(now.netWorth - start.netWorth),
        changePercent: start.netWorth === 0n ? null : percentOf(now.netWorth - start.netWorth, start.netWorth, 1),
      },
    }
  }

  accountComparison(range: DashboardRange): AccountComparison {
    const from = this.rangeStart(range)
    const rows: AccountComparisonRow[] = this.world.accounts
      .filter((a) => !a.archivedAt)
      .map((a) => {
        const liab = this.isLiability(a)
        const effectiveFrom = a.openedAt > from ? a.openedAt : from
        const periodDays = differenceInCalendarDays(parseDateOnly(this.today), parseDateOnly(effectiveFrom))
        const startV = a.openedAt > from ? 0n : this.valueAt(a.id, from).value
        const endR = this.valueAt(a.id, this.today)
        const startR = this.valueAt(a.id, from)
        let deposits = 0n
        let withdrawals = 0n
        let net = 0n
        for (const t of this.txns(a.id)) {
          if (t.date <= from || t.date > this.today) continue
          const e = txnEffect(t)
          if (t.type === 'deposit' || t.type === 'opening_balance' || (t.type === 'transfer' && e > 0n)) deposits += t.type === 'transfer' ? e : t.amountMinor
          else if (t.type === 'withdrawal' || (t.type === 'transfer' && e < 0n)) withdrawals += t.type === 'transfer' ? -e : t.amountMinor
          else if (t.type === 'interest' || t.type === 'dividend') net += t.amountMinor
          else if (t.type === 'fee') net -= t.amountMinor
        }
        const complete = endR.complete && startR.complete
        let status: AccountComparisonRow['returnStatus'] = 'ok'
        let bps: number | null = null
        if (a.trackingMode === 'positions') status = 'methodology_unavailable'
        else if (liab) status = 'not_applicable'
        else if (!complete) status = 'incomplete'
        else {
          const gain = endR.value - startV - deposits + withdrawals
          const capital = startV + deposits / 2n - withdrawals / 2n
          if (capital > 0n && periodDays > 0) {
            bps = Number(divRound(gain * 10000n * 365n, capital * BigInt(periodDays)))
            if (periodDays < 90) status = 'short_period'
          } else status = 'short_period'
        }
        return {
          accountId: a.id,
          name: a.name,
          currency: a.currency,
          trackingMode: a.trackingMode,
          isLiability: liab,
          periodDays,
          startMinor: startR.complete ? s(startV) : null,
          endMinor: endR.complete ? s(endR.value) : null,
          depositsMinor: s(deposits),
          withdrawalsMinor: s(withdrawals),
          netIncomeMinor: s(net),
          annualizedReturnBps: bps,
          returnStatus: status,
        }
      })
    return { from, to: this.today, rows }
  }

  // ---- account analytics -------------------------------------------------------

  accountHistoryDates(a: AccountRecord): string[] {
    const dates: string[] = []
    let d = startOfMonth(parseDateOnly(a.openedAt))
    while (fmt(d) <= this.today) {
      if (fmt(d) >= a.openedAt) dates.push(fmt(d))
      d = addMonths(d, 1)
    }
    if (dates[0] !== a.openedAt) dates.unshift(a.openedAt)
    // Extra points so valuations and trades land on their own dates.
    for (const v of this.valuations(a.id)) dates.push(v.date)
    for (const e of this.events(a.id)) dates.push(e.date)
    dates.push(this.today)
    return unique(dates.filter((x) => x <= this.today)).sort()
  }

  analytics(accountId: string): AccountAnalytics {
    const a = this.account(accountId)!
    const liab = this.isLiability(a)
    let contributions = 0n
    let withdrawals = 0n
    let income = 0n
    let fees = 0n
    for (const t of this.txns(a.id)) {
      const e = txnEffect(t)
      if (t.type === 'deposit' || t.type === 'opening_balance' || t.type === 'liability_increase' || (t.type === 'transfer' && e > 0n)) contributions += t.type === 'transfer' ? e : t.amountMinor
      else if (t.type === 'withdrawal' || t.type === 'liability_payment' || (t.type === 'transfer' && e < 0n)) withdrawals += t.type === 'transfer' ? -e : t.amountMinor
      else if (t.type === 'interest' || t.type === 'dividend') income += t.amountMinor
      else if (t.type === 'fee') fees += t.amountMinor
    }
    for (const e of this.events(a.id)) fees += e.feeMinor
    const now = this.valueAt(a.id, this.today)
    const growth = now.value - contributions + withdrawals - income + fees
    const history = this.accountHistoryDates(a).map((d) => {
      const v = this.valueAt(a.id, d)
      return { date: d, valueMinor: s(v.value), complete: v.complete }
    })
    let positionSummary: AccountAnalytics['positionSummary'] = null
    if (a.trackingMode === 'positions') {
      const cash = this.cashAt(a.id, this.today)
      let positionsTotal = 0n
      let complete = true
      const positions = [...this.quantitiesAt(a.id, this.today)].map(([instrumentId, qty]) => {
        const inst = this.instrument(instrumentId)!
        const p = this.priceAt(instrumentId, this.today)
        let valueMinor: string | null = null
        let ok = false
        if (p) {
          const native = mulToMinor(fromScaled(qty, 12), p.price, inst.quoteCurrency)
          const conv = this.convert(native, inst.quoteCurrency, a.currency, this.today)
          if (conv !== null) {
            valueMinor = s(conv)
            positionsTotal += conv
            ok = true
          }
        }
        if (!ok) complete = false
        const stale = !!p && differenceInCalendarDays(parseDateOnly(this.today), parseDateOnly(dateOf(p.effectiveDate))) > this.staleDays(inst)
        return {
          instrumentId,
          instrumentName: inst.name,
          instrumentSymbol: inst.symbol ?? '',
          quoteCurrency: inst.quoteCurrency,
          instrumentArchived: !!inst.archivedAt,
          quantity: fromScaled(qty, 8),
          unitPrice: p?.price ?? null,
          priceDate: p ? dateOf(p.effectiveDate) : null,
          priceSource: p?.source ?? 'none',
          valueMinor,
          complete: ok,
          stale,
        }
      })
      positionSummary = { cashMinor: s(cash), positionsMinor: s(positionsTotal), complete, positions }
    }
    const reasons: string[] = []
    if (!now.complete) {
      for (const id of now.missingPrices) reasons.push(`No price recorded for ${this.instrument(id)?.symbol ?? 'an instrument'}`)
      for (const c of unique(now.missingCurrencies)) reasons.push(`Missing ${c} exchange rate`)
    }
    if (a.currency !== this.base && this.convert(1n, a.currency, this.base, this.today) === null) reasons.push(`Missing ${a.currency} → ${this.base} exchange rate`)
    return {
      accountId: a.id,
      currency: a.currency,
      metrics: {
        contributionsMinor: s(contributions),
        withdrawalsMinor: s(withdrawals),
        incomeMinor: s(income),
        feesMinor: s(fees),
        capitalGrowthMinor: s(liab ? 0n : growth),
        estimatedGainMinor: s(liab ? 0n : income - fees + growth),
      },
      positionSummary,
      history,
      historyComplete: history.every((h) => h.complete),
      movementAttributionAvailable: false,
      movementAttribution: null,
      completenessReasons: unique(reasons),
    }
  }

  extras(accountId: string): AccountExtras {
    const a = this.account(accountId)!
    const analytics = this.analytics(accountId)
    const ps = analytics.positionSummary
    const total = ps ? BigInt(ps.cashMinor) + BigInt(ps.positionsMinor) : 0n
    const weights = (ps?.positions ?? []).map((p) => ({
      instrumentId: p.instrumentId,
      name: p.instrumentName,
      symbol: p.instrumentSymbol,
      weightPercent: p.valueMinor === null || total === 0n ? null : percentOf(BigInt(p.valueMinor), total, 1),
    }))
    const held = new Set<string>()
    for (const e of this.events(a.id)) held.add(e.instrumentId)
    const priceHistory = [...held].map((id) => {
      const inst = this.instrument(id)!
      const h = this.instrumentHoldings(id)
      return {
        instrumentId: id,
        name: inst.name,
        symbol: inst.symbol ?? '',
        currency: inst.quoteCurrency,
        staleThresholdDays: this.staleDays(inst),
        points: (this.pricesByInstrument.get(id) ?? []).map((p) => ({ date: dateOf(p.effectiveDate), price: p.price })),
        staleRanges: h.staleRanges,
      }
    })
    return {
      accountId,
      weights,
      cashWeightPercent: ps && total !== 0n ? percentOf(BigInt(ps.cashMinor), total, 1) : null,
      priceHistory,
      linkedGoals: this.world.goals.filter((g) => g.linkedAccountId === accountId).map((g) => ({ id: g.id, name: g.name })),
    }
  }

  instrumentHoldings(instrumentId: string): InstrumentHoldings {
    const inst = this.instrument(instrumentId)!
    const threshold = this.staleDays(inst)
    const prices = (this.pricesByInstrument.get(instrumentId) ?? []).map((p) => dateOf(p.effectiveDate))
    const staleRanges: { from: string; to: string }[] = []
    for (let i = 0; i < prices.length; i++) {
      const cur = prices[i]!
      const next = prices[i + 1] ?? this.today
      const staleFrom = fmt(addDays(parseDateOnly(cur), threshold + 1))
      if (staleFrom < next) staleRanges.push({ from: staleFrom, to: next })
    }
    const holdings = this.world.accounts
      .filter((a) => a.trackingMode === 'positions' && !a.archivedAt)
      .flatMap((a) => {
        const qty = this.quantitiesAt(a.id, this.today).get(instrumentId)
        if (!qty) return []
        const p = this.priceAt(instrumentId, this.today)
        const native = p ? mulToMinor(fromScaled(qty, 12), p.price, inst.quoteCurrency) : null
        return [{ accountId: a.id, accountName: a.name, quantity: fromScaled(qty, 8), valueMinor: native === null ? null : s(native), currency: inst.quoteCurrency }]
      })
    return { instrumentId, staleThresholdDays: threshold, staleRanges, holdings }
  }

  summaries(): AccountSummaryExt[] {
    return this.world.accounts.map((a) => {
      const t = parseDateOnly(this.today)
      const dates: string[] = []
      for (let m = 12; m >= 1; m--) {
        const d = fmt(addMonths(t, -m))
        if (d >= a.openedAt) dates.push(d)
      }
      dates.push(this.today)
      const sparkline = dates.map((d) => {
        const v = this.valueAt(a.id, d)
        return { date: d, valueMinor: s(v.value), complete: v.complete }
      })
      const lastTxn = this.txns(a.id).at(-1)
      const lastVal = this.valuations(a.id).at(-1)
      const lastEvent = this.events(a.id).at(-1)
      const stamps = [lastTxn?.createdAt, lastVal?.createdAt, lastEvent?.createdAt].filter(Boolean) as string[]
      const lastUpdatedAt = stamps.sort().at(-1) ?? `${a.openedAt}T09:00:00Z`
      const v = this.valueAt(a.id, this.today)
      let freshness: Freshness = 'not_applicable'
      let asOfDate = [lastTxn?.date, lastVal?.date, lastEvent?.date].filter(Boolean).sort().at(-1) ?? a.openedAt
      let positionCount: number | null = null
      if (a.trackingMode === 'positions') {
        const qs = this.quantitiesAt(a.id, this.today)
        positionCount = qs.size
        freshness = 'fresh'
        let oldest: string | null = null
        for (const id of qs.keys()) {
          const p = this.priceAt(id, this.today)
          if (!p) {
            freshness = 'missing'
            continue
          }
          const pd = dateOf(p.effectiveDate)
          if (!oldest || pd < oldest) oldest = pd
          const inst = this.instrument(id)!
          if (freshness !== 'missing' && differenceInCalendarDays(t, parseDateOnly(pd)) > this.staleDays(inst)) freshness = 'stale'
        }
        if (oldest) asOfDate = oldest
      } else if (this.valuations(a.id).length > 0) {
        asOfDate = lastVal!.date
        freshness = differenceInCalendarDays(t, parseDateOnly(asOfDate)) > 365 ? 'stale' : 'fresh'
      }
      const bv = this.baseValueAt(a.id, this.today)
      return {
        accountId: a.id,
        sparkline,
        positionCount,
        lastUpdatedAt,
        asOfDate,
        freshness,
        valueComplete: v.complete,
        missingPrices: v.missingPrices.map((id) => ({ instrumentId: id, name: this.instrument(id)?.name ?? 'Unknown instrument' })),
        missingCurrencies: bv.missingCurrencies,
        linkedGoals: this.world.goals.filter((g) => g.linkedAccountId === a.id).map((g) => ({ id: g.id, name: g.name })),
      }
    })
  }

  // ---- activity ----------------------------------------------------------------

  activityItems(): (ActivityItem & { seq: number })[] {
    return this.memo('activity', () => {
      const items: (ActivityItem & { seq: number })[] = []
      for (const a of this.world.accounts) {
        for (const t of this.txns(a.id)) {
          const inst = t.instrumentId ? this.instrument(t.instrumentId) : undefined
          items.push({
            kind: 'transaction',
            id: t.id,
            accountId: a.id,
            accountName: a.name,
            type: t.type,
            amountMinor: s(t.amountMinor),
            effectMinor: s(txnEffect(t)),
            currency: a.currency,
            date: t.date,
            description: t.description,
            notes: t.notes,
            instrumentId: inst?.id,
            instrumentName: inst?.name,
            instrumentSymbol: inst?.symbol ?? undefined,
            eventGroupId: t.transferGroupId,
            seq: t.seq,
          })
        }
        for (const v of this.valuations(a.id)) {
          items.push({ kind: 'valuation', id: v.id, accountId: a.id, accountName: a.name, type: 'valuation', amountMinor: s(v.valueMinor), currency: a.currency, date: v.date, description: v.notes ?? 'Value updated', seq: v.seq })
        }
        for (const e of this.events(a.id)) {
          const inst = this.instrument(e.instrumentId)
          items.push({
            kind: 'position',
            id: e.id,
            accountId: a.id,
            accountName: a.name,
            type: e.type,
            amountMinor: s(e.cashEffectMinor),
            effectMinor: s(e.cashEffectMinor),
            currency: a.currency,
            date: e.date,
            description: e.description,
            notes: e.notes,
            instrumentId: e.instrumentId,
            instrumentName: inst?.name,
            instrumentSymbol: inst?.symbol ?? undefined,
            quantity: e.quantity,
            unitPrice: e.unitPrice,
            seq: e.seq,
          })
        }
        if (a.trackingMode === 'positions') {
          const held = new Set(this.events(a.id).map((e) => e.instrumentId))
          for (const id of held) {
            const inst = this.instrument(id)
            for (const p of this.pricesByInstrument.get(id) ?? []) {
              const d = dateOf(p.effectiveDate)
              if (!this.quantitiesAt(a.id, d).get(id)) continue
              items.push({
                kind: 'price',
                id: `${p.id}`,
                accountId: a.id,
                accountName: a.name,
                type: 'price_update',
                amountMinor: '0',
                currency: p.currency,
                date: d,
                description: `${inst?.symbol ?? inst?.name} price updated`,
                instrumentId: id,
                instrumentName: inst?.name,
                instrumentSymbol: inst?.symbol ?? undefined,
                unitPrice: p.price,
                seq: 0,
              })
            }
          }
        }
      }
      items.sort((x, y) => (x.date === y.date ? y.seq - x.seq : x.date < y.date ? 1 : -1))
      return items
    })
  }

  activity(q: ActivityQuery): ActivityPage {
    const limit = q.limit ?? 50
    const offset = q.offset ?? 0
    const needle = q.q?.trim().toLowerCase()
    const filtered = this.activityItems().filter(
      (i) =>
        (!q.kind || i.kind === q.kind) &&
        (!q.accountId || i.accountId === q.accountId) &&
        (!q.type || i.type === q.type) &&
        (!q.from || i.date >= q.from) &&
        (!q.to || i.date <= q.to) &&
        (!needle || [i.description, i.accountName, i.instrumentName, i.instrumentSymbol, i.type, i.notes].some((f) => f?.toLowerCase().includes(needle))),
    )
    const items = filtered.slice(offset, offset + limit).map(({ seq: _seq, ...rest }) => rest)
    return { items, limit, offset, hasMore: offset + limit < filtered.length }
  }

  // ---- goals -------------------------------------------------------------------

  goalCurrent(g: GoalRecord): { value: bigint; complete: boolean; missing: string[] } {
    if (!g.linkedAccountId) return { value: g.manualCurrentMinor, complete: true, missing: [] }
    const a = this.account(g.linkedAccountId)
    if (!a) return { value: g.manualCurrentMinor, complete: true, missing: [] }
    const v = this.valueAt(a.id, this.today)
    const c = this.convert(v.value, a.currency, g.currency, this.today)
    if (c === null) return { value: 0n, complete: false, missing: [a.currency] }
    return { value: c, complete: v.complete, missing: v.missingCurrencies }
  }

  monthlyContribution(g: GoalRecord): bigint {
    switch (g.frequency) {
      case 'weekly':
        return divRound(g.plannedContributionMinor * 52n, 12n)
      case 'quarterly':
        return divRound(g.plannedContributionMinor, 3n)
      case 'annually':
        return divRound(g.plannedContributionMinor, 12n)
      default:
        return g.plannedContributionMinor
    }
  }

  monthsUntil(date: string): number {
    const t = parseDateOnly(this.today)
    const d = parseDateOnly(date)
    return Math.max(0, (d.getFullYear() - t.getFullYear()) * 12 + (d.getMonth() - t.getMonth()))
  }

  /** Monthly compounding, end-of-month contributions. */
  project(start: bigint, monthly: bigint, bps: number, months: number): bigint {
    let v = start
    for (let i = 0; i < months; i++) v = divRound(v * (120000n + BigInt(bps)), 120000n) + monthly
    return v
  }

  scenario(g: GoalRecord, current: bigint, monthly: bigint, bps: number): GoalScenario {
    const n = this.monthsUntil(g.targetDate)
    const projected = this.project(current, monthly, bps, n)
    let completion: string | null = null
    let v = current
    for (let i = 0; i <= 600; i++) {
      if (v >= g.targetMinor) {
        completion = fmt(addMonths(startOfMonth(parseDateOnly(this.today)), i + 1)) // end of month i ≈ first of next
        completion = fmt(addDays(parseDateOnly(completion), -1))
        if (i === 0) completion = this.today
        break
      }
      v = divRound(v * (120000n + BigInt(bps)), 120000n) + monthly
      if (monthly === 0n && bps === 0) break
    }
    const newContributions = monthly * BigInt(n)
    return {
      monthlyContributionMinor: s(monthly),
      annualReturnBps: bps,
      projectedAtTargetMinor: s(projected),
      projectedProgressPercent: percentOf(projected, g.targetMinor, 1),
      newContributionsMinor: s(newContributions),
      estimatedGrowthMinor: s(projected - current - newContributions),
      estimatedCompletion: completion,
      reachesTarget: projected >= g.targetMinor,
    }
  }

  requiredMonthly(g: GoalRecord, current: bigint, bps: number): bigint {
    const n = this.monthsUntil(g.targetDate)
    if (n === 0) return g.targetMinor > current ? g.targetMinor - current : 0n
    if (this.project(current, 0n, bps, n) >= g.targetMinor) return 0n
    let lo = 0n
    let hi = g.targetMinor
    while (hi - lo > 1n) {
      const mid = (lo + hi) / 2n
      if (this.project(current, mid, bps, n) >= g.targetMinor) hi = mid
      else lo = mid
    }
    // Round up to a whole currency unit for a friendlier plan.
    const unit = 10n ** BigInt(Math.max(0, minorExp(g.currency)))
    return ((hi + unit - 1n) / unit) * unit
  }

  goalScenarios(g: GoalRecord, override?: { monthly?: bigint; bps?: number }): GoalScenarios {
    const cur = this.goalCurrent(g).value
    const monthly = override?.monthly ?? this.monthlyContribution(g)
    const bps = override?.bps ?? g.assumedAnnualReturnBps
    return {
      savedPlan: this.scenario(g, cur, monthly, bps),
      requiredPace: this.scenario(g, cur, this.requiredMonthly(g, cur, bps), bps),
      lowerReturn: this.scenario(g, cur, monthly, Math.max(0, bps - 300)),
    }
  }

  toGoal(g: GoalRecord, withScenarios = true): Goal {
    const cur = this.goalCurrent(g)
    const monthly = this.monthlyContribution(g)
    const n = this.monthsUntil(g.targetDate)
    const projection = [] as Goal['projection']
    let v = cur.value
    let contrib = cur.value
    const base = startOfMonth(parseDateOnly(this.today))
    projection.push({ date: tsOf(this.today), projectedMinor: s(v), contributionsMinor: s(contrib), targetMinor: s(g.targetMinor) })
    for (let i = 1; i <= n; i++) {
      v = divRound(v * (120000n + BigInt(g.assumedAnnualReturnBps)), 120000n) + monthly
      contrib += monthly
      const d = fmt(addDays(addMonths(base, i), -1))
      projection.push({ date: tsOf(d > g.targetDate ? g.targetDate : d), projectedMinor: s(v), contributionsMinor: s(contrib), targetMinor: s(g.targetMinor) })
    }
    const sc = this.goalScenarios(g)
    const tracking: Goal['trackingStatus'] = !cur.complete ? 'incomplete' : sc.savedPlan.reachesTarget || cur.value >= g.targetMinor ? 'on_track' : 'behind'
    const linked = g.linkedAccountId ? this.account(g.linkedAccountId) : undefined
    return {
      id: g.id,
      name: g.name,
      description: g.description,
      targetAmountMinor: s(g.targetMinor),
      currentAmountMinor: s(cur.value),
      currentAmountCurrency: g.currency,
      currency: g.currency,
      targetDate: g.targetDate,
      linkedAccount: linked ? { id: linked.id, name: linked.name, currency: linked.currency } : null,
      icon: g.icon,
      status: g.status,
      priority: g.priority,
      assumedAnnualReturnBps: g.assumedAnnualReturnBps,
      progressPercent: g.targetMinor === 0n ? '0' : percentOf(cur.value, g.targetMinor, 1),
      trackingStatus: tracking,
      valueIncomplete: !cur.complete,
      missingCurrencies: cur.missing,
      plan: { plannedContributionMinor: s(g.plannedContributionMinor), frequency: g.frequency, startDate: g.planStartDate, endDate: g.planEndDate },
      projection,
      scenarios: withScenarios ? sc : null,
    }
  }

  milestones(goalId: string): GoalMilestone[] {
    const g = this.world.goals.find((x) => x.id === goalId)!
    const cur = this.goalCurrent(g).value
    return this.world.milestones
      .filter((m) => m.goalId === goalId)
      .sort((a, b) => (a.targetMinor < b.targetMinor ? -1 : 1))
      .map((m) => {
        const reached = cur >= m.targetMinor
        const status = reached ? 'reached' : m.targetDate && m.targetDate < this.today ? 'overdue' : 'upcoming'
        return {
          id: m.id,
          goalId,
          name: m.name,
          targetAmountMinor: s(m.targetMinor),
          targetDate: m.targetDate,
          status,
          progressPercent: percentOf(cur > m.targetMinor ? m.targetMinor : cur, m.targetMinor, 1),
          remainingMinor: reached ? null : s(m.targetMinor - cur),
        }
      })
  }

  alertKey(goalId: string): string {
    return `${goalId}:${this.today.slice(0, 7)}`
  }

  alerts(): GoalAlert[] {
    return this.world.goals
      .filter((g) => g.status === 'active')
      .map((g) => this.toGoal(g, false))
      .filter((g) => g.trackingStatus === 'behind' && !this.world.dismissedAlerts.has(this.alertKey(g.id)))
      .map((g) => ({
        goalId: g.id,
        goalName: g.name,
        currency: g.currency,
        targetAmountMinor: g.targetAmountMinor,
        currentAmountMinor: g.currentAmountMinor,
        progressPercent: g.progressPercent,
        targetDate: g.targetDate,
        alertKey: this.alertKey(g.id),
        assumedAnnualReturnBps: g.assumedAnnualReturnBps,
      }))
  }

  // ---- attention ---------------------------------------------------------------

  attention(): AttentionSummary {
    return this.memo('attention', () => {
      const items: AttentionItem[] = []
      const now = this.totalsAt(this.today)
      const t = parseDateOnly(this.today)
      // Missing and stale exchange rates for currencies in use.
      const used = new Map<string, string[]>()
      for (const a of this.world.accounts) {
        if (a.archivedAt || a.currency === this.base) continue
        used.set(a.currency, [...(used.get(a.currency) ?? []), a.id])
      }
      for (const [ccy, accountIds] of used) {
        const r = this.rateAt(ccy, this.base, this.today)
        const firstUse = accountIds.map((id) => this.account(id)!.openedAt).sort()[0]
        if (!r) {
          items.push({
            id: `missing_rate:${ccy}`,
            kind: 'missing_rate',
            severity: 'warning',
            title: `${ccy} → ${this.base} exchange rate missing`,
            detail: `Values held in ${ccy} can't be included in your ${this.base} totals until you add a rate.`,
            pair: { base: ccy, quote: this.base },
            accountIds,
            since: firstUse,
            until: this.today,
            fix: { label: `Add ${ccy}/${this.base} rate`, href: `/settings/currencies?add=${ccy}-${this.base}` },
          })
        } else if (differenceInCalendarDays(t, parseDateOnly(r.date)) > 31) {
          items.push({
            id: `stale_rate:${ccy}`,
            kind: 'stale_rate',
            severity: 'info',
            title: `${ccy} → ${this.base} rate is ${differenceInCalendarDays(t, parseDateOnly(r.date))} days old`,
            detail: 'Older rates still count, but your totals may drift from reality.',
            pair: { base: ccy, quote: this.base },
            accountIds,
            since: r.date,
            fix: { label: 'Update rate', href: `/settings/currencies?add=${ccy}-${this.base}` },
          })
        }
      }
      // EUR is enabled with an old rate but no accounts; still surface it as informational.
      for (const ccy of this.world.settings.supportedCurrencies) {
        if (ccy === this.base || used.has(ccy)) continue
        const r = this.rateAt(ccy, this.base, this.today)
        if (r && differenceInCalendarDays(t, parseDateOnly(r.date)) > 31) {
          items.push({
            id: `stale_rate:${ccy}`,
            kind: 'stale_rate',
            severity: 'info',
            title: `${ccy} → ${this.base} rate is ${differenceInCalendarDays(t, parseDateOnly(r.date))} days old`,
            detail: 'No accounts use it yet, so totals are unaffected.',
            pair: { base: ccy, quote: this.base },
            accountIds: [],
            since: r.date,
            fix: { label: 'Update rate', href: `/settings/currencies?add=${ccy}-${this.base}` },
          })
        }
      }
      // Prices.
      for (const a of this.world.accounts) {
        if (a.trackingMode !== 'positions' || a.archivedAt) continue
        for (const id of this.quantitiesAt(a.id, this.today).keys()) {
          const inst = this.instrument(id)!
          const p = this.priceAt(id, this.today)
          const existing = items.find((i) => i.instrumentId === id)
          if (existing) {
            existing.accountIds.push(a.id)
            continue
          }
          if (!p) {
            items.push({
              id: `missing_price:${id}`,
              kind: 'missing_price',
              severity: 'warning',
              title: `No price for ${inst.symbol ?? inst.name}`,
              detail: `${inst.name} is held but has never been priced, so its value is left out of totals.`,
              instrumentId: id,
              accountIds: [a.id],
              since: this.events(a.id).find((e) => e.instrumentId === id)?.date,
              fix: { label: 'Add a price', href: `/instruments/${id}?addPrice=1` },
            })
          } else {
            const age = differenceInCalendarDays(t, parseDateOnly(dateOf(p.effectiveDate)))
            if (age > this.staleDays(inst)) {
              items.push({
                id: `stale_price:${id}`,
                kind: 'stale_price',
                severity: 'warning',
                title: `${inst.symbol ?? inst.name} price is ${age} days old`,
                detail: `Prices older than ${this.staleDays(inst)} days are marked stale for ${inst.assetType === 'etf' ? 'ETFs' : inst.assetType === 'fund' ? 'funds' : 'stocks'}.`,
                instrumentId: id,
                accountIds: [a.id],
                since: dateOf(p.effectiveDate),
                fix: { label: 'Update price', href: `/instruments/${id}?addPrice=1` },
              })
            }
          }
        }
      }
      for (const alert of this.alerts()) {
        items.push({
          id: `goal_behind:${alert.goalId}`,
          kind: 'goal_behind',
          severity: 'info',
          title: `${alert.goalName} is behind plan`,
          detail: 'At the current pace the target date will pass before the goal is reached.',
          goalId: alert.goalId,
          accountIds: [],
          fix: { label: 'Review goal', href: `/goals/${alert.goalId}` },
        })
      }
      return { totalsComplete: now.complete, items }
    })
  }

  // ---- settings ----------------------------------------------------------------

  settingsRead(authHasPassword: boolean): SettingsRead {
    const referenced = unique(this.world.accounts.map((a) => a.currency).concat(this.world.instruments.map((i) => i.quoteCurrency)))
    return {
      settings: this.world.settings,
      currencyConfiguration: { baseCurrency: this.base, enabledCurrencies: this.world.settings.supportedCurrencies, referencedCurrencies: referenced },
      exchangeRates: [...this.world.rates].sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : -1)),
      authMethods: { status: 'active', hasPassword: authHasPassword, oidcIdentities: [] },
    }
  }

  instrumentsWithLatest(): Instrument[] {
    return this.world.instruments.map((i) => ({ ...i, latestPrice: this.latestPrice(i.id) }))
  }

  minorToMajor(minor: bigint, currency: string): string {
    return minorToMajor(minor, currency)
  }
}

function minorExp(currency: string): number {
  return ['BIF', 'JPY', 'RWF', 'UGX'].includes(currency) ? 0 : ['BHD', 'KWD', 'OMR'].includes(currency) ? 3 : 2
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function toAllocation(buckets: Map<string, bigint>, total: bigint): AllocationItem[] {
  return [...buckets.entries()]
    .sort((a, b) => (a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1))
    .map(([name, v]) => ({ name, valueMinor: v.toString(), sharePercent: total === 0n ? '0' : percentOf(v, total, 2) }))
}
