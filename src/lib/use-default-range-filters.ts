import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listDayPnlOverrides } from '@/db/queries'
import type { TradeRecord } from '@/db/types'
import { defaultRange } from '@/lib/shared-filters'
import type { TradeFilters } from '@/lib/filters'
import { nyToday } from '@/lib/tz'

// Stable empty map so the overrides query can resolve to `undefined` while
// loading (feeding the readiness flag) without handing consumers a fresh map
// identity on every render.
const EMPTY_OVERRIDES = new Map<string, number>()

export interface DefaultRangeFilters {
  /** Day-level PNL overrides (date → value). Stable empty map while loading. */
  overridesByDate: Map<string, number>
  /** True once the data that feeds the default range — trades AND overrides —
   *  has resolved. Deliberately excludes models so the filter bar can fill its
   *  default window without waiting on the slower models query (which would
   *  otherwise leave the always-present bar showing "Any" longer, surfacing as
   *  a visible jump). Each route folds this into its own `loaded` gate. */
  rangeReady: boolean
  /** Most recent date with a trade or a day-level override; falls back to
   *  today when the account is empty. Anchors the default one-month window. */
  lastActivityDate: string
  /** URL filters with the default one-month window filled into any unset
   *  bound, once `rangeReady`. Holds the raw URL filters until then so the
   *  filter bar never flashes a today-based default before the real
   *  last-activity date is known. */
  filters: TradeFilters
}

/**
 * Shared filter/default-range plumbing for the Overview and Reports pages.
 * Both subscribe to day-level PNL overrides, derive the most recent activity
 * date, and fill a default one-month window into any unset filter bound — with
 * identical load-flash avoidance. `overridesByDate` resolves to `undefined`
 * internally while loading so `rangeReady` genuinely waits for it.
 */
export function useDefaultRangeFilters(
  accountId: string,
  allTrades: TradeRecord[] | undefined,
  urlFilters: TradeFilters,
): DefaultRangeFilters {
  const overridesQuery = useLiveQuery(
    () => listDayPnlOverrides(accountId),
    [accountId],
  )
  const overridesByDate = overridesQuery ?? EMPTY_OVERRIDES
  const rangeReady = allTrades !== undefined && overridesQuery !== undefined

  const lastActivityDate = useMemo(() => {
    let max: string | null = null
    for (const t of allTrades ?? []) if (max === null || t.date > max) max = t.date
    for (const d of overridesByDate.keys()) if (max === null || d > max) max = d
    return max ?? nyToday()
  }, [allTrades, overridesByDate])

  const filters = useMemo<TradeFilters>(() => {
    if (!rangeReady) return urlFilters
    const d = defaultRange(lastActivityDate)
    return {
      ...urlFilters,
      from: urlFilters.from ?? d.from,
      to: urlFilters.to ?? d.to,
    }
  }, [urlFilters, lastActivityDate, rangeReady])

  return { overridesByDate, rangeReady, lastActivityDate, filters }
}
