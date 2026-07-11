import { useCallback, useEffect, useMemo } from 'react'
import {
  filterOverridesByWeekday,
  OVERRIDES_PARAM,
  overridesExcludedByFilters,
  type TradeFilters,
} from '@/lib/filters'
import { includeOverridesIntent, saveHeaderToggles } from '@/lib/header-toggle-prefs'

// Shared read-only empty map returned whenever overrides are off. A stable
// identity keeps downstream memos from re-running on every render.
const EMPTY: ReadonlyMap<string, number> = new Map()

// Last-known "window has override days" answer per account, kept at module
// scope so it survives the Overview⇄Reports route remount. On a fresh mount
// Dexie's live queries return `undefined` for a frame before resolving, which
// made the toggle pop in a beat after the page title. Seeding the first render
// from this cache lets the toggle appear immediately; the value self-corrects
// once `ready` and is written back for next time.
const lastHasOverrides = new Map<string, boolean>()

interface UseIncludeOverridesArgs {
  /** Active account — keys the cross-navigation visibility cache. */
  accountId: string
  /** True once trades + overrides have resolved. Until then the window
   *  visibility falls back to the cached value so the toggle can render on the
   *  first frame instead of popping in after the queries settle. */
  ready: boolean
  /** Current URL search params (source of the toggle intent). */
  params: URLSearchParams
  setParams: (next: URLSearchParams) => void
  filters: TradeFilters
  /** Raw day-PNL overrides for the account (not yet gated by the toggle). */
  overridesByDate: Map<string, number>
  /** Raw per-day fee overrides, gated in lockstep with `overridesByDate`. */
  feesOverridesByDate: Map<string, number>
  /** Active window bounds (YYYY-MM-DD), or null while loading / no trades. */
  rangeStart: string | null
  rangeEnd: string | null
  /** Reasons overrides can't apply *beyond* attribute filters — e.g. a
   *  trade-level report tab. OR-ed into `disabled`. */
  extraDisabled?: boolean
}

export interface IncludeOverrides {
  /** The user's raw checkbox intent (URL param, on unless `overrides=0`). */
  intent: boolean
  /** Toggle can't take effect right now (attribute filter or `extraDisabled`). */
  disabled: boolean
  /** The window contains override days, so the toggle is worth showing. Uses
   *  the raw map, never the gated one, so turning the toggle off can't hide
   *  the control that turns it back on. */
  hasOverridesInWindow: boolean
  /** Day-PNL overrides honouring the toggle + weekday filter; `EMPTY` when off. */
  effectiveOverrides: Map<string, number>
  /** Per-day fee overrides under the same gating. */
  effectiveFeesOverrides: Map<string, number>
  /** Flip the toggle, preserving every other URL param. */
  setIncludeOverrides: (next: boolean) => void
  /** Carry the current intent onto a freshly-rebuilt param set — for filter
   *  update/clear, which construct params from scratch and would otherwise
   *  drop the (non-filter) override intent. */
  preserveParam: (p: URLSearchParams) => void
}

/**
 * Wiring for the global "Show override days" toggle, shared by the Overview
 * and Reports pages. Owns the intent→effective-map derivation, the
 * window-visibility check, and the URL-param plumbing so the two pages can't
 * drift on override semantics.
 */
export function useIncludeOverrides({
  accountId,
  ready,
  params,
  setParams,
  filters,
  overridesByDate,
  feesOverridesByDate,
  rangeStart,
  rangeEnd,
  extraDisabled = false,
}: UseIncludeOverridesArgs): IncludeOverrides {
  // Store-backed: URL param wins, else the persisted cross-page intent.
  const intent = includeOverridesIntent(params)
  const disabled = overridesExcludedByFilters(filters) || extraDisabled
  // Overrides feed the stats only when the user wants them AND they can apply.
  // Weekday stays in play (an override day has a weekday), so it's filtered
  // rather than dropped — see `filterOverridesByWeekday`.
  const active = intent && !disabled
  const weekday = filters.weekday

  const effectiveOverrides = useMemo(
    () => (active ? filterOverridesByWeekday(overridesByDate, weekday) : (EMPTY as Map<string, number>)),
    [active, overridesByDate, weekday],
  )
  const effectiveFeesOverrides = useMemo(
    () => (active ? filterOverridesByWeekday(feesOverridesByDate, weekday) : (EMPTY as Map<string, number>)),
    [active, feesOverridesByDate, weekday],
  )

  const liveHasOverrides = useMemo(() => {
    if (!rangeStart || !rangeEnd) return false
    for (const d of overridesByDate.keys()) {
      if (d >= rangeStart && d <= rangeEnd) return true
    }
    return false
  }, [overridesByDate, rangeStart, rangeEnd])

  // Once the data has settled the live answer is authoritative; remember it so
  // the next mount of either page can show the toggle on frame one.
  useEffect(() => {
    if (ready) lastHasOverrides.set(accountId, liveHasOverrides)
  }, [ready, accountId, liveHasOverrides])

  // While loading, trust the last-known answer for this account (default:
  // hidden) rather than the not-yet-resolved live value.
  const hasOverridesInWindow = ready
    ? liveHasOverrides
    : (lastHasOverrides.get(accountId) ?? false)

  const preserveParam = useCallback(
    (p: URLSearchParams) => {
      if (!intent) p.set(OVERRIDES_PARAM, '0')
    },
    [intent],
  )

  const setIncludeOverrides = useCallback(
    (next: boolean) => {
      // Persist first so the hydration effect (which reads the store) sees the
      // new value and doesn't fight this change.
      saveHeaderToggles({ includeOverrides: next })
      const p = new URLSearchParams(params)
      if (next) p.delete(OVERRIDES_PARAM)
      else p.set(OVERRIDES_PARAM, '0')
      setParams(p)
    },
    [params, setParams],
  )

  return {
    intent,
    disabled,
    hasOverridesInWindow,
    effectiveOverrides,
    effectiveFeesOverrides,
    setIncludeOverrides,
    preserveParam,
  }
}
