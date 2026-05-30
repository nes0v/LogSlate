// Date-range arithmetic on `ProgressRule.periods`. Extracted from the
// Progress route so unit tests can exercise the rules without spinning
// up React. Every function treats a missing `periods` field as `[]`
// since rows pulled from Drive may pre-date the field.

import { addDays, format } from 'date-fns'
import { dateKeyToDate } from '@/lib/tz'
import type { ProgressRule, ProgressRulePeriod } from '@/db/types'

export function periodsOf(rule: ProgressRule): ProgressRulePeriod[] {
  return rule.periods ?? []
}

// A rule counts toward day D's denominator if any period covers D
// inclusively. Periods with `until: null` are still open.
export function ruleActiveOn(rule: ProgressRule, date: string): boolean {
  return periodsOf(rule).some(
    p => p.from <= date && (p.until === null || date <= p.until),
  )
}

export function ruleHasOpenPeriod(rule: ProgressRule): boolean {
  return periodsOf(rule).some(p => p.until === null)
}

// Open a fresh period starting today. No-op (returns a defensive copy)
// if a period is already open — toggling on twice shouldn't fork the
// history. Always returns a fresh array so callers can't accidentally
// mutate the underlying rule.periods.
export function openPeriod(rule: ProgressRule, today: string): ProgressRulePeriod[] {
  if (ruleHasOpenPeriod(rule)) return periodsOf(rule).slice()
  return [...periodsOf(rule), { from: today, until: null }]
}

// Close the currently-open period at yesterday. If the period was
// opened earlier today (from === today), it never had any effective
// days, so drop it entirely instead of writing a zero-day range.
export function closePeriod(rule: ProgressRule, today: string): ProgressRulePeriod[] {
  const yesterday = format(addDays(dateKeyToDate(today), -1), 'yyyy-MM-dd')
  return periodsOf(rule)
    .map(p => {
      if (p.until !== null) return p
      if (p.from > yesterday) return null
      return { from: p.from, until: yesterday }
    })
    .filter((p): p is ProgressRulePeriod => p !== null)
}
