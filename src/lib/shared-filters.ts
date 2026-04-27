// Filter state shared between Stats and Reports — both pages read and write
// the same TradeFilters slot in localStorage so changing the filter on one
// page carries over to the other. Each page still owns its URL (so a page
// reload restores its exact view), but on first mount with an empty URL we
// hydrate from this slot.

import type { TradeFilters } from '@/lib/filters'

const KEY = 'logslate.shared-filters.v1'

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
  return !!(f.from || f.to || f.symbol || f.contract || f.session || f.rating)
}
