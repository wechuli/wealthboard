/**
 * Exact money, quantity, and rate handling.
 *
 * Money is integer minor units serialized as strings. Quantities, prices, rates, and
 * percentages are decimal strings. Nothing in this module uses floating-point arithmetic
 * except `toChartNumber`, which exists only for chart geometry.
 */

export const LOCALE = 'en-US'
export const MASK = '••••••'
const MINUS = '\u2212'

const EXPONENT_ZERO = new Set(['BIF', 'JPY', 'RWF', 'UGX'])
const EXPONENT_THREE = new Set(['BHD', 'KWD', 'OMR'])

/** Minor-unit exponent. Must match the backend: 0 for BIF/JPY/RWF/UGX, 3 for BHD/KWD/OMR, else 2. */
export function minorExponent(currency: string): number {
  const code = currency.toUpperCase()
  if (EXPONENT_ZERO.has(code)) return 0
  if (EXPONENT_THREE.has(code)) return 3
  return 2
}

const MINOR_RE = /^-?[0-9]+$/
const DECIMAL_RE = /^-?[0-9]+(?:\.[0-9]+)?$/

export function isMinorUnits(value: string): boolean {
  return MINOR_RE.test(value)
}

export function isDecimalString(value: string): boolean {
  return DECIMAL_RE.test(value)
}

function assertMinor(value: string): void {
  if (!MINOR_RE.test(value)) throw new TypeError(`Not a minor-unit string: ${value}`)
}

/** Converts minor units to an exact major-unit decimal string, for example ("-1250", "KES") → "-12.50". */
export function minorToDecimal(minor: string, currency: string): string {
  assertMinor(minor)
  const exp = minorExponent(currency)
  const negative = minor.startsWith('-')
  const digits = (negative ? minor.slice(1) : minor).replace(/^0+(?=\d)/, '')
  if (exp === 0) return (negative && digits !== '0' ? '-' : '') + digits
  const padded = digits.padStart(exp + 1, '0')
  const whole = padded.slice(0, -exp)
  const frac = padded.slice(-exp)
  const isZero = /^0+$/.test(whole + frac)
  return `${negative && !isZero ? '-' : ''}${whole}.${frac}`
}

export class PrecisionError extends Error {
  constructor(
    readonly currency: string,
    readonly maxDecimals: number,
  ) {
    super(maxDecimals === 0 ? `${currency} has no decimal places` : `${currency} allows at most ${maxDecimals} decimal places`)
    this.name = 'PrecisionError'
  }
}

/**
 * Parses user input ("1,250.5", "  42 ") into a minor-unit string for the currency.
 * Throws PrecisionError when the input has more decimals than the currency allows,
 * and TypeError when it is not a number.
 */
export function decimalToMinor(input: string, currency: string): string {
  const cleaned = input.trim().replace(/[,\s_]/g, '').replace(MINUS, '-')
  if (!DECIMAL_RE.test(cleaned) && !/^-?\.[0-9]+$/.test(cleaned)) throw new TypeError('Enter a number')
  const exp = minorExponent(currency)
  const negative = cleaned.startsWith('-')
  const body = negative ? cleaned.slice(1) : cleaned
  const [wholeRaw = '0', fracRaw = ''] = body.split('.')
  if (fracRaw.length > exp && /[1-9]/.test(fracRaw.slice(exp))) throw new PrecisionError(currency, exp)
  const frac = fracRaw.slice(0, exp).padEnd(exp, '0')
  const minor = BigInt((wholeRaw || '0') + frac)
  if (minor === 0n) return '0'
  return (negative ? '-' : '') + minor.toString()
}

export function minorSign(minor: string): -1 | 0 | 1 {
  assertMinor(minor)
  const v = BigInt(minor)
  return v === 0n ? 0 : v < 0n ? -1 : 1
}

export function absMinor(minor: string): string {
  return minor.startsWith('-') ? minor.slice(1) : minor
}

export function compareMinor(a: string, b: string): number {
  const x = BigInt(a)
  const y = BigInt(b)
  return x === y ? 0 : x < y ? -1 : 1
}

export type SignMode = 'auto' | 'always' | 'never'

export interface MoneyFormatOptions {
  /** Compact notation (KES 12.4M). Only for charts and badges. */
  compact?: boolean
  /** "always" shows + for gains and − for losses (for changes). */
  sign?: SignMode
  /** Omit the ISO code (for tight table cells that carry the code in a header). */
  hideCode?: boolean
}

const formatterCache = new Map<string, Intl.NumberFormat>()

function getFormatter(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  let f = formatterCache.get(key)
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, options)
    formatterCache.set(key, f)
  }
  return f
}

/** Formats a decimal string exactly with Intl (which formats decimal strings without float rounding). */
function formatDecimalExact(decimal: string, options: Intl.NumberFormatOptions): string {
  const key = JSON.stringify(options)
  // Intl.NumberFormat formats numeric strings exactly; the cast satisfies older lib typings.
  return getFormatter(key, options).format(decimal as unknown as number)
}

