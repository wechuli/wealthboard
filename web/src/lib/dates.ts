import { TZDate } from '@date-fns/tz'
import { differenceInCalendarDays, format as dfFormat, parseISO } from 'date-fns'

export type DateFormat = 'dd MMM yyyy' | 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd'
export const DATE_FORMATS: readonly DateFormat[] = ['dd MMM yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd']
export const DEFAULT_TIMEZONE = 'Africa/Nairobi'
export const DEFAULT_DATE_FORMAT: DateFormat = 'dd MMM yyyy'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** Parses YYYY-MM-DD into a calendar date (no timezone shift). */
export function parseDateOnly(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y!, (m ?? 1) - 1, d ?? 1)
}

function toZoned(value: string, timezone: string): Date {
  if (DATE_ONLY.test(value)) return parseDateOnly(value)
  return new TZDate(parseISO(value).getTime(), timezone)
}

/** Formats a date (YYYY-MM-DD) or timestamp (ISO-8601 UTC) in the user's timezone and format. */
export function formatDate(value: string, fmt: DateFormat | string = DEFAULT_DATE_FORMAT, timezone = DEFAULT_TIMEZONE): string {
  return dfFormat(toZoned(value, timezone), fmt)
}

export function formatDateTime(value: string, fmt: DateFormat | string = DEFAULT_DATE_FORMAT, timezone = DEFAULT_TIMEZONE): string {
  return `${formatDate(value, fmt, timezone)}, ${dfFormat(toZoned(value, timezone), 'HH:mm')}`
}

/** Short label for chart ticks: "Mar 26". */
export function formatMonthTick(value: string, timezone = DEFAULT_TIMEZONE): string {
  return dfFormat(toZoned(value, timezone), 'MMM yy')
}

export function formatMonthLong(value: string, timezone = DEFAULT_TIMEZONE): string {
  return dfFormat(toZoned(value, timezone), 'MMMM yyyy')
}

/** Today's calendar date (YYYY-MM-DD) in the given timezone. */
export function todayISO(timezone = DEFAULT_TIMEZONE, now: number = Date.now()): string {
  return dfFormat(new TZDate(now, timezone), 'yyyy-MM-dd')
}

/** The calendar date (YYYY-MM-DD) of a value in the given timezone. */
export function toDateOnly(value: string, timezone = DEFAULT_TIMEZONE): string {
  if (DATE_ONLY.test(value)) return value
  return dfFormat(new TZDate(parseISO(value).getTime(), timezone), 'yyyy-MM-dd')
}

export function daysBetween(from: string, to: string, timezone = DEFAULT_TIMEZONE): number {
  return differenceInCalendarDays(parseDateOnly(toDateOnly(to, timezone)), parseDateOnly(toDateOnly(from, timezone)))
}

/** "Today", "Yesterday", "3 days ago", "5 weeks ago", "4 months ago". */
export function relativeDays(value: string, today: string, timezone = DEFAULT_TIMEZONE): string {
  const days = daysBetween(value, today, timezone)
  if (days <= 0) return days === 0 ? 'Today' : 'Upcoming'
  if (days === 1) return 'Yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  if (days < 730) return `${Math.round(days / 30.44)} months ago`
  return `${Math.round(days / 365.25)} years ago`
}

export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value)
}

export const TIMEZONES: readonly string[] = [
  'Africa/Nairobi',
  'Africa/Kampala',
  'Africa/Dar_es_Salaam',
  'Africa/Kigali',
  'Africa/Addis_Ababa',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Africa/Cairo',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
]
