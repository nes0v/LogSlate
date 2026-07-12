import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getLastTradeDate, listDayFeesOverrides, listDayPnlOverrides } from '@/db/queries'
import { defaultRange } from '@/lib/shared-filters'
import { useDefaultRangeMonths } from '@/lib/default-range-preference'
import type { TradeFilters } from '@/lib/filters'
import { nyToday } from '@/lib/tz'

// Stable empty map so the overrides query can resolve to `undefined` while
// loading (feeding the readiness flag) without handing consumers a fresh map
// identity on every render.
const EMPTY_OVERRIDES = new Map<string, number>()

export interface DefaultRangeFilters {
  /** Day-level PNL overrides (date → value). Stable empty map while loading. */
  overridesByDate: Map<string, number>
  /** Informational fees for override days (date → value). Sparse companion to
   *  `overridesByDate`. Stable empty map while loading. */
  feesOverridesByDate: Map<string, number>
  /** True once the data that feeds the default range — the most recent trade
   *  date AND overrides — has resolved. Reads only the last-trade-date index
   *  key rather than materializing every trade the way `listAllTrades` does,
   *  so the filter bar fills its default window without waiting on the full
   *  trades load. Deliberately excludes models too. Each route folds this into
   *  its own `loaded` gate (which still waits on the full trades load for
   *  content). */
  rangeReady: boolean
  /** The default range — anchored on the most recent activity date, sized by
   *  the user's default-range-months preference. Routes compare against it to
   *  drop a filter bound from the URL when it matches the default. */
  defaultWindow: { from: string; to: string }
  /** URL filters with the default range window filled into any unset bound,
   *  once `rangeReady`. Holds the raw URL filters until then so the filter
   *  bar never flashes a today-based default before the real last-activity
   *  date is known. */
  filters: TradeFilters
}

/**
 * Shared filter/default-range plumbing for the Overview and Reports pages.
 * Both subscribe to day-level PNL overrides, derive the most recent activity
 * date (from a fast last-trade-date index lookup plus the overrides), and fill
 * the default range window (sized by the user's preference) into any unset
 * filter bound — with identical load-flash avoidance. The last-trade-date and
 * overrides queries resolve to `undefined` while loading so `rangeReady`
 * genuinely waits for them.
 */
export function useDefaultRangeFilters(
  accountId: string,
  urlFilters: TradeFilters,
): DefaultRangeFilters {
  const defaultMonths = useDefaultRangeMonths()
  const lastTradeDateQuery = useLiveQuery(
    () => getLastTradeDate(accountId),
    [accountId],
  )
  const overridesQuery = useLiveQuery(
    () => listDayPnlOverrides(accountId),
    [accountId],
  )
  const overridesByDate = overridesQuery ?? EMPTY_OVERRIDES
  const feesOverridesQuery = useLiveQuery(
    () => listDayFeesOverrides(accountId),
    [accountId],
  )
  const feesOverridesByDate = feesOverridesQuery ?? EMPTY_OVERRIDES
  const rangeReady =
    lastTradeDateQuery !== undefined &&
    overridesQuery !== undefined &&
    feesOverridesQuery !== undefined

  const lastActivityDate = useMemo(() => {
    let max: string | null = lastTradeDateQuery ?? null
    for (const d of overridesByDate.keys()) if (max === null || d > max) max = d
    return max ?? nyToday()
  }, [lastTradeDateQuery, overridesByDate])

  const defaultWindow = useMemo(
    () => defaultRange(lastActivityDate, defaultMonths),
    [lastActivityDate, defaultMonths],
  )

  const filters = useMemo<TradeFilters>(() => {
    if (!rangeReady) return urlFilters
    return {
      ...urlFilters,
      from: urlFilters.from ?? defaultWindow.from,
      to: urlFilters.to ?? defaultWindow.to,
    }
  }, [urlFilters, rangeReady, defaultWindow])

  return { overridesByDate, feesOverridesByDate, rangeReady, defaultWindow, filters }
}
