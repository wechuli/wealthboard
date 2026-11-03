/** BigInt decimal arithmetic for the mock layer only. The UI never does financial math. */
import { minorExponent } from '@/lib/money'

const SCALE_DIGITS = 12
const SCALE = 10n ** BigInt(SCALE_DIGITS)

/** Parses a decimal string into a BigInt scaled by 10^12. */
export function toScaled(decimal: string): bigint {
  const negative = decimal.startsWith('-')
  const body = negative ? decimal.slice(1) : decimal
  const [whole = '0', frac = ''] = body.split('.')
  const v = BigInt(whole || '0') * SCALE + BigInt((frac + '0'.repeat(SCALE_DIGITS)).slice(0, SCALE_DIGITS) || '0')
  return negative ? -v : v
}

export function fromScaled(v: bigint, maxFraction = 8): string {
  const negative = v < 0n
  const abs = negative ? -v : v
  const whole = abs / SCALE
  let frac = (abs % SCALE).toString().padStart(SCALE_DIGITS, '0').slice(0, maxFraction).replace(/0+$/, '')
  if (frac === '') frac = ''
  const out = `${whole}${frac ? `.${frac}` : ''}`
  return negative && out !== '0' ? `-${out}` : out
}

/** Rounds half away from zero: a / b. */
export function divRound(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new RangeError('Division by zero')
  const negative = a < 0n !== b < 0n
  const absA = a < 0n ? -a : a
  const absB = b < 0n ? -b : b
  const q = (absA * 2n + absB) / (absB * 2n)
  return negative ? -q : q
}

/** quantity × unitPrice → minor units of the currency (rounded). */
export function mulToMinor(quantity: string, unitPrice: string, currency: string): bigint {
  const exp = BigInt(minorExponent(currency))
  return divRound(toScaled(quantity) * toScaled(unitPrice) * 10n ** exp, SCALE * SCALE)
}

/** Decimal string (major units) → minor units. */
export function majorToMinor(decimal: string, currency: string): bigint {
  const exp = BigInt(minorExponent(currency))
  return divRound(toScaled(decimal) * 10n ** exp, SCALE)
}

/** minor units → decimal string (major units). */
export function minorToMajor(minor: bigint, currency: string): string {
  const exp = minorExponent(currency)
  return fromScaled((minor * SCALE) / 10n ** BigInt(exp), exp)
}

/** Converts an amount between currencies using an exact decimal rate (1 from = rate × to). */
export function convertMinor(minor: bigint, from: string, to: string, rate: string, invert = false): bigint {
  const expFrom = BigInt(minorExponent(from))
  const expTo = BigInt(minorExponent(to))
  const r = toScaled(rate)
  if (invert) return divRound(minor * SCALE * 10n ** expTo, r * 10n ** expFrom)
  return divRound(minor * r * 10n ** expTo, SCALE * 10n ** expFrom)
}

/** a / b × 100 as a decimal string with `digits` fraction digits. */
export function percentOf(a: bigint, b: bigint, digits = 2): string {
  if (b === 0n) return '0'
  const scaled = divRound(a * 100n * 10n ** BigInt(digits), b)
  const negative = scaled < 0n
  const abs = (negative ? -scaled : scaled).toString().padStart(digits + 1, '0')
  const out = digits ? `${abs.slice(0, -digits)}.${abs.slice(-digits)}` : abs
  return negative ? `-${out}` : out
}

export function bigMax(...values: bigint[]): bigint {
  return values.reduce((a, b) => (b > a ? b : a))
}

export function bigMin(...values: bigint[]): bigint {
  return values.reduce((a, b) => (b < a ? b : a))
}
