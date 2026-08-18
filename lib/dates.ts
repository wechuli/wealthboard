import { formatInTimeZone } from "date-fns-tz";

export function nowIso() {
  return new Date().toISOString();
}

export function dateInputToUtc(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Enter a valid date.");
  }
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("Enter a valid calendar date.");
  }
  return `${value}T12:00:00.000Z`;
}

export function utcToDateInput(value: string | Date) {
  return new Date(value).toISOString().slice(0, 10);
}

export function formatDate(
  value: string | Date,
  timezone = "Africa/Nairobi",
  pattern = "dd MMM yyyy",
) {
  const iso = typeof value === "string" ? value : value.toISOString();
  const displayTimezone = iso.includes("T12:00:00.000Z") ? "UTC" : timezone;
  return formatInTimeZone(value, displayTimezone, pattern);
}

export function monthsBetween(start: Date, end: Date): number {
  if (end <= start) return 0;
  const years = end.getUTCFullYear() - start.getUTCFullYear();
  const calendarMonths = years * 12 + end.getUTCMonth() - start.getUTCMonth();
  const completeMonths =
    utcToDateInput(addUtcMonths(start, calendarMonths)) <= utcToDateInput(end)
      ? calendarMonths
      : calendarMonths - 1;
  return Math.max(0, completeMonths);
}

export function startOfUtcDay(date: Date) {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  );
}

export function endOfUtcDay(date: Date) {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );
}

export function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function addUtcMonths(date: Date, months: number) {
  const next = new Date(date);
  const originalDay = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const daysInTargetMonth = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate();
  next.setUTCDate(Math.min(originalDay, daysInTargetMonth));
  return next;
}

export function dateInputForTimezone(timezone: string, date = new Date()) {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd");
}

export function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}
