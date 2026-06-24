// Filter state shared between Stats and Reports — both pages read and write
// the same TradeFilters slot in localStorage so changing the filter on one
// page carries over to the other. Each page still owns its URL (so a page
// reload restores its exact view), but on first mount with an empty URL we
// hydrate from this slot.

import { format, subMonths } from 'date-fns'
import { dateKeyToDate, nextWeekdayKey, previousWeekdayKey } from '@/lib/tz'
import { coerceFilters, type TradeFilters } from '@/lib/filters'
import { loadJsonFromStorage, removeFromStorage, saveJsonToStorage } from '@/lib/storage'

const KEY = 'logslate.shared-filters.v1'

/** Default one-month inclusive range ending on `baseDate` (YYYY-MM-DD) —
 *  same day-of-month one month back through `baseDate` (e.g. Jun 8 →
 *  May 8 – Jun 8). Anchored on the most recent trade date, so opening
 *  Stats/Reports lands on the user's actual trading window instead of a
 *  probably-empty trailing month. `subMonths` clamps short months
 *  (e.g. Mar 31 → Feb 28).
 *
 *  Both edges are snapped to weekdays so the default matches the filters'
 *  weekday-only date pickers: `from` rolls forward to the next weekday (e.g.
 *  Jun 16 → May 16 Sat → May 18 Mon), `to` rolls back to the previous weekday.
 *  `to` is usually a real activity date (already a weekday); the snap only
 *  matters when it falls back to today on an empty account opened on a
 *  weekend. */
export function defaultRange(baseDate: string, months = 1): { from: string; to: string } {
  const from = format(subMonths(dateKeyToDate(baseDate), months), 'yyyy-MM-dd')
  return {
    from: nextWeekdayKey(from),
    to: previousWeekdayKey(baseDate),
  }
}

export function loadSharedFilters(): TradeFilters | null {
  return loadJsonFromStorage<TradeFilters | null>(
    KEY,
    raw => {
      // Whitelist every field — a stale/corrupt slot must not inject an
      // invalid enum or wrong-typed `from`/`to` into `applyFilters`.
      const f = coerceFilters(raw)
      return hasAnyFilter(f) ? f : null
    },
    null,
  )
}

export function saveSharedFilters(f: TradeFilters | null) {
  if (f) saveJsonToStorage(KEY, f)
  else removeFromStorage(KEY)
}

export function hasAnyFilter(f: TradeFilters): boolean {
  return !!(
    f.from ||
    f.to ||
    f.symbol ||
    f.contract ||
    f.session ||
    f.rating ||
    f.weekday ||
    f.outcome ||
    f.side ||
    f.hold ||
    f.emotion ||
    f.model ||
    f.tag
  )
}
