// Filter state shared between Stats and Reports — both pages read and write
// the same TradeFilters slot in localStorage so changing the filter on one
// page carries over to the other. Each page still owns its URL (so a page
// reload restores its exact view), but on first mount with an empty URL we
// hydrate from this slot.

import { addDays, format } from 'date-fns'
import { dateKeyToDate } from '@/lib/tz'
import type { TradeFilters } from '@/lib/filters'
import { loadJsonFromStorage, removeFromStorage, saveJsonToStorage } from '@/lib/storage'

const KEY = 'logslate.shared-filters.v1'

/** Default 30-day inclusive range ending on `baseDate` (YYYY-MM-DD).
 *  Anchored on the most recent trade date, so opening Stats/Reports lands
 *  on the user's actual trading window instead of a probably-empty
 *  trailing 30 days. */
export function defaultRange(baseDate: string): { from: string; to: string } {
  const base = dateKeyToDate(baseDate)
  return {
    from: format(addDays(base, -29), 'yyyy-MM-dd'),
    to: baseDate,
  }
}

export function loadSharedFilters(): TradeFilters | null {
  return loadJsonFromStorage<TradeFilters | null>(
    KEY,
    raw =>
      raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as TradeFilters)
        : null,
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
    f.model
  )
}
