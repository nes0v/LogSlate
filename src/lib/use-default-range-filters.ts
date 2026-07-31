import { useMemo } from 'react'
import { getLastTradeDate, listDayOverrides } from '@/db/queries'
import { defaultRange } from '@/lib/shared-filters'
import { readLastActivityDate } from '@/lib/last-activity-cache'
import { useDefaultRangeMonths } from '@/lib/default-range-preference'
import { useAccountQuery } from '@/lib/use-account-query'
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
  /** URL filters with the default range window filled into any unset bound.
   *  Filled from the cached activity anchor on the first frames and from the
   *  resolved one afterwards, so the pickers show real dates immediately. Falls
   *  back to the raw URL filters (i.e. "Any") only when there's no anchor at
   *  all — a first-ever visit to the account — so the bar still never shows a
   *  today-based guess while loading. */
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
 *
 * The activity anchor is mirrored to localStorage per account by
 * `useLastActivityCache` in Layout (see `last-activity-cache`) and read back
 * synchronously here on mount. Without that seed the pickers cannot show their
 * default window on the first painted frame — the window is derived from
 * IndexedDB and every read is async — which surfaced as a flicker on every
 * navigation to these pages, while a manually-picked filter (URL /
 * shared-filters slot, both synchronous) never flickered.
 *
 * A stale seed self-corrects as soon as the queries land, and can only ever
 * affect the two picker labels: `rangeReady` is unchanged, so every route's
 * content gate still waits for the real data, and the seeded window is never
 * written back to the URL or the shared-filters slot.
 */
export function useDefaultRangeFilters(
  accountId: string,
  urlFilters: TradeFilters,
): DefaultRangeFilters {
  const defaultMonths = useDefaultRangeMonths()
  const lastTradeDateQuery = useAccountQuery(accountId, () => getLastTradeDate(accountId))
  // One subscription for both maps — they come off the same days-table scan,
  // and both sit on `rangeReady`'s critical path.
  const overridesQuery = useAccountQuery(accountId, () => listDayOverrides(accountId))
  const overridesByDate = overridesQuery?.pnl ?? EMPTY_OVERRIDES
  const feesOverridesByDate = overridesQuery?.fees ?? EMPTY_OVERRIDES
  const rangeReady = lastTradeDateQuery !== undefined && overridesQuery !== undefined

  // Most recent REAL activity — the later of the last trade date and the last
  // override date. Null while the queries are in flight, and also null once
  // they land if the account genuinely has none.
  const resolvedActivity = useMemo(() => {
    if (!rangeReady) return null
    let max: string | null = lastTradeDateQuery ?? null
    for (const d of overridesByDate.keys()) if (max === null || d > max) max = d
    return max
  }, [rangeReady, lastTradeDateQuery, overridesByDate])

  // This hook only READS the cache. `useLastActivityCache` (mounted in Layout)
  // owns writing it, so the anchor stays correct after changes made on any
  // page — and after a sync pull or import, which never touch these routes.
  //
  // Read once per account, synchronously, so it's available on the very first
  // render — this is the whole point of the cache.
  const cachedActivity = useMemo(() => readLastActivityDate(accountId), [accountId])

  // Anchor for the default window:
  //  - resolved value once the queries land (always wins);
  //  - the cached value for the frames before that, so the pickers paint real
  //    dates on frame one instead of flashing the "Any" placeholder;
  //  - `nyToday()` only once we KNOW the account has no activity — never as a
  //    loading guess, which is the today-based default this deliberately avoids.
  // Null means "no anchor yet" (first ever visit to this account), and the
  // pickers fall back to "Any" exactly as they did before the cache existed.
  const anchor: string | null = rangeReady
    ? resolvedActivity ?? nyToday()
    : cachedActivity

  // `defaultWindow` always needs a concrete date, so it takes a today-based
  // fallback where `filters` deliberately doesn't. Routes only read it inside
  // `update()`, to decide whether a picked bound matches the default — and by
  // the time the user can trigger that, `rangeReady` is true and this fallback
  // is unused. It never reaches the pickers.
  const defaultWindow = useMemo(
    () => defaultRange(anchor ?? nyToday(), defaultMonths),
    [anchor, defaultMonths],
  )

  const filters = useMemo<TradeFilters>(() => {
    // Seeded or resolved, either is a real window worth showing. Note the
    // routes still gate their CONTENT on `rangeReady` (via `loaded`), so a
    // stale seed can only ever affect the two picker labels for a frame — no
    // stats, chart or table is ever computed from it.
    if (anchor === null) return urlFilters
    return {
      ...urlFilters,
      from: urlFilters.from ?? defaultWindow.from,
      to: urlFilters.to ?? defaultWindow.to,
    }
  }, [urlFilters, anchor, defaultWindow])

  return { overridesByDate, feesOverridesByDate, rangeReady, defaultWindow, filters }
}
