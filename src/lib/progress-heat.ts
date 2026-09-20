// The Progress page's arithmetic: the 30-cell heat strip, the 30-day average
// read off it, and the current streak — which counts over the whole history,
// not just the part the strip can show.
//
// Extracted from the Progress route for the same reason as `progress-day.ts`:
// every rule here is a judgement about which days count, and the only way to
// check them used to be opening the app on the right day of the week with the
// right history behind it.
//
// All dates are `YYYY-MM-DD` keys; they are zero-padded, so a string compare
// is a date compare.

import { addDays, format, isWeekend } from 'date-fns'
import { dateKeyToDate } from '@/lib/tz'
import { isFutureDay } from '@/lib/progress-day'
import { ruleActiveOn } from '@/lib/progress-periods'
import type { ProgressCheck, ProgressRule } from '@/db/types'

export type HeatCell = {
  date: string
  /** Fraction of that day's active rules that were ticked. 0 when unscored. */
  pct: number
  checked: number
  total: number
  /** The session hasn't happened yet — it has no score, only a plan. */
  future: boolean
}

export const HEAT_DAYS = 30

function bucketByDay(checks: ProgressCheck[]): Map<string, ProgressCheck[]> {
  const byDay = new Map<string, ProgressCheck[]>()
  for (const c of checks) {
    if (!byDay.has(c.date)) byDay.set(c.date, [])
    byDay.get(c.date)!.push(c)
  }
  return byDay
}

/**
 * One day's score. The denominator is the rule set that was active on that
 * specific day, so adding or retiring a rule today doesn't disturb the
 * scores behind it.
 */
function dayScore(
  rules: ProgressRule[],
  day: string,
  list: ProgressCheck[],
): { checked: number; total: number; pct: number } {
  const activeIds = new Set(rules.filter(r => ruleActiveOn(r, day)).map(r => r.id))
  const total = activeIds.size
  const checked = list.filter(c => c.checked && activeIds.has(c.rule_id)).length
  return { checked, total, pct: total > 0 ? checked / total : 0 }
}

/**
 * The last `count` *weekdays* running back from (and including) `date`,
 * oldest first. Walking back this way keeps the strip a uniform width while
 * dropping the weekends the market never opens for.
 */
export function heatDays(date: string, count: number = HEAT_DAYS): string[] {
  const days: string[] = []
  let cursor = dateKeyToDate(date)
  while (days.length < count) {
    if (!isWeekend(cursor)) days.unshift(format(cursor, 'yyyy-MM-dd'))
    cursor = addDays(cursor, -1)
  }
  return days
}

/**
 * One cell per weekday. Each day's denominator is the rule set that was
 * active on that specific day, so adding or retiring a rule today doesn't
 * disturb historical scores.
 */
export function buildHeat(args: {
  date: string
  today: string
  rules: ProgressRule[]
  checks: ProgressCheck[]
  count?: number
}): HeatCell[] {
  const { date, today, rules, checks, count = HEAT_DAYS } = args
  const byDay = bucketByDay(checks)
  return heatDays(date, count).map(d => ({
    date: d,
    ...dayScore(rules, d, byDay.get(d) ?? []),
    // A session that hasn't happened has no score, for the same reason
    // `isFutureDay` blanks the adherence tile: 0/2 reads as a day already
    // failed, which is backwards when the user is planning that session.
    future: isFutureDay(d, today),
  }))
}

/**
 * Consecutive trading days at 100%, counting back from `date`.
 *
 * Walks the whole history rather than the strip: the streak is the number the
 * user is actually chasing, and reading it off 30 cells quietly capped it at
 * 30 — two perfect months showed the same figure as one. The walk stops at
 * the earliest day with a trade on it, since nothing before that can extend
 * anything.
 *
 * Weekends, days that haven't happened, and weekdays without any trades are
 * skipped — the market was closed, or the user wasn't trading, so there was
 * no routine to judge. Neither extends nor breaks the streak. A *traded* day
 * below 100%, or with no active rules at all, does break it.
 */
export function currentStreak(args: {
  date: string
  today: string
  rules: ProgressRule[]
  checks: ProgressCheck[]
  tradedDays: Set<string>
}): number {
  const { date, today, rules, checks, tradedDays } = args
  if (tradedDays.size === 0) return 0
  let earliest = ''
  for (const d of tradedDays) if (earliest === '' || d < earliest) earliest = d
  const byDay = bucketByDay(checks)
  let streak = 0
  let cursor = dateKeyToDate(date)
  let key = format(cursor, 'yyyy-MM-dd')
  while (key >= earliest) {
    if (
      !isWeekend(cursor) &&
      !isFutureDay(key, today) &&
      tradedDays.has(key)
    ) {
      const { total, pct } = dayScore(rules, key, byDay.get(key) ?? [])
      if (total > 0 && pct >= 1) streak++
      else break
    }
    cursor = addDays(cursor, -1)
    key = format(cursor, 'yyyy-MM-dd')
  }
  return streak
}

/**
 * Mean adherence across the strip's traded weekdays, or null when it has
 * none. Same exclusions as the streak: weekends, unstarted sessions and
 * untraded weekdays would otherwise drag the score toward 0% on days where
 * no routine was ever expected.
 */
export function averageAdherence(
  heat: HeatCell[],
  tradedDays: Set<string>,
): number | null {
  const scored = heat.filter(
    d =>
      d.total > 0 &&
      !d.future &&
      !isWeekend(dateKeyToDate(d.date)) &&
      tradedDays.has(d.date),
  )
  if (scored.length === 0) return null
  return scored.reduce((s, d) => s + d.pct, 0) / scored.length
}
