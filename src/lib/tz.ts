// NY (ET) time/date helpers. Event times from the ForexFactory feed are in
// NY-anchored ISO strings and we render them in NY regardless of the user's
// local timezone.

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

/** YYYY-MM-DD in NY for a given instant. */
export function nyDateKey(d: Date = new Date()): string {
  return nyDateFmt.format(d)
}

/** HH:mm in NY for a given instant. */
export function nyTimeHHmm(d: Date): string {
  return nyTimeFmt.format(d)
}
