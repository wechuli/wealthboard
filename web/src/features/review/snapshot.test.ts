import { describe, expect, it } from 'vitest'
import type { Account, Dashboard, Goal, ReportAllocation } from '@/api/types'
import { configurationHash } from './ai-meta'
import { parseDraft, draftFile } from './draft'
import { buildReviewSnapshot, evidenceIndex, evidenceLabel, snapshotBytes } from './snapshot'

const dashboard = {
  asOf: '2026-09-20',
  baseCurrency: 'KES',
  totals: { netWorth: '123456700' },
  accountCount: 2,
  goalCount: 1,
  currentComplete: false,
  historicalComplete: true,
  missingCurrencies: ['USD'],
  valueBasis: 'effective_dated_replay',
} as unknown as Dashboard

const allocation = {
  categories: [{ name: 'Fixed Income', valueMinor: '90000000', sharePercent: '72.90' }],
  currencies: [{ name: 'KES', valueMinor: '90000000', sharePercent: '100.00' }],
  institutions: [{ name: 'Zimele', valueMinor: '90000000', sharePercent: '100.00' }],
  instruments: [{ name: 'VWRA', valueMinor: '1', sharePercent: '0.01' }],
} as unknown as ReportAllocation

const accounts = [
  { id: 'a', name: 'Small Wallet', currency: 'KES', currentValueMinor: '100', convertedValueMinor: '100', categoryName: 'Cash', trackingMode: 'balance', isLiability: false },
  { id: 'b', name: 'Zimele Fund', currency: 'KES', currentValueMinor: '90000000', convertedValueMinor: '90000000', categoryName: 'Fixed Income', trackingMode: 'balance', isLiability: false },
  { id: 'c', name: 'Brokerage', currency: 'USD', currentValueMinor: '5000', convertedValueMinor: null, categoryName: 'Securities', trackingMode: 'positions', isLiability: false },
  { id: 'd', name: 'Old Sacco', currency: 'KES', currentValueMinor: '1', convertedValueMinor: '1', categoryName: 'Cash', trackingMode: 'balance', isLiability: false, archivedAt: '2026-01-01T00:00:00Z' },
] as unknown as Account[]

const goals = [
  { name: 'Family Car', status: 'active', trackingStatus: 'behind', progressPercent: '3.68', targetDate: '2028-07-01', valueIncomplete: false, currency: 'KES', targetAmountMinor: '325000000', currentAmountMinor: '11961700' },
] as unknown as Goal[]

const reads = { dashboard, allocation, goals, accounts }

describe('review snapshot', () => {
  it('is pseudonymous and amount-free by default', () => {
    const s = buildReviewSnapshot({ period: '1y', focus: 'overall', sharing: { includeExactAmounts: false, includeAccountNames: false }, asOf: 'now' }, reads)
    const json = JSON.stringify(s)
    expect(json).not.toMatch(/Wallet|Zimele Fund|Brokerage|Family Car|Old Sacco|Zimele"/)
    expect(json).not.toMatch(/Minor/)
    expect(json).not.toContain('VWRA')
    expect(s.topAccounts).toHaveLength(3)
    // Largest first; a missing exchange rate sorts last and is flagged.
    expect(s.topAccounts[0]).toMatchObject({ evidenceId: 'account-1', alias: 'Account 1', category: 'Fixed Income' })
    expect(s.topAccounts[2]).toMatchObject({ category: 'Securities', valueComplete: false })
    expect(s.dataQuality).toEqual([{ evidenceId: 'data-quality-1', message: 'Missing exchange rate for USD' }])
    expect(s.goals[0]).toMatchObject({ alias: 'Goal 1', tracking: 'behind', progressPercent: '3.68' })
    expect(s.portfolio).toEqual({ evidenceId: 'portfolio.totals', accountCount: 2, goalCount: 1 })
  })

  it('adds names and exact amounts only with consent', () => {
    const s = buildReviewSnapshot({ period: '3m', focus: 'goals', sharing: { includeExactAmounts: true, includeAccountNames: true } }, reads)
    expect(s.sharing).toEqual({ exactAmounts: true, includeExactAmounts: true, includeAccountNames: true })
    expect(s.portfolio).toMatchObject({ totals: { netWorth: '123456700' } })
    expect(s.topAccounts[0]).toMatchObject({ name: 'Zimele Fund', valueMinor: '90000000' })
    expect(JSON.stringify(s.allocations)).toContain('"institution-1"')
    expect(snapshotBytes(s)).toBeLessThan(25_000)
  })

  it('labels evidence references from the snapshot', () => {
    const s = buildReviewSnapshot({ period: '1y', focus: 'overall', sharing: { includeExactAmounts: false, includeAccountNames: false } }, reads)
    const index = evidenceIndex(s)
    expect(evidenceLabel('category-1', index)).toBe('Fixed Income · 72.90%')
    expect(evidenceLabel('goal-1', index)).toBe('Goal 1 · 3.68% complete')
    expect(evidenceLabel('account-2', index)).toBe('Account 2')
    expect(evidenceLabel('data-quality-1', index)).toBe('Missing exchange rate for USD')
    expect(evidenceLabel('portfolio.totals', index)).toBe('Portfolio totals')
    expect(evidenceLabel('unknown-ref', index)).toBe('unknown-ref')
  })
})

describe('conversion helpers', () => {
  it('fingerprints settings exactly like the server', async () => {
    // Vector produced by the Go configurationHash for the same inputs.
    const hash = await configurationHash(
      { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.5', maxOutputTokens: 1200, updatedAt: '2026-11-03T05:59:30.783497Z' },
      'balance',
      'KES',
    )
    expect(hash).toBe('f3ca968315dce0b3868e8acd296f7f6ee47da6ed6682e7349c4fbe3db381cfa5')
  })

  it('reads the draft envelope and names the download by content', () => {
    const content = JSON.stringify({ format: 'wealthboard-account-history', version: 1, transactions: [{ external_id: 'x', type: 'deposit', amount: '10.00', date: '2026-09-01', description: null, notes: null }] })
    expect(parseDraft(content)?.collections).toEqual([{ name: 'transactions', records: [expect.objectContaining({ type: 'deposit' })] }])
    expect(draftFile(content, 'Equity Bank / Savings')).toEqual({ name: 'Equity Bank  Savings AI draft.json', type: 'application/json' })
    expect(parseDraft('external_id,type')).toBeNull()
    expect(draftFile('external_id,type', 'M-Pesa')).toEqual({ name: 'M-Pesa AI draft.csv', type: 'text/csv' })
  })
})
