// Which day the Progress page treats as "now", and which days it will let you
// act on.
//
// Pulled out of the route so these can be tested without mounting React.
// Every bug this area has had came from exactly these comparisons — a Today
// button that walked onto a Saturday, a Friday left editable after it closed,
// a checklist tickable a day early — and until now the only way to check them
// was to open the app on the right day of the week and click around.
//
// All arguments and results are `YYYY-MM-DD` keys. Those are zero-padded, so
// a plain string compare is a date compare.

import { addDays, format, isWeekend } from 'date-fns'
import { dateKeyToDate, nextWeekdayKey, previousWeekdayKey } from '@/lib/tz'

/** True when `today` is itself a trading day. Futures are shut Sat/Sun. */
export function marketOpenOn(today: string): boolean {
  return !isWeekend(dateKeyToDate(today))
}

/**
 * Where the page lands, and where its Today button goes: the most recent
 * trading day. On a weekend that's Friday — the last day with anything on it.
 *
 * Landing on Friday is NOT the same as Friday still being open; see
 * `canEditRulesOn`, which deliberately disagrees with this on a weekend.
 */
export function landingDayFor(today: string): string {
  return previousWeekdayKey(today)
}

/**
 * The next trading day after `today`: Thursday from a Wednesday, Monday from
 * Friday's close through Sunday.
 */
export function nextSessionFor(today: string): string {
  return nextWeekdayKey(format(addDays(dateKeyToDate(today), 1), 'yyyy-MM-dd'))
}

/**
 * Rules are editable on today (when the market is open) and on the next
 * session — nothing else.
 *
 * The next session is editable so a weekend review has somewhere to put the
 * rule it just came up with. Everything else locks, including Friday the
 * moment it turns Saturday: once a trading day is over it behaves like any
 * other past day. Keeping Friday editable through the weekend was tried and
 * rejected — the edit landed on Monday while the page showed Friday, so
 * nothing on screen reflected what had just happened.
 */
export function canEditRulesOn(date: string, today: string): boolean {
  if (date === nextSessionFor(today)) return true
  return marketOpenOn(today) && date === today
}

/**
 * A day that hasn't happened yet. Its checklist is a preview of what that
 * session will ask of you — ticking it would bank adherence for a session
 * that hasn't been traded, and scoring it would read as a day already failed.
 */
export function isFutureDay(date: string, today: string): boolean {
  return date > today
}

/**
 * Furthest day the page will navigate to. Past the next session every control
 * is inert and the heat strip — always the 30 weekdays running back from the
 * selected day — degenerates into a block of empty cells. The past stays
 * unbounded: that's where the history is.
 */
export function canNavigateTo(date: string, today: string): boolean {
  return date <= nextSessionFor(today)
}
