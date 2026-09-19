// Which day the news panel will act on, and how far forward it will go.
//
// Extracted for the same reason `progress-day.ts` was: every rule here is a
// comparison between two date keys whose answer depends on the weekday it is
// asked on. Left inline in the component they were checkable only by opening
// the app on the right day of the week — which is exactly how the panel came
// to disagree with the user about where Sunday belongs.

import { isoWeekEndKey, weekEndKey, weekStartKey } from '@/lib/tz'

/**
 * Where a day sits relative to the week the feed is currently serving.
 *
 *  - `current`     — inside it. The full calendar, every currency.
 *  - `archive`     — behind it. IndexedDB only, USD high/medium.
 *  - `unpublished` — ahead of it. Nothing exists for it yet, and no fetch
 *                    will make one: the feed carries the current week alone.
 *
 * Measured against the week the feed is serving NOW, never against what the
 * cache happens to hold. An empty or stale cache is a loading problem, not a
 * reason to present today as a day the feed never published.
 */
export type NewsDayMode = 'current' | 'archive' | 'unpublished'

export function newsDayMode(dayKey: string, todayKey: string): NewsDayMode {
  const feedWeek = weekStartKey(todayKey)
  const week = weekStartKey(dayKey)
  if (week === feedWeek) return 'current'
  return week < feedWeek ? 'archive' : 'unpublished'
}

/**
 * Last day forward navigation will reach.
 *
 * Whichever of two weeks reaches further. Normally that is the Sunday
 * closing the Mon-Sun week, one day past the feed's Sat cut — the Sunday a
 * reader expects to be able to reach, even though nothing is published for
 * it yet. On a Sunday it is the feed week instead: it has just rolled onto a
 * whole new Sun-Sat block, and stopping at "today" would lock the user out
 * of a week that is already published.
 */
export function lastReachableDay(todayKey: string): string {
  const feedEnd = weekEndKey(weekStartKey(todayKey))
  const isoEnd = isoWeekEndKey(todayKey)
  return isoEnd > feedEnd ? isoEnd : feedEnd
}
