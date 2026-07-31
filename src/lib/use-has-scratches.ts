import { useEffect, useMemo } from 'react'
import { applyFilters, type TradeFilters } from '@/lib/filters'
import { classifyTrade } from '@/lib/trade-math'
import type { TradeRecord } from '@/db/types'

// Per-account last-known answer, mirroring `lastHasOverrides` in
// use-include-overrides. The header (with the toggle) paints before the data
// gate, so a remembered value keeps the toggle from flashing in/out on load.
const lastHasScratches = new Map<string, boolean>()

export interface HasScratchesArgs {
  /** Active account — keys the cross-navigation visibility cache. */
  accountId: string
  /** Every trade for the account. Only read when `includeScratches` is off,
   *  since that's the one case `filtered` can't answer. */
  allTrades: TradeRecord[] | undefined
  filters: TradeFilters
  /** True once the page's data has resolved; until then the cached answer is
   *  returned so the toggle doesn't flash in and out on load. */
  ready: boolean
  /** The caller's already-filtered list. With the scratch toggle ON this is
   *  exactly `applyFilters(allTrades, filters, true)`, so reusing it avoids a
   *  third full pass over every trade. */
  filtered: TradeRecord[]
  /** The "show scratch trades" intent. When off, `filtered` has had scratches
   *  removed — the very rows we're looking for — so we re-filter instead. */
  includeScratches: boolean
}

/**
 * Whether the current view — after every filter EXCEPT the scratch toggle — has
 * any scratch trade. Used to hide the "Show scratch trades" toggle when there's
 * nothing to hide, the same way `hasOverridesInWindow` hides the override
 * toggle. Detection is toggle-independent so the toggle still shows while
 * scratches are hidden, letting the user turn them back on.
 */
export function useHasScratchesInWindow({
  accountId,
  allTrades,
  filters,
  ready,
  filtered,
  includeScratches,
}: HasScratchesArgs): boolean {
  const live = useMemo(() => {
    const source = includeScratches
      ? filtered
      : applyFilters(allTrades ?? [], filters, true)
    return source.some(t => classifyTrade(t) === 'scratch')
  }, [allTrades, filters, filtered, includeScratches])
  useEffect(() => {
    if (ready) lastHasScratches.set(accountId, live)
  }, [ready, accountId, live])
  return ready ? live : (lastHasScratches.get(accountId) ?? false)
}
