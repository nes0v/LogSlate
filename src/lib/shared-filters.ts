// Filter state shared between Stats and Reports — both pages read and write
// the same TradeFilters slot in localStorage so changing the filter on one
// page carries over to the other. Each page still owns its URL (so a page
// reload restores its exact view), but on first mount with an empty URL we
// hydrate from this slot.

import { addDays, format } from 'date-fns'
import type { TradeFilters } from '@/lib/filters'

const KEY = 'logslate.shared-filters.v1'

/** Default 30-day inclusive range ending on `baseDate` (YYYY-MM-DD).
 *  Anchored on the most recent trade date, so opening Stats/Reports lands
 *  on the user's actual trading window instead of a probably-empty
 *  trailing 30 days. */
export function defaultRange(baseDate: string): { from: string; to: string } {
  const base = new Date(baseDate + 'T00:00:00')
  return {
    from: format(addDays(base, -29), 'yyyy-MM-dd'),
    to: baseDate,
  }
}

export function loadSharedFilters(): TradeFilters | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return JSON.parse(raw) as TradeFilters
  } catch {
    return null
  }
}

export function saveSharedFilters(f: TradeFilters | null) {
  try {
    if (f) localStorage.setItem(KEY, JSON.stringify(f))
    else localStorage.removeItem(KEY)
  } catch {
    /* ignore quota / privacy-mode errors */
  }
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
