import { describe, expect, it } from 'vitest'
import type { EstateSnapshot } from '@/api/types'
import { bpsToInput, calendarDate, describeTier, parsePercent, projectedTierTotal, tierState } from './model'
import { normalizeSnapshot } from './snapshot'

describe('allocation tiers in basis points', () => {
  const rows = [
    { beneficiaryId: 'a', tier: 'primary' as const, allocationBps: 6000 },
    { beneficiaryId: 'b', tier: 'primary' as const, allocationBps: 3333 },
    { beneficiaryId: 'c', tier: 'contingent' as const, allocationBps: 10000 },
  ]

  it('describes under, exact, and over totals exactly', () => {
    expect(describeTier(tierState(0))).toBe('Nothing allocated yet')
    expect(describeTier(tierState(9333))).toBe('93.33% allocated · 6.67% remaining')
    expect(describeTier(tierState(10000))).toBe('100% allocated')
    expect(describeTier(tierState(10001))).toBe('100.01% allocated · 0.01% over')
  })

  it('projects an upsert by replacing the same beneficiary in the same tier', () => {
    expect(projectedTierTotal(rows, 'primary', 'c', 667)).toBe(10000)
    expect(projectedTierTotal(rows, 'primary', 'a', 1000)).toBe(4333)
    expect(projectedTierTotal(rows, 'contingent', 'a', 1)).toBe(10001)
  })

  it('parses percentages without floating-point drift', () => {
    expect(parsePercent('33.33')).toEqual({ ok: true, bps: 3333 })
    expect(parsePercent('0.01')).toEqual({ ok: true, bps: 1 })
    expect(parsePercent('100')).toEqual({ ok: true, bps: 10000 })
    expect(parsePercent('12.345')).toEqual({ ok: false, message: 'Use at most two decimal places' })
    expect(parsePercent('0').ok).toBe(false)
    expect(parsePercent('100.01').ok).toBe(false)
    expect(parsePercent('abc').ok).toBe(false)
    expect(bpsToInput(3333)).toBe('33.33')
    expect(bpsToInput(10000)).toBe('100')
  })

  it('recovers calendar dates the server echoes with a local offset', () => {
    expect(calendarDate('2026-10-01T03:00:00+03:00')).toBe('2026-10-01')
    expect(calendarDate('2026-10-15T00:00:00Z')).toBe('2026-10-15')
    expect(calendarDate('2026-10-15')).toBe('2026-10-15')
    expect(calendarDate(null)).toBe('')
  })
})

describe('snapshot content', () => {
  const meta = {
    id: 'snap-1',
    estatePlanId: 'plan-1',
    version: 1,
    title: 'Fictional family plan',
    valueAsOfDate: '2026-11-03T00:00:00Z',
    baseCurrency: 'KES',
    contentHash: 'abc123',
    generatedAt: '2026-11-03T05:57:13Z',
  }

  it('reads the Go server summary format', () => {
    const doc = normalizeSnapshot({
      ...meta,
      content: {
        format: 'wealthboard-estate-summary',
        version: 1,
        valueAsOfDate: '2026-11-03',
        ownerDisplayName: 'Fictional Owner',
        plan: { title: 'Fictional family plan', jurisdiction: 'Kenya', lastReviewedDate: null, reviewReminderDate: null },
        baseCurrency: 'KES',
        beneficiaries: [{ id: 'b1', kind: 'trust', name: 'Fictional Trust', relationship: 'Trust', contactSummary: 'trustee@example.test', notes: null, archivedAt: null }],
        assets: [
          { id: 'acc-1', name: 'Fictional Land', currency: 'KES', currentValueMinor: '500000000', archivedAt: null, directive: null, allocations: [] },
          {
            id: 'acc-2',
            name: 'Fictional Fund',
            currency: 'KES',
            currentValueMinor: '1000',
            archivedAt: null,
            directive: { id: 'd1', isIncluded: true, ownershipShareBps: 5000, transferContext: 'estate', distributionMethod: 'sell_and_divide', documentReference: 'Safe', notes: null, reviewedAt: null },
            allocations: [{ id: 'x1', tier: 'primary', notes: null, allocationBps: 10000, beneficiaryId: 'b1' }],
          },
        ],
        liabilities: [{ id: 'l1', name: 'Fictional Loan', currency: 'KES', valueMinor: '250000' }],
        residuaryAllocations: [{ id: 'r1', tier: 'primary', notes: null, allocationBps: 10000, beneficiaryId: 'b1' }],
        reviewItems: [],
        accountsWarning: 'Cached values.',
        disclaimer: 'Planning record only.',
      },
    } satisfies EstateSnapshot)
    expect(doc).toMatchObject({ ownerDisplayName: 'Fictional Owner', jurisdiction: 'Kenya', valueAsOfDate: '2026-11-03', accountsWarning: 'Cached values.', disclaimer: 'Planning record only.' })
    expect(doc.assets[0]?.directive).toBeNull()
    expect(doc.assets[1]).toMatchObject({ valueMinor: '1000', directive: { ownershipShareBps: 5000, documentReference: 'Safe' }, allocations: [{ beneficiaryId: 'b1', allocationBps: 10000 }] })
    expect(doc.liabilities).toEqual([{ id: 'l1', name: 'Fictional Loan', currency: 'KES', valueMinor: '250000' }])
    expect(doc.beneficiaries[0]).toMatchObject({ name: 'Fictional Trust', contactSummary: 'trustee@example.test', archived: false })
  })

  it('reads workspace-shaped content and tolerates missing fields', () => {
    const doc = normalizeSnapshot({
      ...meta,
      content: {
        plan: { title: 'Fictional family plan' },
        beneficiaries: [],
        directives: [
          { id: 'd1', accountId: 'acc-1', accountName: 'Fictional Land', currency: 'KES', currentValueMinor: '42', isLiability: false, accountArchivedAt: null, isIncluded: true, ownershipShareBps: 10000, transferContext: 'unknown', distributionMethod: 'undecided' },
          { id: 'd2', accountId: 'acc-2', accountName: 'Fictional Loan', currency: 'KES', currentValueMinor: '7', isLiability: true },
        ],
        allocations: [{ id: 'x1', directiveId: 'd1', beneficiaryId: 'b1', tier: 'contingent', allocationBps: 2500 }],
        residuaryAllocations: [],
      },
    })
    expect(doc.assets).toHaveLength(1)
    expect(doc.assets[0]).toMatchObject({ name: 'Fictional Land', valueMinor: '42', allocations: [{ tier: 'contingent', allocationBps: 2500 }] })
    expect(doc.liabilities).toEqual([{ id: 'acc-2', name: 'Fictional Loan', currency: 'KES', valueMinor: '7' }])
    expect(doc.valueAsOfDate).toBe('2026-11-03')
    expect(doc.disclaimer).toMatch(/not a legally executed will/)
    expect(normalizeSnapshot({ ...meta, content: null }).assets).toEqual([])
  })
})
