import { describe, expect, it } from 'vitest'
import { decimalToMinor, formatBps, formatDecimal, formatMoney, formatPercent, maskedMoney, minorExponent, minorToDecimal, percentToBps, PrecisionError, toChartNumber } from './money'

const NBSP = '\u00a0'
const MINUS = '\u2212'

describe('minor-unit exponents', () => {
  it('matches the backend: 0, 3, otherwise 2', () => {
    for (const c of ['BIF', 'JPY', 'RWF', 'UGX']) expect(minorExponent(c)).toBe(0)
    for (const c of ['BHD', 'KWD', 'OMR']) expect(minorExponent(c)).toBe(3)
    for (const c of ['KES', 'USD', 'TZS', 'ETB']) expect(minorExponent(c)).toBe(2)
  })
})

describe('minorToDecimal', () => {
  it('converts exactly with string operations', () => {
    expect(minorToDecimal('457691800', 'KES')).toBe('4576918.00')
    expect(minorToDecimal('-1250', 'KES')).toBe('-12.50')
    expect(minorToDecimal('5', 'KES')).toBe('0.05')
    expect(minorToDecimal('-5', 'KWD')).toBe('-0.005')
    expect(minorToDecimal('1500', 'UGX')).toBe('1500')
    expect(minorToDecimal('-0', 'KES')).toBe('0.00')
  })
  it('rejects non-integers', () => {
    expect(() => minorToDecimal('12.5', 'KES')).toThrow()
  })
})

describe('formatMoney', () => {
  it('formats with the ISO code', () => {
    expect(formatMoney('457691800', 'KES')).toBe(`KES${NBSP}4,576,918.00`)
    expect(formatMoney('53134675', 'KES')).toBe(`KES${NBSP}531,346.75`)
  })
  it('handles 0-decimal and 3-decimal currencies', () => {
    expect(formatMoney('1500000', 'UGX')).toBe(`UGX${NBSP}1,500,000`)
    expect(formatMoney('1500', 'RWF')).toBe(`RWF${NBSP}1,500`)
    expect(formatMoney('1234', 'KWD')).toBe(`KWD${NBSP}1.234`)
    expect(formatMoney('5', 'BHD')).toBe(`BHD${NBSP}0.005`)
  })
  it('formats negatives with a true minus and changes with an explicit sign', () => {
    expect(formatMoney('-120050', 'KES')).toBe(`${MINUS}KES${NBSP}1,200.50`)
    expect(formatMoney('1000', 'KES', { sign: 'always' })).toBe(`+KES${NBSP}10.00`)
    expect(formatMoney('-1000', 'KES', { sign: 'always' })).toBe(`${MINUS}KES${NBSP}10.00`)
    expect(formatMoney('0', 'KES', { sign: 'always' })).toBe(`KES${NBSP}0.00`)
  })
  it('stays exact beyond 2^53', () => {
    expect(formatMoney('9007199254740993', 'KES')).toBe(`KES${NBSP}90,071,992,547,409.93`)
    expect(formatMoney('123456789012345678901234567', 'UGX')).toBe(`UGX${NBSP}123,456,789,012,345,678,901,234,567`)
    expect(formatMoney('-9007199254740993125', 'KWD')).toBe(`${MINUS}KWD${NBSP}9,007,199,254,740,993.125`)
  })
  it('uses compact notation only on request', () => {
    expect(formatMoney('1240000000', 'KES', { compact: true })).toBe(`KES${NBSP}12.4M`)
    expect(formatMoney('1240000000', 'KES', { hideCode: true })).toBe('12,400,000.00')
  })
})

describe('decimalToMinor', () => {
  it('parses user input into minor units', () => {
    expect(decimalToMinor('1,250.5', 'KES')).toBe('125050')
    expect(decimalToMinor(' 42 ', 'KES')).toBe('4200')
    expect(decimalToMinor('-5', 'KES')).toBe('-500')
    expect(decimalToMinor('12.340', 'KES')).toBe('1234')
    expect(decimalToMinor('1500', 'UGX')).toBe('1500')
    expect(decimalToMinor('1.234', 'KWD')).toBe('1234')
    expect(decimalToMinor('90071992547409.93', 'KES')).toBe('9007199254740993')
  })
  it('enforces the currency precision', () => {
    expect(() => decimalToMinor('12.345', 'KES')).toThrow(PrecisionError)
    expect(() => decimalToMinor('1500.5', 'UGX')).toThrow(/no decimal places/)
    expect(() => decimalToMinor('1.2345', 'KWD')).toThrow(/at most 3/)
    expect(() => decimalToMinor('abc', 'KES')).toThrow(TypeError)
  })
})

describe('decimals, percents, and basis points', () => {
  it('formats quantities and prices exactly', () => {
    expect(formatDecimal('40')).toBe('40')
    expect(formatDecimal('1234.56789', { maxFraction: 8 })).toBe('1,234.56789')
    expect(formatDecimal('18.45', { minFraction: 2 })).toBe('18.45')
  })
  it('formats percentages and basis points', () => {
    expect(formatPercent('42.15')).toBe('42.2%')
    expect(formatBps(800)).toBe('8%')
    expect(formatBps(825)).toBe('8.25%')
    expect(formatBps(-150, { sign: 'always' })).toBe(`${MINUS}1.5%`)
    expect(percentToBps('8.25')).toBe(825)
    expect(percentToBps('12')).toBe(1200)
  })
})

describe('chart boundary', () => {
  it('converts to numbers only for geometry and stays finite beyond the safe range', () => {
    expect(toChartNumber('457691800', 'KES')).toBe(4576918)
    expect(toChartNumber('1500', 'UGX')).toBe(1500)
    const huge = toChartNumber('123456789012345678901234567', 'KES')
    expect(Number.isFinite(huge)).toBe(true)
    expect(huge).toBeGreaterThan(1e24)
  })
  it('masks money with a fixed-width placeholder', () => {
    expect(maskedMoney('KES')).toBe(`KES${NBSP}••••••`)
  })
})
