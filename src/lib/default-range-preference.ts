import { useSyncExternalStore } from 'react'

/** Slider bounds, whole weeks. */
export const MIN_RANGE_WEEKS = 4
export const MAX_RANGE_WEEKS = 16

// The default range in weeks, per account, in localStorage rather than on the
// account row: the pickers need the window on the first painted frame (see
// `useDefaultRangeFilters`), and IndexedDB reads are async. The old app-wide
// key is the fallback for an account that hasn't picked its own; it held
// MONTHS (1–3), read as 4 weeks each, so existing accounts keep about the
// range they had.
const LEGACY_KEY = 'logslate:default_range_months'
const keyFor = (accountId: string) => `logslate:default_range_weeks:${accountId}`
/** Weeks an account starts on (without the old app-wide setting). */
export const DEFAULT_RANGE_WEEKS = 4
const DEFAULT = DEFAULT_RANGE_WEEKS

function isWeeks(v: number): boolean {
  return Number.isInteger(v) && v >= MIN_RANGE_WEEKS && v <= MAX_RANGE_WEEKS
}

// Choices localStorage refused to save, per account. Win over storage for the
// rest of the session, so the choice still applies — it just isn't remembered.
const memory = new Map<string, number>()

function read(key: string): number | null {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : Number(raw)
  } catch {
    return null
  }
}

function load(accountId: string): number {
  const mem = memory.get(accountId)
  if (mem !== undefined) return mem
  const own = read(keyFor(accountId))
  if (own !== null && isWeeks(own)) return own
  const legacy = read(LEGACY_KEY)
  if (legacy === 1 || legacy === 2 || legacy === 3) return legacy * 4
  return DEFAULT
}

const listeners = new Set<() => void>()

export function setDefaultRangeWeeks(accountId: string, weeks: number): void {
  if (!isWeeks(weeks) || weeks === load(accountId)) return
  try {
    localStorage.setItem(keyFor(accountId), String(weeks))
    memory.delete(accountId)
  } catch {
    memory.set(accountId, weeks)
  }
  listeners.forEach(fn => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function useDefaultRangeWeeks(accountId: string): number {
  return useSyncExternalStore(subscribe, () => load(accountId), () => DEFAULT)
}

/** Forgets an account's choice — for `deleteAccount`, so a later account that
 *  reuses the id (ids come from the name) doesn't inherit it. */
export function clearDefaultRangeWeeks(accountId: string): void {
  memory.delete(accountId)
  try {
    localStorage.removeItem(keyFor(accountId))
  } catch {
    // Nothing stored that we can reach.
  }
  listeners.forEach(fn => fn())
}
