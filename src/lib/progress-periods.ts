// Date-range arithmetic on `ProgressRule.periods`. Extracted from the
// Progress route so unit tests can exercise the rules without spinning
// up React.

import { addDays, format } from 'date-fns'
import { dateKeyToDate, nextWeekdayKey, previousWeekdayKey } from '@/lib/tz'
import type { ProgressRule, ProgressRulePeriod } from '@/db/types'

// A rule is in force on day D if any period covers D inclusively — it
// shows on D's checklist, and counts toward D's score unless it's a line
// (see `ruleCountsOn`). Periods with `until: null` are still open.
export function ruleActiveOn(rule: ProgressRule, date: string): boolean {
  return rule.periods.some(
    p => p.from <= date && (p.until === null || date <= p.until),
  )
}

// Whether the rule is part of day D's score. A line runs on periods
// like a rule, so it shows on the right days, but it is never scored.
export function ruleCountsOn(rule: ProgressRule, date: string): boolean {
  return rule.kind !== 'line' && ruleActiveOn(rule, date)
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

// The last trading day strictly before `today` — Friday from a Monday or a
// weekend. Everything up to it is behind us as far as `today` is concerned.
function tradingDayBefore(today: string): string {
  return previousWeekdayKey(
    format(addDays(dateKeyToDate(today), -1), 'yyyy-MM-dd'),
  )
}

// The first trading day after `day` — Monday from a Friday. Mirror of
// `tradingDayBefore`.
export function tradingDayAfter(day: string): string {
  return nextWeekdayKey(format(addDays(dateKeyToDate(day), 1), 'yyyy-MM-dd'))
}

// Day D's checklist as drawn: the rules in force that day, in list order,
// with that day's lines between them. A line only shows where it
// divides something, so one left at either end, or next to another once the
// rules around it are off that day, drops out.
export function checklistFor(rules: ProgressRule[], date: string): ProgressRule[] {
  const items: ProgressRule[] = []
  for (const r of rules) {
    if (!ruleActiveOn(r, date)) continue
    const afterLine = items.length === 0 || items[items.length - 1].kind === 'line'
    if (r.kind === 'line' && afterLine) continue
    items.push(r)
  }
  if (items.at(-1)?.kind === 'line') items.pop()
  return items
}

// True once the rule has been in force on a trading day before `today` — some
// past day scored it under its current words. From then on those words are
// part of the record: rewording the rule would change what the past says was
// asked of you, so a new wording becomes a new rule instead (see
// `setProgressRuleText`). Before that, nothing depends on the text and it can
// change freely — a typo just written, or a rule being planned for Monday.
export function ruleHasHistoryBefore(rule: ProgressRule, today: string): boolean {
  const cutoff = tradingDayBefore(today)
  return rule.periods.some(p => p.from <= cutoff)
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
//
// When no trading day elapsed with the rule switched off, the last period is
// re-opened rather than a new one appended. Retiring a rule from the next
// session's page and then keeping it from today's is the way in: it closes
// at today and re-opens at today, and storing that as two periods meeting on
// one day describes a rule that never stopped as though it had.
export function openPeriod(rule: ProgressRule, today: string): ProgressRulePeriod[] {
  if (ruleHasOpenPeriod(rule)) return rule.periods.slice()
  const from = nextWeekdayKey(today)
  const previous = previousWeekdayKey(
    format(addDays(dateKeyToDate(from), -1), 'yyyy-MM-dd'),
  )
  const latest = lastPeriodEnd(rule)
  if (latest !== null && latest >= previous) {
    return rule.periods.map(p =>
      p.until === latest ? { from: p.from, until: null } : p,
    )
  }
  return [...rule.periods, { from, until: null }]
}

// Close the currently-open period at the last trading day before today,
// so the rule drops off today's checklist while every day it was already
// scored on keeps it. Mirrors `openPeriod`: the caller passes the raw
// calendar day and the weekday rolling happens here. On a Monday that's
// Friday (not Sunday), and retiring a rule over the weekend closes it at
// Friday — the week that just ended still counts it, exactly as it was
// journalled.
export function closePeriod(rule: ProgressRule, today: string): ProgressRulePeriod[] {
  const until = tradingDayBefore(today)
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
