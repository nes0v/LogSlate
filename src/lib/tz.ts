// NY (ET) helpers — only used for two things now:
//   1. Computing "today's date" / "this month" in NY (so the app's day
//      boundary follows NY regardless of where the user is).
//   2. Displaying real-instant news drivers (ForexFactory feed) in NY.
//
// Trade execution times are *not* converted: they are stored as the typed
// NY wallclock encoded as `${date}T${HH:MM:SS}.000Z` and read back via
// string slicing or `getUTCHours()`. No timezone math involved.

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
