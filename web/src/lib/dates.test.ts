import { describe, expect, it } from 'vitest'
import { daysBetween, formatDate, formatDateTime, relativeDays, todayISO } from './dates'

describe('date formatting', () => {
  it('formats calendar dates in every supported format without timezone shifts', () => {
    expect(formatDate('2026-03-05', 'dd MMM yyyy')).toBe('05 Mar 2026')
    expect(formatDate('2026-03-05', 'dd/MM/yyyy')).toBe('05/03/2026')
    expect(formatDate('2026-03-05', 'MM/dd/yyyy')).toBe('03/05/2026')
    expect(formatDate('2026-03-05', 'yyyy-MM-dd')).toBe('2026-03-05')
    expect(formatDate('2026-03-05', 'dd MMM yyyy', 'America/Los_Angeles')).toBe('05 Mar 2026')
  })
  it('converts UTC timestamps into the user timezone', () => {
    expect(formatDate('2026-03-04T22:30:00Z', 'dd MMM yyyy', 'Africa/Nairobi')).toBe('05 Mar 2026')
    expect(formatDate('2026-03-04T22:30:00Z', 'dd MMM yyyy', 'America/New_York')).toBe('04 Mar 2026')
    expect(formatDateTime('2026-03-04T22:30:00Z', 'yyyy-MM-dd', 'Africa/Nairobi')).toBe('2026-03-05, 01:30')
  })
  it('computes today in the user timezone', () => {
    const now = Date.parse('2026-11-01T22:30:00Z')
    expect(todayISO('Africa/Nairobi', now)).toBe('2026-11-02')
    expect(todayISO('UTC', now)).toBe('2026-11-01')
  })
  it('describes relative days', () => {
    expect(relativeDays('2026-11-02', '2026-11-02')).toBe('Today')
    expect(relativeDays('2026-11-01', '2026-11-02')).toBe('Yesterday')
    expect(relativeDays('2026-10-23', '2026-11-02')).toBe('10 days ago')
    expect(relativeDays('2026-09-23', '2026-11-02')).toBe('6 weeks ago')
    expect(daysBetween('2026-09-23', '2026-11-02')).toBe(40)
  })
})
