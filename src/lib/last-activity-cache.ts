import {
  loadJsonFromStorage,
  removeFromStorage,
  removeStorageKeysWithPrefix,
  saveJsonToStorage,
} from '@/lib/storage'
import { isDateKey } from '@/lib/tz'

// Per-account snapshot of the most recent activity date (the later of the last
// trade date and the last day-override date), backed by localStorage.
//
// It exists purely so the Stats/Reports date pickers can render their default
// window on the FIRST painted frame. That window is derived from the database,
// and every IndexedDB read is async, so without a synchronous seed the pickers
// must show the "Any" placeholder for at least one frame before snapping to the
// real dates — visible as a flicker on every navigation to those pages, while
// an explicitly-picked filter (which lives in the URL / shared-filters slot,
// both synchronous) never flickers at all.
//
// The anchor date is cached rather than the computed `{from, to}` window: the
// window also depends on the user's default-range-months preference, so a
// cached window would go stale the moment that changes, while the anchor
// stays the single source of truth (see `defaultRange` in shared-filters).
//
// Keyed per account, mirroring `symbol-filter-cache`, so an account switch
// can't seed one account's window from another's activity.
const PREFIX = 'logslate:last_activity_date'

const keyFor = (accountId: string) => `${PREFIX}:${accountId}`

/** Cached anchor for `accountId`, or null when there's nothing usable stored.
 *  A null result just means the pickers show "Any" for a frame — the same
 *  behaviour as before this cache existed.
 *
 *  Validated with `isDateKey`, not a shape regex: this value feeds
 *  `defaultRange` → date-fns, and a well-shaped but impossible key like
 *  `2026-13-45` would throw `RangeError: Invalid time value` mid-render and
 *  take the whole page down. localStorage is user-editable and survives
 *  version changes, so it has to be treated as untrusted input. */
export function readLastActivityDate(accountId: string): string | null {
  return loadJsonFromStorage<string | null>(
    keyFor(accountId),
    raw => (isDateKey(raw) ? raw : null),
    null,
  )
}

export function writeLastActivityDate(accountId: string, date: string): void {
  saveJsonToStorage(keyFor(accountId), date)
}

/** Drop an account's cached anchor — call when the account is deleted so the
 *  blob doesn't outlive the data it mirrors. */
export function clearLastActivityDate(accountId: string): void {
  removeFromStorage(keyFor(accountId))
}

/** Drop every account's cached activity anchor — see
 *  `clearAllSymbolFilterCaches` for why a restore needs the sweeping version. */
export function clearAllLastActivityDates(): void {
  removeStorageKeysWithPrefix(PREFIX)
}
