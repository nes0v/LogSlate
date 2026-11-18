// Filter state shared between Stats and Reports — both pages read and write
// the same TradeFilters slot in localStorage so changing the filter on one
// page carries over to the other. Each page still owns its URL (so a page
// reload restores its exact view), but on first mount with an empty URL we
// hydrate from this slot.

import { format, subWeeks } from 'date-fns'
import { dateKeyToDate, nextWeekdayKey, previousWeekdayKey } from '@/lib/tz'
import { coerceFilters, type TradeFilters } from '@/lib/filters'
import { DEFAULT_RANGE_WEEKS } from '@/lib/default-range-preference'
import { loadJsonFromStorage, removeFromStorage, saveJsonToStorage } from '@/lib/storage'

const KEY = 'logslate.shared-filters.v2'

/** Default inclusive range of `weeks` weeks ending on `baseDate`
 *  (YYYY-MM-DD) — same weekday N weeks back through `baseDate` (e.g. Mon
 *  Jun 8, 4 weeks → Mon May 11 – Jun 8). Anchored on the most recent trade
 *  date, so opening Stats/Reports lands on the user's actual trading window
 *  instead of a probably-empty trailing stretch.
 *
 *  Both edges are snapped to weekdays so the default matches the filters'
 *  weekday-only date pickers: `from` rolls forward to the next weekday, `to`
 *  rolls back to the previous one. Whole weeks keep `from` on `baseDate`'s
 *  weekday, so the snap only matters when `baseDate` is itself a weekend —
 *  today's fallback on an empty account opened on a weekend. */
export function defaultRange(baseDate: string, weeks = DEFAULT_RANGE_WEEKS): { from: string; to: string } {
  const from = format(subWeeks(dateKeyToDate(baseDate), weeks), 'yyyy-MM-dd')
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
    f.symbol_id ||
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
