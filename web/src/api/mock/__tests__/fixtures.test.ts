import { describe, expect, it } from 'vitest'
import { Engine } from '../engine'
import { fullWorld, IDS } from '../fixtures'

describe('mock fixtures', () => {
  const e = new Engine(fullWorld('full'))
  it('hits the anchor values exactly', () => {
    const v = (id: string) => e.valueAt(id, e.today).value.toString()
    expect(v(IDS.zimele)).toBe('457691800')
    expect(v(IDS.madison)).toBe('139600000')
    expect(v(IDS.kcbCar)).toBe('11961700')
    expect(v(IDS.ibkr)).toBe('411100')
    expect(v(IDS.land)).toBe('500000000')
    expect(v(IDS.honda)).toBe('75000000')
    expect(e.baseValueAt(IDS.ibkr, e.today).value?.toString()).toBe('53134675')
    expect(v(IDS.faida)).toBe('16476000')
    expect(v(IDS.loan)).toBe('42000000')
  })
  it('produces a complete dashboard whose history ends at today', () => {
    const d = e.dashboard('1y')
    expect(d.currentComplete).toBe(true)
    expect(d.history.at(-1)?.netWorthMinor).toBe(d.totals.netWorth)
    const f = e.flowsReport('1y')
    const sum = BigInt(f.startValueMinor) + BigInt(f.contributionsMinor) + BigInt(f.incomeMinor) + BigInt(f.growthMinor) - BigInt(f.withdrawalsMinor) - BigInt(f.feesMinor)
    expect(sum.toString()).toBe(f.endValueMinor)
  })
  it('marks the family car goal as behind', () => {
    const g = e.world.goals.find((x) => x.id === IDS.goalCar)!
    expect(e.toGoal(g).trackingStatus).toBe('behind')
    expect(e.alerts().map((a) => a.goalId)).toContain(IDS.goalCar)
  })
  it('flags incomplete data in the incomplete scenario', () => {
    const inc = new Engine(fullWorld('incomplete'))
    const d = inc.dashboard('1y')
    expect(d.currentComplete).toBe(false)
    expect(d.missingCurrencies).toContain('USD')
    expect(d.periodChanges.oneMonth).toBeNull()
    expect(inc.attention().items.map((i) => i.kind)).toEqual(expect.arrayContaining(['missing_rate', 'missing_price']))
  })
})