function applySign(body: string, sign: -1 | 0 | 1, mode: SignMode): string {
  if (mode === 'never' || sign === 0) return body
  if (sign < 0) return MINUS + body
  return mode === 'always' ? `+${body}` : body
}

/** Formats minor units as "KES 4,576,918.00" (or compact "KES 4.6M"). */
export function formatMoney(minor: string, currency: string, options: MoneyFormatOptions = {}): string {
  const { compact = false, sign = 'auto', hideCode = false } = options
  const decimal = minorToDecimal(minor, currency)
  const s = minorSign(minor)
  const abs = decimal.startsWith('-') ? decimal.slice(1) : decimal
  const exp = minorExponent(currency)
  const body = compact
    ? formatDecimalExact(abs, { notation: 'compact', maximumFractionDigits: 1, minimumFractionDigits: 0 })
    : formatDecimalExact(abs, { minimumFractionDigits: exp, maximumFractionDigits: exp })
  const text = hideCode ? body : `${currency.toUpperCase()}\u00a0${body}`
  return applySign(text, s, sign)
}

/** Splits a formatted amount so the currency code can be styled separately. */
export function formatMoneyParts(
  minor: string,
  currency: string,
  options: MoneyFormatOptions = {},
): { sign: string; code: string; amount: string } {
  const full = formatMoney(minor, currency, { ...options, hideCode: true })
  const signChar = full.startsWith(MINUS) || full.startsWith('+') ? full[0]! : ''
  return { sign: signChar, code: currency.toUpperCase(), amount: signChar ? full.slice(1) : full }
}

export interface DecimalFormatOptions {
  minFraction?: number
  maxFraction?: number
  sign?: SignMode
}

/** Formats an exact decimal string (quantity, unit price, rate) with grouping. */
export function formatDecimal(decimal: string, options: DecimalFormatOptions = {}): string {
  if (!DECIMAL_RE.test(decimal)) throw new TypeError(`Not a decimal string: ${decimal}`)
  const { minFraction = 0, maxFraction = 8, sign = 'auto' } = options
  const negative = decimal.startsWith('-')
  const abs = negative ? decimal.slice(1) : decimal
  const isZero = !/[1-9]/.test(abs)
  const body = formatDecimalExact(abs, {
    minimumFractionDigits: minFraction,
    maximumFractionDigits: Math.max(minFraction, maxFraction),
  })
  return applySign(body, isZero ? 0 : negative ? -1 : 1, sign)
}

/** Formats a percentage decimal string (already in percent, for example "42.15") as "42.2%". */
export function formatPercent(decimal: string, options: { maxFraction?: number; sign?: SignMode } = {}): string {
  return `${formatDecimal(decimal, { minFraction: 0, maxFraction: options.maxFraction ?? 1, sign: options.sign })}%`
}

/** Basis points to an exact percent string: 800 → "8%", 825 → "8.25%". */
export function formatBps(bps: number, options: { sign?: SignMode } = {}): string {
  if (!Number.isInteger(bps)) throw new TypeError('Basis points must be an integer')
  const negative = bps < 0
  const abs = Math.abs(bps).toString().padStart(3, '0')
  const whole = abs.slice(0, -2)
  const frac = abs.slice(-2).replace(/0+$/, '')
  const decimal = `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`
  return formatPercent(decimal, { maxFraction: 2, sign: options.sign })
}

/** Parses a percent input ("8.25") into basis points (825). */
export function percentToBps(input: string): number {
  const cleaned = input.trim().replace('%', '')
  if (!DECIMAL_RE.test(cleaned)) throw new TypeError('Enter a percentage')
  const [whole = '0', frac = ''] = cleaned.replace('-', '').split('.')
  if (frac.length > 2) throw new TypeError('Use at most two decimal places')
  const bps = Number(BigInt(whole + frac.padEnd(2, '0')))
  return cleaned.startsWith('-') ? -bps : bps
}

/**
 * Converts minor units to a JavaScript number in major units for chart geometry only.
 * Values beyond the safe-integer range are scaled through BigInt first so the result
 * stays finite and monotonic. Labels must re-format from the original string.
 */
export function toChartNumber(minor: string, currency: string): number {
  assertMinor(minor)
  const exp = minorExponent(currency)
  let v = BigInt(minor)
  let scale = 10 ** exp
  const max = BigInt(Number.MAX_SAFE_INTEGER)
  while (v > max || v < -max) {
    v /= 10n
    scale /= 10
  }
  return Number(v) / scale
}

/** Converts a decimal string to a number for chart geometry only. */
export function decimalToChartNumber(decimal: string): number {
  if (!DECIMAL_RE.test(decimal)) return Number.NaN
  return Number(decimal)
}

export function maskedMoney(currency: string): string {
  return `${currency.toUpperCase()}\u00a0${MASK}`
}
