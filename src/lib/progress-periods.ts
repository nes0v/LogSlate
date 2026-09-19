// Date-range arithmetic on `ProgressRule.periods`. Extracted from the
// Progress route so unit tests can exercise the rules without spinning
// up React.

import { addDays, format } from 'date-fns'
import { dateKeyToDate, nextWeekdayKey, previousWeekdayKey } from '@/lib/tz'
import type { ProgressRule, ProgressRulePeriod } from '@/db/types'

// A rule counts toward day D's denominator if any period covers D
// inclusively. Periods with `until: null` are still open.
export function ruleActiveOn(rule: ProgressRule, date: string): boolean {
  return rule.periods.some(
    p => p.from <= date && (p.until === null || date <= p.until),
  )
}

export function ruleHasOpenPeriod(rule: ProgressRule): boolean {
  return rule.periods.some(p => p.until === null)
}

// Start date of the rule's open period, or null when the rule is retired.
// Lets a caller tell a rule that is switched ON but hasn't taken effect yet
// (scheduled for a later session) from one that is in force right now —
// `ruleHasOpenPeriod` alone can't, since it carries no date.
export function openPeriodStart(rule: ProgressRule): string | null {
  return rule.periods.find(p => p.until === null)?.from ?? null
}

// Latest end date across the rule's closed periods, or null when it has
// none. Mirror of `openPeriodStart`: together they describe the two ways a
// rule row can disagree with the checklist beside it — switched ON but not
// started yet, or switched OFF but still running out its last day (retired
// on the next session's page, so today still counts it).
export function lastPeriodEnd(rule: ProgressRule): string | null {
  let latest: string | null = null
  for (const p of rule.periods) {
    if (p.until === null) continue
    if (latest === null || p.until > latest) latest = p.until
  }
  return latest
}

// Open a fresh period starting on the next trading day — today when
// that's a weekday, Monday when `today` is a Sat/Sun. Both callers pass
// the raw calendar day; normalising here means no call site can write a
// weekend boundary into `periods`, and rolling FORWARD (rather than back
// to Friday) keeps a weekend edit off the already-scored week. Adding a
// rule on Saturday must not grow Friday's denominator: Friday is closed,
// journalled, and drawn in the heat strip.
//
// No-op (returns a defensive copy) if a period is already open — toggling
// on twice shouldn't fork the history. Always returns a fresh array so
// callers can't accidentally mutate the underlying rule.periods.
export function openPeriod(rule: ProgressRule, today: string): ProgressRulePeriod[] {
  if (ruleHasOpenPeriod(rule)) return rule.periods.slice()
  return [...rule.periods, { from: nextWeekdayKey(today), until: null }]
}

// Close the currently-open period at the last trading day before today,
// so the rule drops off today's checklist while every day it was already
// scored on keeps it. Mirrors `openPeriod`: the caller passes the raw
// calendar day and the weekday rolling happens here. On a Monday that's
// Friday (not Sunday), and retiring a rule over the weekend closes it at
// Friday — the week that just ended still counts it, exactly as it was
// journalled.
export function closePeriod(rule: ProgressRule, today: string): ProgressRulePeriod[] {
  const until = previousWeekdayKey(
    format(addDays(dateKeyToDate(today), -1), 'yyyy-MM-dd'),
  )
  return rule.periods
    .map(p => {
      if (p.until !== null) return p
      // Start past end ⇒ no trading day ever elapsed under this period
      // (opened and retired before one did). Drop it rather than store an
      // empty range. Catches both same-day toggling and the weekend case,
      // where `openPeriod` parked the start on Monday.
      if (p.from > until) return null
      return { from: p.from, until }
    })
    .filter((p): p is ProgressRulePeriod => p !== null)
}
