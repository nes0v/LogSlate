// NY (ET) helpers — only used for two things now:
//   1. Computing "today's date" / "this month" in NY (so the app's day
//      boundary follows NY regardless of where the user is).
//   2. Displaying real-instant news drivers (ForexFactory feed) in NY.
//
// Trade execution times are *not* converted: they are stored as the typed
// NY wallclock encoded as `${date}T${HH:MM:SS}.000Z` and read back via
// string slicing or `getUTCHours()`. No timezone math involved.

import { format } from 'date-fns'

export const NY_TZ = 'America/New_York'

const nyDateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: NY_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const nyTimeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: NY_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const nyMonthFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: NY_TZ,
  year: 'numeric',
  month: '2-digit',
})

/** YYYY-MM-DD in NY for a given instant (default: now). */
export function nyDateKey(d: Date = new Date()): string {
  return nyDateFmt.format(d)
}

/** Convenience for "today in NY" — same as `nyDateKey()`. */
export function nyToday(): string {
  return nyDateFmt.format(new Date())
}

/** YYYY-MM in NY for a given instant (default: now). */
export function nyMonthKey(d: Date = new Date()): string {
  return nyMonthFmt.format(d)
}

/** HH:mm in NY for a given real instant (used by the ForexFactory news
 *  feed, whose `scheduled_at` is a true UTC ISO string). */
export function nyTimeHHmm(d: Date): string {
  return nyTimeFmt.format(d)
}

/** Parse a `YYYY-MM-DD` key as midnight local time, the date-only convention
 *  used everywhere in the app for trade dates / day rows / calendar cells.
 *  date-fns and getDay() expect a Date, not a string, so we go through this
 *  helper rather than scattering `new Date(key + 'T00:00:00')` everywhere. */
export function dateKeyToDate(dateKey: string): Date {
  return new Date(dateKey + 'T00:00:00')
}

/** The app-wide display format for a full date: `06 Jun 2026`. Accepts a
 *  Date or a `YYYY-MM-DD` key. Use this anywhere a date is shown to the user
 *  so the format stays consistent everywhere. */
export function formatDisplayDate(date: Date | string): string {
  const d = typeof date === 'string' ? dateKeyToDate(date) : date
  return format(d, 'dd MMM yyyy')
}

function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * True when `value` is a real `YYYY-MM-DD` calendar date.
 *
 * A shape check alone is not enough, and neither is a validity check:
 * `2026-13-45` parses to an Invalid Date (which then throws `RangeError:
 * Invalid time value` the moment date-fns formats it), while `2026-02-30`
 * silently ROLLS OVER to `2026-03-01`. Only the round-trip catches both.
 *
 * Use this on any date key arriving from outside the app — localStorage,
 * a hand-typed URL param, an imported backup — before it reaches
 * `dateKeyToDate` and the date-fns pipeline behind it.
 */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = dateKeyToDate(value)
  return !Number.isNaN(d.getTime()) && toDateKey(d) === value
}

/** Nearest weekday on or before `dateKey` (YYYY-MM-DD): Sat/Sun roll back to
 *  Friday, a weekday is returned unchanged. Used for date inputs that must
 *  land on a trading day (cash flow / progress / the default range's `to`),
 *  since weekend-dated values get dropped from the daily equity candles. */
export function previousWeekdayKey(dateKey: string): string {
  const d = dateKeyToDate(dateKey)
  const wd = d.getDay() // 0 = Sun … 6 = Sat
  if (wd === 0) d.setDate(d.getDate() - 2)
  else if (wd === 6) d.setDate(d.getDate() - 1)
  return toDateKey(d)
}

/** Nearest weekday on or after `dateKey`: Sat/Sun roll forward to Monday, a
 *  weekday is returned unchanged. Used where a weekend should advance to the
 *  next trading day (the default range's `from` edge, a month's first fee). */
export function nextWeekdayKey(dateKey: string): string {
  const d = dateKeyToDate(dateKey)
  const wd = d.getDay()
  if (wd === 6) d.setDate(d.getDate() + 2)
  else if (wd === 0) d.setDate(d.getDate() + 1)
  return toDateKey(d)
}
